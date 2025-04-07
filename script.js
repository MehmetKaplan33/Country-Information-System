// Ülke listesi için global değişken
let countries = [];

// CountryManager sınıfını ekle
class CountryManager {
  constructor() {
    this.countries = [];
    this.lastFetch = 0;
    this.isFetching = false;
    this.CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 saat
    this.BACKUP_API = 'https://restcountries.com/v3.1/all';
  }

  async initialize() {
    showLoading();
    try {
      await this.loadCountries();
      console.log("✅ Ülkeler başarıyla yüklendi:", this.countries.length);
      hideLoading();
      return true;
    } catch (error) {
      console.error("❌ Ülke verisi yüklenemedi:", error);
      hideLoading();
      renderError(error);
      return false;
    }
  }

  async loadCountries() {
    if (this.isFetching) {
      return this.countries;
    }

    const cached = this.getCachedData();
    if (cached) {
      this.countries = cached;
      return this.countries;
    }

    this.isFetching = true;
    try {
      const data = await this.fetchFromPrimarySource();
      this.updateCache(data);
      this.countries = data;
    } catch (error) {
      console.warn("⚠️ Birincil kaynak başarısız, yedek kaynak deneniyor...");
      const backupData = await this.fetchFromBackupSource();
      this.updateCache(backupData);
      this.countries = backupData;
    } finally {
      this.isFetching = false;
    }

    return this.countries;
  }

