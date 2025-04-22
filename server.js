require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Statik dosyaları sun
app.use(express.static(path.join(__dirname, '/')));

// API keylerini kontrol et
console.log('Environment variables check:');
console.log('WEATHER_API_KEY:', process.env.WEATHER_API_KEY ? 'Set ✓' : 'Not set ✗');
console.log('GEOCODE_API_KEY:', process.env.GEOCODE_API_KEY ? 'Set ✓' : 'Not set ✗');
console.log('EXCHANGE_RATE_API_KEY:', process.env.EXCHANGE_RATE_API_KEY ? 'Set ✓' : 'Not set ✗');

// Weather endpoint
app.get('/api/weather', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
            params: {
                lat,
                lon,
                appid: process.env.WEATHER_API_KEY,
                units: 'metric',
                lang: 'tr'
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ 
            error: 'Weather data fetch failed',
            details: error.response?.data || error.message 
        });
    }
});

// Geocoding endpoint
app.get('/api/geocode', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({ error: 'Latitude ve longitude parametreleri gerekli' });
        }

        const response = await axios.get('https://api.opencagedata.com/geocode/v1/json', {
            params: {
                q: `${lat}+${lng}`,
                key: process.env.GEOCODE_API_KEY,
                language: 'tr'
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Geocoding failed' });
    }
});

// Currency conversion endpoint
app.get('/api/currency', async (req, res) => {
    try {
        const { from, to, amount } = req.query;
        const response = await axios.get(
            `https://api.exchangerate-api.com/v4/latest/${from}?apikey=${process.env.EXCHANGE_RATE_API_KEY}`
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Currency conversion failed' });
    }
});

// Countries endpoint - veri önbelleğe alma ve hata yönetimi iyileştirmesi
let cachedCountries = null;
const CACHE_DURATION = 30 * 60 * 1000; // 30 dakika
const MAX_RETRIES = 3;
let lastFetch = 0;

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    let lastError;
    
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios({
                url,
                ...options,
                timeout: 5000,
                validateStatus: status => status < 500
            });
            return response;
        } catch (error) {
            lastError = error;
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    }
    throw lastError;
}

app.get('/api/countries', async (req, res) => {
    try {
        const now = Date.now();
        
        // Önbellekteki veri taze ise onu kullan
        if (cachedCountries && (now - lastFetch < CACHE_DURATION)) {
            console.log('Serving from cache');
            return res.json(cachedCountries);
        }

        const response = await fetchWithRetry('https://restcountries.com/v3.1/all');
        
        if (!response.data || !Array.isArray(response.data)) {
            throw new Error('Invalid data format from API');
        }

        const processedData = response.data
            .filter(country => country && country.name && country.cca3)
            .map(country => ({
                name: {
                    common: country.name.common || '',
                    official: country.name.official || '',
                    nativeName: country.name.nativeName || {}
                },
                cca2: country.cca2,
                cca3: country.cca3,
                capital: Array.isArray(country.capital) ? country.capital : ['Bilinmiyor'],
                region: country.region || '',
                languages: country.languages || {},
                currencies: country.currencies || {},
                population: Number(country.population) || 0,
                flags: {
                    png: country.flags?.png || '',
                    svg: country.flags?.svg || ''
                },
                borders: Array.isArray(country.borders) ? country.borders : [],
                area: Number(country.area) || 0,
                timezones: Array.isArray(country.timezones) ? country.timezones : ['UTC'],
                latlng: Array.isArray(country.latlng) ? country.latlng : [0, 0],
                capitalInfo: country.capitalInfo || { latlng: [0, 0] },
                car: country.car || { signs: [], side: 'right' },
                idd: country.idd || { root: '', suffixes: [''] },
                tld: Array.isArray(country.tld) ? country.tld : ['.unknown']
            }))
            .sort((a, b) => a.name.common.localeCompare(b.name.common));

        cachedCountries = processedData;
        lastFetch = now;
        
        return res.json(processedData);
    } catch (error) {
        console.error('Countries API Error:', error.message);
        
        // Önbellekteki veri varsa, hatada onu kullan
        if (cachedCountries) {
            console.log('Serving stale cache after error');
            return res.json(cachedCountries);
        }
        
        res.status(500).json({ 
            error: 'Ülke verileri alınamadı',
            message: error.message
        });
    }
});

// Specific country endpoint - iyileştirilmiş veri işleme
app.get('/api/countries/name/:name', async (req, res) => {
    try {
        const name = req.params.name.toLowerCase();
        
        if (cachedCountries) {
            const country = cachedCountries.find(c => 
                c.name.common.toLowerCase() === name ||
                c.name.official.toLowerCase() === name
            );
            if (country) return res.json([country]);
        }

        const response = await axios.get(`https://restcountries.com/v3.1/name/${encodeURIComponent(name)}`, {
            timeout: 5000
        });

        if (response.data?.length > 0) return res.json(response.data);
        throw new Error('Country not found');
    } catch (error) {
        res.status(404).json({ error: 'Country not found' });
    }
});

// Codes endpoint - iyileştirilmiş hata yönetimi
app.get('/api/countries/codes/:codes', async (req, res) => {
    try {
        const codes = req.params.codes.split(',');
        
        if (cachedCountries) {
            const countries = cachedCountries.filter(c => codes.includes(c.cca3));
            if (countries.length === codes.length) {
                return res.json(countries);
            }
        }

        const response = await axios.get(`https://restcountries.com/v3.1/alpha?codes=${codes.join(',')}`, {
            timeout: 5000
        });

        if (response.data && Array.isArray(response.data)) {
            return res.json(response.data);
        }

        throw new Error('Countries not found');
    } catch (error) {
        res.status(404).json({ error: 'Countries not found' });
    }
});

// Ana sayfaya istek geldiğinde index.html'i sun
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Tüm diğer GET isteklerini index.html'e yönlendir (SPA için)
app.get('*', (req, res) => {
  // Sadece API olmayan istekleri yönlendir
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Vercel'in düzgün çalışması için gerekli
module.exports = app;
