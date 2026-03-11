document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.firebaseImports === 'undefined') {
        console.error("Firebase imports not found.");
        return;
    }

    const { 
        initializeApp, getAuth, signInAnonymously, 
        getFirestore, doc, setDoc, getDoc, 
        getDatabase, ref, onValue
    } = window.firebaseImports;

    const appId = window.__app_id;
    const firebaseConfig = window.__firebase_config ? JSON.parse(window.__firebase_config) : null;
    
    let db; // Firestore (User Settings)
    let rtdb; // Realtime Database (ESP32 Data)
    let auth;
    let userId = 'anonymous';
    let userLocation = "Default Location, India"; 

    // Live state updated by the ESP32
    let currentWeatherData = { temp: 0, humidity: 0, pressure: 0, rainRate: 0, isDark: false };

    // --- DOM Elements ---
    const locationElement = document.getElementById('currentLocation');
    const tempElement = document.getElementById('currentTemp');
    const humidityElement = document.getElementById('currentHumidity');
    const pressureElement = document.getElementById('currentPressure');
    const rainElement = document.getElementById('currentRain');
    const alertBox = document.getElementById('alertBox');
    const suggestionsList = document.getElementById('safetySuggestions');
    const lastUpdatedElement = document.getElementById('lastUpdated');
    const alertStatus = document.getElementById('alertStatus');
    const themeColorPicker = document.getElementById('themeColor');
    const userIdDisplay = document.getElementById('userIdDisplay');
    const locationModal = document.getElementById('locationModal');
    const closeModalButton = document.getElementById('closeModal');
    const manualLocationInput = document.getElementById('manualLocationInput');
    const saveLocationButton = document.getElementById('saveLocation');
    const useGeoLocationButton = document.getElementById('useGeoLocation');

    async function initializeFirebase() {
        if (!firebaseConfig) return;
        
        try {
            const app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            rtdb = getDatabase(app);
            auth = getAuth(app);
            
            await signInAnonymously(auth);
            userId = auth.currentUser.uid;
            userIdDisplay.textContent = userId;

            await loadPreferences();
            listenToESP32(); 
        } catch (error) {
            console.error(`Firebase init failed: ${error.message}`);
        }
    }
    
    // --- Live ESP32 Data Listener ---
    function listenToESP32() {
        const weatherRef = ref(rtdb, 'weather');
        onValue(weatherRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                currentWeatherData.temp = data.temperature || 0;
                currentWeatherData.humidity = data.humidity || 0;
                currentWeatherData.pressure = data.pressure || 0;
                currentWeatherData.rainRate = data.rain_percent || 0;
                currentWeatherData.isDark = data.is_dark || false;
                
                renderDashboard(); 
            }
        });
    }

    // --- Theme & Location Management ---
    const SETTINGS_DOC_PATH = (uid) => `/artifacts/${appId}/users/${uid}/settings/user_prefs`;
    const root = document.documentElement;
    
    function applyTheme(color) {
        root.style.setProperty('--primary-color', color);
        themeColorPicker.value = color; 
    }

    async function savePreferences() {
        if (!db || userId === 'anonymous') return;
        try {
            await setDoc(doc(db, SETTINGS_DOC_PATH(userId)), { 
                color: themeColorPicker.value, 
                location: userLocation
            }, { merge: true }); 
        } catch (e) {
            console.error("Error saving prefs: " + e.message);
        }
    }

    async function loadPreferences() {
        if (!db || userId === 'anonymous') return;
        try {
            const docSnap = await getDoc(doc(db, SETTINGS_DOC_PATH(userId)));
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.color) applyTheme(data.color);
                if (data.location) userLocation = data.location;
                locationElement.textContent = userLocation;
            }
        } catch (e) {
            console.error("Error loading prefs: " + e.message);
        }
    }

    themeColorPicker.addEventListener('input', (e) => {
        applyTheme(e.target.value);
        savePreferences();
    });

    // --- Location UI Logic ---
    window.promptForLocation = () => {
        locationModal.classList.remove('hidden');
        manualLocationInput.value = userLocation.includes('Default') ? '' : userLocation;
    };

    function hideLocationModal() { locationModal.classList.add('hidden'); }

    useGeoLocationButton.addEventListener('click', () => {
        if (navigator.geolocation) {
            locationElement.textContent = "Fetching coordinates...";
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    userLocation = `Lat ${position.coords.latitude.toFixed(2)}, Lon ${position.coords.longitude.toFixed(2)}`;
                    savePreferences();
                    locationElement.textContent = userLocation;
                    hideLocationModal();
                }
            );
        }
    });

    saveLocationButton.addEventListener('click', () => {
        if (manualLocationInput.value.trim()) {
            userLocation = manualLocationInput.value.trim();
            savePreferences();
            locationElement.textContent = userLocation;
            hideLocationModal();
        }
    });
    
    closeModalButton.addEventListener('click', hideLocationModal);

    // --- Core Weather Rendering and Alerts ---
    function renderDashboard() {
        const data = currentWeatherData;
        const alerts = [];
        const suggestions = [];

        if (data.temp > 35 && data.humidity < 70) {
            alerts.push({ type: 'danger', message: 'HEATWAVE WARNING: Extreme Temperatures Detected.' });
            suggestions.push('Stay hydrated and avoid strenuous activity.');
        } else if (data.rainRate > 60) { 
            alerts.push({ type: 'danger', message: 'HEAVY RAIN ALERT: Risk of Flooding.' });
            suggestions.push('Move to higher ground. Drive carefully.');
        } else if (data.rainRate > 20 || data.pressure < 1000) {
            alerts.push({ type: 'warning', message: 'STORM WATCH: Moderate rain detected.' });
            suggestions.push('Drive with caution. Secure loose outdoor items.');
        } else if (data.temp < 22 && data.humidity < 40) {
            alerts.push({ type: 'info', message: 'Clear Weather: Stable conditions expected.' });
            suggestions.push('Enjoy the weather! Ideal day for outdoor activities.');
        } else {
            alerts.push({ type: 'info', message: 'No Severe Weather Alerts Currently Active.' });
            suggestions.push('Monitor the dashboard for live updates.');
        }

        if (data.isDark) suggestions.push('Low light conditions detected outside. Ensure proper lighting.');

        // Update UI Text
        tempElement.textContent = `${data.temp.toFixed(1)}°C`;
        humidityElement.textContent = `${data.humidity.toFixed(0)}%`;
        pressureElement.textContent = `${data.pressure.toFixed(1)} hPa`;
        rainElement.textContent = `${data.rainRate}%`;
        
        alertBox.innerHTML = '';
        suggestionsList.innerHTML = '';
        
        const primaryAlert = alerts[0] || {type: 'info'};
        let alertColor = 'bg-green-500';
        let alertText = 'SAFE';
        
        if (primaryAlert.type === 'danger') {
            alertColor = 'bg-red-600 animate-pulse';
            alertText = 'DANGER';
        } else if (primaryAlert.type === 'warning') {
            alertColor = 'bg-yellow-500';
            alertText = 'ADVISORY';
        }

        alertStatus.className = `w-24 h-24 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-2xl transition-all duration-500 ${alertColor}`;
        alertStatus.textContent = alertText;

        alerts.forEach(alert => {
            const icon = alert.type === 'danger' ? '🚨' : alert.type === 'warning' ? '⚠️' : '✅';
            const colorClass = alert.type === 'danger' ? 'border-red-500 bg-red-50' : alert.type === 'warning' ? 'border-yellow-500 bg-yellow-50' : 'border-blue-500 bg-blue-50';
            alertBox.innerHTML += `<div class="p-4 my-2 rounded-xl border-l-4 ${colorClass} shadow-md font-semibold text-gray-800"><span class="mr-2">${icon}</span>${alert.message}</div>`;
        });

        suggestions.forEach(suggestion => {
            suggestionsList.innerHTML += `<li class="flex items-start mb-2"><div class="w-2 h-2 mt-2 mr-3 rounded-full bg-[--primary-color] flex-shrink-0"></div><p class="text-sm text-gray-700">${suggestion}</p></li>`;
        });

        lastUpdatedElement.textContent = new Date().toLocaleTimeString();
    }

    window.manualRefresh = renderDashboard;

    // --- Initialization ---
    applyTheme(themeColorPicker.value); 
    initializeFirebase();
});