  async fetchFromPrimarySource() {
    const response = await fetch("http://localhost:3000/api/countries", {
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!response.ok) {
      throw new Error(`Sunucu hatası: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Geçersiz veri formatı");
    }

    return data;
  }

  async fetchFromBackupSource() {
    const response = await fetch(this.BACKUP_API);
    if (!response.ok) {
      throw new Error("Yedek API'den veri alınamadı");
    }

    const data = await response.json();
    return data;
  }

  getCachedData() {
    try {
      const cached = localStorage.getItem('countriesCache');
      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < this.CACHE_DURATION) {
        console.info('📦 Önbellekten veriler yükleniyor...');
        return data;
      }
    } catch (error) {
      console.warn('⚠️ Önbellek hatası, temizleniyor...');
      localStorage.removeItem('countriesCache');
    }
    return null;
  }

  updateCache(data) {
    try {
      localStorage.setItem('countriesCache', JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.warn('⚠️ Önbellek güncelleme hatası:', error);
    }
  }

  findCountry(name) {
    return this.countries.find(country => 
      country.name.common.toLowerCase() === name.toLowerCase() ||
      country.name.official.toLowerCase() === name.toLowerCase()
    );
  }

  // Yeni metod ekle
  async getNeighborCountries(borders) {
    if (!borders || !Array.isArray(borders) || borders.length === 0) {
      return [];
    }

    // Önce yerel veride ara
    const localNeighbors = borders.map(code => 
      this.countries.find(country => country.cca3 === code)
    ).filter(Boolean);

    if (localNeighbors.length === borders.length) {
      return localNeighbors;
    }

    // Yerel veride bulunamazsa API'den al
    try {
      const response = await fetch(
        `http://localhost:3000/api/countries/codes/${borders.join(",")}`
      );

      if (!response.ok) {
        throw new Error("Komşu ülkeler getirilemedi");
      }

      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Neighbor countries fetch error:", error);
      return localNeighbors; // En azından yerel verideki komşuları döndür
    }
  }
}

// Global CountryManager instance
const countryManager = new CountryManager();

// DOMContentLoaded event listener'ı güncelle
document.addEventListener("DOMContentLoaded", async () => {
  if (await countryManager.initialize()) {
    countries = countryManager.countries;
    initializeAutocomplete();
  }
});

function initializeAutocomplete() {
  const searchInput = document.querySelector("#txtSearch");
  let currentFocus = -1;

  const autocompleteContainer = document.createElement("div");
  autocompleteContainer.setAttribute("class", "autocomplete-items");
  searchInput.parentNode.appendChild(autocompleteContainer);

  searchInput.addEventListener("input", function (e) {
    const val = this.value.trim();

    autocompleteContainer.innerHTML = "";
    autocompleteContainer.style.display = "none";

    if (!val) return false;

    if (!Array.isArray(countries)) {
      console.error("Countries data is not available");
      return;
    }

    // Eşleşen ülkeleri bul
    const matches = countries
      .filter((country) => {
        if (!country?.name?.common) return false;

        const searchVal = val.toLowerCase();
        const commonName = country.name.common.toLowerCase();
        const officialName = country.name.official.toLowerCase();

        return (
          commonName.includes(searchVal) || officialName.includes(searchVal)
        );
      })
      .sort((a, b) => {
        const aName = a.name.common.toLowerCase();
        const bName = b.name.common.toLowerCase();
        const searchVal = val.toLowerCase();

        // Tam eşleşmeleri öne çıkar
        if (aName === searchVal && bName !== searchVal) return -1;
        if (bName === searchVal && aName !== searchVal) return 1;

        // Başlayan eşleşmeleri öne çıkar
        if (aName.startsWith(searchVal) && !bName.startsWith(searchVal))
          return -1;
        if (bName.startsWith(searchVal) && !aName.startsWith(searchVal))
          return 1;

        return aName.localeCompare(bName);
      })
      .slice(0, 8);

    if (matches.length > 0) {
      autocompleteContainer.style.display = "block";
      matches.forEach((country) => {
        const div = document.createElement("div");
        div.className = "autocomplete-item";

        const itemContent = document.createElement("div");
        itemContent.className = "autocomplete-item-content";

        // Bayrak ekle
        const flag = new Image();
        flag.src = country.flags.png;
        flag.alt = `${country.name.common} flag`;
        flag.className = "country-flag";
        flag.loading = "lazy";

        // Yedek bayrak resmi
        flag.onerror = () => {
          flag.src =
            "https://flagcdn.com/w40/" + country.cca2?.toLowerCase() + ".png";
        };

        // Ülke adı
        const name = document.createElement("span");
        name.className = "country-name";
        name.textContent = country.name.common;

        // Başkent
        const capital = document.createElement("span");
        capital.className = "country-capital";
        capital.textContent = country.capital?.[0] || "";

        itemContent.appendChild(flag);
        itemContent.appendChild(name);
        itemContent.appendChild(capital);
        div.appendChild(itemContent);

        div.addEventListener("click", () => {
          searchInput.value = country.name.common;
          autocompleteContainer.style.display = "none";
          getCountry(country.name.common);
        });

        autocompleteContainer.appendChild(div);
      });
    }
  });

  // Klavye navigasyonu için
  searchInput.addEventListener("keydown", function (e) {
    let items = autocompleteContainer.getElementsByTagName("div");

    if (e.keyCode === 40) {
      // Aşağı ok
      currentFocus++;
      addActive(items);
    } else if (e.keyCode === 38) {
      // Yukarı ok
      currentFocus--;
      addActive(items);
    } else if (e.keyCode === 13) {
      // Enter
      e.preventDefault();
      if (currentFocus > -1) {
        if (items) items[currentFocus].click();
      }
    }
  });

  // Aktif öğeyi işaretle
  function addActive(items) {
    if (!items) return false;
    removeActive(items);
    if (currentFocus >= items.length) currentFocus = 0;
    if (currentFocus < 0) currentFocus = items.length - 1;
    items[currentFocus].classList.add("autocomplete-active");
  }

  // Aktif işaretini kaldır
  function removeActive(items) {
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove("autocomplete-active");
    }
  }

  // Sayfa herhangi bir yerine tıklandığında listeyi kapat
  document.addEventListener("click", function (e) {
    if (e.target !== searchInput) {
      autocompleteContainer.style.display = "none";
    }
  });
}

document.querySelector("#txtSearch").addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    document.querySelector("#btnSearch").click();
  }
});

function showLoading() {
  document.querySelector(".loading-container").style.display = "flex";
  document.querySelector("#details").style.opacity = "0";
  document.querySelector("#details").style.display = "none";
}

function hideLoading() {
  document.querySelector(".loading-container").style.display = "none";
  document.querySelector("#details").style.display = "block";
}

document.querySelector("#btnSearch").addEventListener("click", () => {
  let text = document.querySelector("#txtSearch").value;
  if (text.trim() === "") {
    renderError(new Error("Lütfen bir ülke adı giriniz"));
    return;
  }
  showLoading();
  getCountry(text);
});

document.querySelector("#btnLocation").addEventListener("click", () => {
  if (navigator.geolocation) {
    showLoading();
    navigator.geolocation.getCurrentPosition(onSuccess, onError);
  }
});

function onError(err) {
  console.log(err);
  hideLoading();
}

async function onSuccess(position) {
  let lat = position.coords.latitude;
  let lng = position.coords.longitude;

  const url = `http://localhost:3000/api/geocode?lat=${lat}&lng=${lng}`;

  const response = await fetch(url);
  const data = await response.json();

  const country = data.results[0].components.country;

  document.querySelector("#txtSearch").value = country;
  document.querySelector("#btnSearch").click();
}

async function getCountry(countryName) {
  try {
    showLoading();
    
    // Önce yerel veride ara
    const localCountry = countryManager.findCountry(countryName);
    let countryData;

    if (localCountry) {
      countryData = localCountry;
    } else {
      // Yerel veride bulunamazsa API'den al
      const response = await fetch(
        `http://localhost:3000/api/countries/name/${encodeURIComponent(countryName)}`
      );

      if (!response.ok) {
        throw new Error("Ülke bulunamadı");
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Ülke verisi alınamadı");
      }

      countryData = data[0];
    }

    // Ülke detaylarını göster
    renderCountry(countryData);

    // Komşu ülkeleri göster
    const borders = countryData.borders;
    let neighborsHtml = '<div class="card mb-3"><div class="card-header">';
    neighborsHtml += '<i class="fas fa-globe-americas me-2"></i>Komşu Ülkeler</div>';
    neighborsHtml += '<div class="card-body">';

    if (!borders || !Array.isArray(borders) || borders.length === 0) {
      neighborsHtml += `
        <div class="text-center py-4">
          <i class="fas fa-map-marker-alt mb-3" style="font-size: 2rem; color: #6c757d;"></i>
          <p class="lead mb-0">${countryData.name.common} bir ada ülkesidir veya kara sınırı bulunmamaktadır.</p>
        </div>`;
    } else {
      const neighbors = await countryManager.getNeighborCountries(borders);
      
      if (neighbors.length > 0) {
        neighborsHtml += '<div class="neighbors-grid">';
        neighbors.forEach((country) => {
          neighborsHtml += `
            <div class="neighbor-card" data-country="${country.name.common}">
              <img src="${country.flags.png}" alt="${country.name.common} bayrağı">
              <div class="neighbor-info">
                <h3 class="neighbor-title">${country.name.common}</h3>
                <div class="neighbor-details">
                  <div>
                    <i class="fas fa-city"></i>
                    Başkent: ${country.capital?.[0] || "Bilinmiyor"}
                  </div>
                  <div>
                    <i class="fas fa-users"></i>
                    Nüfus: ${(country.population / 1000000).toFixed(1)} milyon
                  </div>
                  <div>
                    <i class="fas fa-globe"></i>
                    Bölge: ${country.region}
                  </div>
                </div>
              </div>
            </div>
          `;
        });
        neighborsHtml += "</div>";
      }
    }

    neighborsHtml += "</div></div>";
    document.querySelector("#neighbors").innerHTML = neighborsHtml;

    // Komşu ülkelere tıklama olayı ekle
    document.querySelectorAll(".neighbor-card").forEach((card) => {
      card.addEventListener("click", function () {
        const countryName = this.getAttribute("data-country");
        document.querySelector("#txtSearch").value = countryName;
        showLoading();
        getCountry(countryName);
      });
    });

  } catch (err) {
    console.error("Country fetch error:", err);
    renderError(err);
  } finally {
    hideLoading();
  }
}

let map = null;
let countryLayer = null;

const weatherIcons = {
  "01d": "fas fa-sun",
  "01n": "fas fa-moon",
  "02d": "fas fa-cloud-sun",
  "02n": "fas fa-cloud-moon",
  "03d": "fas fa-cloud",
  "03n": "fas fa-cloud",
  "04d": "fas fa-clouds",
  "04n": "fas fa-clouds",
  "09d": "fas fa-cloud-showers-heavy",
  "09n": "fas fa-cloud-showers-heavy",
  "10d": "fas fa-cloud-rain",
  "10n": "fas fa-cloud-rain",
  "11d": "fas fa-bolt",
  "11n": "fas fa-bolt",
  "13d": "fas fa-snowflake",
  "13n": "fas fa-snowflake",
  "50d": "fas fa-smog",
  "50n": "fas fa-smog",
};

// Hava durumu verilerini önbelleğe alma
const weatherCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 dakika

async function getWeatherData(lat, lng) {
  const cacheKey = `${lat},${lng}`;
  const now = Date.now();

  if (weatherCache.has(cacheKey)) {
    const cachedData = weatherCache.get(cacheKey);
    if (now - cachedData.timestamp < CACHE_DURATION) {
      return cachedData.data;
    }
  }

  const response = await fetch(
    `http://localhost:3000/api/weather?lat=${lat}&lon=${lng}`
  );
  if (!response.ok) throw new Error("Hava durumu verisi alınamadı");

  const data = await response.json();
  weatherCache.set(cacheKey, { timestamp: now, data });
  return data;
}

function renderCountry(data) {
  hideLoading();
  document.querySelector("#country-details").innerHTML = "";
  document.querySelector("#neighbors").innerHTML = "";

  let html = `                   
          <div class="col-4">
              <img src="${data.flags.png}" alt="" class="img-fluid">
          </div>
          <div class="col-8">
              <h3 class="card-title">${data.name.common}</h3>
              <hr>
              <div class="row">
                  <div class="col-4">Nufüs: </div>
                  <div class="col-8">${(data.population / 1000000).toFixed(
                    1
                  )} milyon</div>
              </div>
              <div class="row">
                  <div class="col-4">Resmi Dil: </div>
                  <div class="col-8">${Object.values(data.languages)}</div>
              </div>
              <div class="row">
                  <div class="col-4">Başkent: </div>
                  <div class="col-8">${data.capital[0]}</div>
              </div>
              <div class="row">
                  <div class="col-4">Para Birimi: </div>
                  <div class="col-8">${
                    Object.values(data.currencies)[0].name
                  } (${Object.values(data.currencies)[0].symbol})</div>
              </div>
          </div>
        `;

  document.querySelector("#country-details").innerHTML = html;
  document.querySelector("#details").style.opacity = "1";

  // Haritayı güncelle
  updateMap(data);

  // İstatistikleri güncelle
  updateStats(data);

  // Para birimi çeviriciyi güncelle
  updateCurrencyConverter(data);
}

// Harita işlemleri
async function updateMap(data) {
  if (map) {
    map.remove();
  }

  // Haritayı oluştur
  map = L.map("countryMap", {
    zoomControl: false,
    attributionControl: false,
  }).setView([data.latlng[0], data.latlng[1]], 5);

  // Özel stil ile tile layer ekle
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "© OpenStreetMap contributors",
    }
  ).addTo(map);

  // Zoom kontrolünü sağ alt köşeye ekle
  L.control
    .zoom({
      position: "bottomleft",
    })
    .addTo(map);

  try {
    // Ülke sınırlarını çiz
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?country=${encodeURIComponent(
        data.name.common
      )}&format=json&polygon_geojson=1`
    );
    const geoData = await response.json();

    if (geoData.length > 0 && geoData[0].geojson) {
      if (countryLayer) {
        countryLayer.remove();
      }

      countryLayer = L.geoJSON(geoData[0].geojson, {
        style: {
          color: "#2563eb",
          weight: 3,
          opacity: 0.8,
          fillColor: "#3b82f6",
          fillOpacity: 0.15,
          dashArray: "5, 8",
        },
      }).addTo(map);

      // Haritayı ülke sınırlarına göre ayarla
      map.fitBounds(countryLayer.getBounds(), {
        padding: [50, 50],
        maxZoom: 8,
      });
    }

    // Başkent için hava durumu göster
    document.getElementById("weatherLegend").innerHTML = ""; // Önceki hava durumu verilerini temizle
    if (data.capital && data.capitalInfo && data.capitalInfo.latlng) {
      await updateWeatherInfo(
        data.capital[0],
        data.capitalInfo.latlng[0],
        data.capitalInfo.latlng[1],
        true
      );
    }

    // Haritaya tıklama olayı ekle
    let clickTimeout;
    map.on("click", async function (e) {
      try {
        // Önceki tıklama işlemi varsa iptal et
        if (clickTimeout) clearTimeout(clickTimeout);

        // Tıklanan konumun koordinatlarını al
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        // Tıklama animasyonu ekle
        const ripple = L.circleMarker(e.latlng, {
          radius: 0,
          color: "#2563eb",
          fillColor: "#3b82f6",
          fillOpacity: 0.5,
          weight: 2,
        }).addTo(map);

        // Ripple animasyonu
        let radius = 0;
        const animate = () => {
          radius += 2;
          ripple.setRadius(radius);
          ripple.setStyle({
            opacity: 1 - radius / 40,
            fillOpacity: 0.5 - radius / 40,
          });

          if (radius < 40) {
            requestAnimationFrame(animate);
          } else {
            map.removeLayer(ripple);
          }
        };
        animate();

        // Eğer tıklanan nokta seçili ülke içindeyse hava durumunu göster
        if (countryLayer.getBounds().contains(e.latlng)) {
          // 300ms bekleyerek art arda tıklamaları engelle
          clickTimeout = setTimeout(async () => {
            try {
              const response = await fetch(
                `http://localhost:3000/api/geocode?lat=${lat}&lng=${lng}`
              );
              const data = await response.json();

              if (data.results && data.results.length > 0) {
                const result = data.results[0];
                const cityName =
                  result.components.city ||
                  result.components.town ||
                  result.components.village ||
                  result.components.county ||
                  "Bilinmeyen Bölge";

                await updateWeatherInfo(cityName, lat, lng, false);
              }
            } catch (error) {
              console.error("Geocoding error:", error);
            }
          }, 300);
        }
      } catch (error) {
        console.error("Konum bilgisi alınırken bir hata oluştu:", error);
      }
    });
  } catch (error) {
    console.error("Harita yüklenirken bir hata oluştu:", error);
  }
}

async function updateWeatherInfo(cityName, lat, lng, isCapital = false) {
  try {
    const weatherData = await getWeatherData(lat, lng);

    const temp = Math.round(weatherData.main.temp);
    const weatherIcon = weatherData.weather[0].icon;
    const description = weatherData.weather[0].description;
    const humidity = weatherData.main.humidity;
    const windSpeed = weatherData.wind.speed;
    const feelsLike = Math.round(weatherData.main.feels_like);

    const weatherHtml = `
      <div class="weather-marker">
        <i class="${weatherIcons[weatherIcon]}"></i>
        <div>
          <div class="temp">${temp}</div>
          <div class="feels-like">Hissedilen: ${feelsLike}°C</div>
          <div class="city">${cityName}${isCapital ? " (Başkent)" : ""}</div>
          <div class="description">${description}</div>
          <div class="details">
            <span><i class="fas fa-tint"></i> Nem: %${humidity}</span>
            <span><i class="fas fa-wind"></i> Rüzgar: ${windSpeed} m/s</span>
          </div>
        </div>
      </div>
    `;

    // Hava durumu bilgisini legend'a ekle
    const weatherLegend = document.getElementById("weatherLegend");
    weatherLegend.innerHTML = weatherHtml;

    // Legend'a giriş animasyonu ekle
    weatherLegend.style.opacity = "0";
    weatherLegend.style.transform = "translateY(20px)";

    setTimeout(() => {
      weatherLegend.style.transition = "all 0.3s ease";
      weatherLegend.style.opacity = "1";
      weatherLegend.style.transform = "translateY(0)";
    }, 50);
  } catch (error) {
    console.error("Hava durumu bilgisi alınırken bir hata oluştu:", error);
  }
}

// İstatistik işlemleri
function updateStats(data) {
  // Nüfus bilgileri
  document.getElementById("populationValue").textContent = `${(
    data.population / 1000000
  ).toFixed(1)} Milyon`;
  document.getElementById(
    "populationDensity"
  ).textContent = `Nüfus Yoğunluğu: ${(data.population / data.area).toFixed(
    1
  )} kişi/km²`;

  // Yüzölçümü bilgileri
  document.getElementById("areaValue").textContent = `${(
    data.area / 1000
  ).toFixed(1)} bin km²`;
  document.getElementById("areaComparison").textContent =
    data.area > 500000
      ? "Büyük Ülke"
      : data.area > 100000
      ? "Orta Büyüklükte"
      : "Küçük Ülke";

  // Saat dilimi bilgileri
  document.getElementById("timezoneValue").textContent = data.timezones[0];
  const now = new Date();
  const options = { timeZone: data.timezones[0], timeStyle: "short" };
  try {
    document.getElementById(
      "currentTime"
    ).textContent = `Yerel Saat: ${now.toLocaleTimeString("tr-TR", options)}`;
  } catch (e) {
    document.getElementById("currentTime").textContent =
      "Yerel saat hesaplanamadı";
  }

  // Trafik bilgileri
  document.getElementById("carSide").textContent =
    data.car.side === "right" ? "Sağdan Akan Trafik" : "Soldan Akan Trafik";
  document.getElementById("carCode").textContent = `Plaka Kodu: ${
    data.car.signs[0] || "Bilinmiyor"
  }`;

  // Telefon bilgileri
  document.getElementById(
    "phoneCode"
  ).textContent = `${data.idd.root}${data.idd.suffixes[0]}`;

  document.getElementById("phoneExample").textContent =
    "Örn: " + data.idd.root + data.idd.suffixes[0] + " xxx xx xx";

  // İnternet bilgileri
  document.getElementById("internetDomain").textContent = data.tld[0];
  document.getElementById(
    "internetExample"
  ).textContent = `Örn: www.site${data.tld[0]}`;
}

// Grafik işlemleri
function updateCharts(data) {
  // Mevcut grafikleri temizle
  if (populationChart) {
    populationChart.destroy();
  }
  if (gdpChart) {
    gdpChart.destroy();
  }

  // Nüfus grafiği
  const populationCtx = document
    .getElementById("populationChart")
    .getContext("2d");
  populationChart = new Chart(populationCtx, {
    type: "bar",
    data: {
      labels: ["Nüfus (Milyon)"],
      datasets: [
        {
          label: data.name.common,
          data: [data.population / 1000000],
          backgroundColor: "rgba(54, 162, 235, 0.5)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Ülke Nüfusu",
        },
      },
    },
  });

  // GDP grafiği (eğer varsa)
  if (data.gdp) {
    const gdpCtx = document.getElementById("gdpChart").getContext("2d");
    gdpChart = new Chart(gdpCtx, {
      type: "bar",
      data: {
        labels: ["GSYİH (Milyar $)"],
        datasets: [
          {
            label: data.name.common,
            data: [data.gdp / 1000000000],
            backgroundColor: "rgba(75, 192, 192, 0.5)",
            borderColor: "rgba(75, 192, 192, 1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: "Gayri Safi Yurt İçi Hasıla",
          },
        },
      },
    });
  }
}

// Para birimi çevirici işlemleri
async function updateCurrencyConverter(data) {
  const fromCurrencySelect = document.getElementById("fromCurrency");
  const toCurrencySelect = document.getElementById("toCurrency");
  const convertBtn = document.getElementById("convertBtn");
  const amount = document.getElementById("amount");
  const conversionResult = document.getElementById("conversionResult");

  convertBtn.replaceWith(convertBtn.cloneNode(true));
  const newConvertBtn = document.getElementById("convertBtn");

  try {
    const response = await fetch(`http://localhost:3000/api/currency?from=USD`);
    const currencyData = await response.json();
    const currencies = Object.keys(currencyData.rates);
    const countryCurrency = Object.keys(data.currencies)[0];

    fromCurrencySelect.innerHTML = currencies
      .map(
        (currency) =>
          `<option value="${currency}" ${
            currency === countryCurrency ? "selected" : ""
          }>${currency}</option>`
      )
      .join("");

    toCurrencySelect.innerHTML = currencies
      .map((currency) => `<option value="${currency}">${currency}</option>`)
      .join("");

    newConvertBtn.addEventListener("click", async () => {
      if (!amount.value) {
        renderError(new Error("Lütfen bir miktar giriniz"));
        return;
      }

      try {
        const fromCurrency = fromCurrencySelect.value;
        const toCurrency = toCurrencySelect.value;
        const amountValue = parseFloat(amount.value);

        conversionResult.innerHTML =
          '<div class="alert alert-info">Dönüştürülüyor...</div>';

        const response = await fetch(
          `http://localhost:3000/api/currency?from=${fromCurrency}&to=${toCurrency}&amount=${amountValue}`
        );
        const data = await response.json();
        const result = amountValue * data.rates[toCurrency];

        conversionResult.innerHTML = `
                    <div class="alert alert-success">
                        ${amountValue} ${fromCurrency} = ${result.toFixed(
          2
        )} ${toCurrency}
                    </div>
                `;

        setTimeout(() => {
          if (conversionResult.querySelector(".alert-success")) {
            conversionResult.innerHTML = "";
          }
        }, 5000);
      } catch (error) {
        renderError(new Error("Dönüştürme işlemi başarısız oldu"));
        conversionResult.innerHTML = "";
      }
    });
  } catch (error) {
    console.error("Para birimi listesi alınamadı");
    conversionResult.innerHTML = `
            <div class="alert alert-danger">
                Para birimi listesi yüklenemedi
            </div>
        `;
  }
}

function renderError(err) {
  hideLoading();
  const html = `
          <div class="alert alert-danger">
              ${err.message}
          </div>
        `;
  document.querySelector("#errors").innerHTML = html;
  setTimeout(function () {
    document.querySelector("#errors").innerHTML = "";
  }, 3000);
}

// Dark/Light Mode Toggle
document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("themeToggle");

  // Kaydedilmiş temayı kontrol et
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);

  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "light" ? "dark" : "light";

    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);

    // Animasyonlu geçiş için
    themeToggle.style.transform = "rotate(180deg)";
    setTimeout(() => {
      themeToggle.style.transform = "rotate(0)";
    }, 200);
  });
});

// Kıta filtreleme fonksiyonu
async function getCountriesByContinent(continent) {
  try {
    showLoading();
    const response = await fetch(
      `https://restcountries.com/v3.1/region/${continent}`
    );
    if (!response.ok) throw new Error("Ülkeler yüklenirken bir hata oluştu");
    const data = await response.json();
    renderCountriesList(data);
  } catch (err) {
    renderError(err);
  } finally {
    hideLoading();
  }
}

// Ülkeler listesini render etme fonksiyonu
function renderCountriesList(countries) {
  document.querySelector("#details").style.opacity = "1";
  let html = `
    <div class="card mb-3">
      <div class="card-header">
        <i class="fas fa-globe-americas me-2"></i>Ülkeler (${countries.length})
      </div>
      <div class="card-body">
        <div class="neighbors-grid">
          ${countries
            .map(
              (country) => `
            <div class="neighbor-card" data-country="${country.name.common}">
              <img src="${country.flags.png}" alt="${
                country.name.common
              } bayrağı">
              <div class="neighbor-info">
                <h3 class="neighbor-title">${country.name.common}</h3>
                <div class="neighbor-details">
                  <div>
                    <i class="fas fa-city"></i>
                    Başkent: ${country.capital?.[0] || "Bilinmiyor"}
                  </div>
                  <div>
                    <i class="fas fa-users"></i>
                    Nüfus: ${(country.population / 1000000).toFixed(1)} milyon
                  </div>
                  <div>
                    <i class="fas fa-globe"></i>
                    Bölge: ${country.region}
                  </div>
                </div>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    </div>
  `;

  document.querySelector("#country-details").innerHTML = html;
  document.querySelector("#neighbors").innerHTML = "";

  // Ülke kartlarına tıklama olayı ekle
  document.querySelectorAll(".neighbor-card").forEach((card) => {
    card.addEventListener("click", function () {
      const countryName = this.getAttribute("data-country");
      document.querySelector("#txtSearch").value = countryName;
      showLoading();
      getCountry(countryName);
    });
  });
}

// Event listener ekle
document
  .querySelector("#btnFilterByContinent")
  .addEventListener("click", () => {
    const continent = document.querySelector("#continentSelect").value;
    if (!continent) {
      renderError(new Error("Lütfen bir kıta seçiniz"));
      return;
    }
    getCountriesByContinent(continent);
  });
