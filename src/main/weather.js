'use strict';

/**
 * T-22 天气小部件数据源（ADR-023 技术验证门禁）。
 *
 * 验证结论（2026-08-10，已记录到 docs/tasks/T-22.md）：
 * - Open-Meteo 免费接口可用，无需 API Key：
 *   - geocoding-api.open-meteo.com/v1/search（城市 -> 经纬度）
 *   - api.open-meteo.com/v1/forecast（当前天气）
 *   两者实测均返回 HTTP 200 与正常数据（城市：Shanghai）。
 * - 所有网络请求在主进程发起（渲染层 CSP connect-src 'self' 不放开外部地址）。
 * - 失败降级：保留最近一次成功数据；网络异常时返回缓存数据 + cached 标记，
 *   渲染层展示“上次成功数据”提示，无缓存时展示本地化错误文案。
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 8000;
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 城市坐标缓存 24h
const FORECAST_CACHE_TTL_MS = 10 * 60 * 1000; // 天气缓存 10min

/** WMO weather code -> 图标与双语描述（Open-Meteo current.weather_code） */
const WEATHER_CODE_INFO = {
  0: { icon: '☀️', zh: '晴朗', en: 'Clear sky' },
  1: { icon: '🌤️', zh: '大致晴朗', en: 'Mainly clear' },
  2: { icon: '⛅', zh: '多云', en: 'Partly cloudy' },
  3: { icon: '☁️', zh: '阴天', en: 'Overcast' },
  45: { icon: '🌫️', zh: '有雾', en: 'Fog' },
  48: { icon: '🌫️', zh: '雾凇', en: 'Depositing rime fog' },
  51: { icon: '🌦️', zh: '毛毛雨', en: 'Light drizzle' },
  53: { icon: '🌦️', zh: '毛毛雨', en: 'Drizzle' },
  55: { icon: '🌦️', zh: '密集毛毛雨', en: 'Dense drizzle' },
  56: { icon: '🌧️', zh: '冻毛毛雨', en: 'Freezing drizzle' },
  57: { icon: '🌧️', zh: '冻毛毛雨', en: 'Freezing drizzle' },
  61: { icon: '🌧️', zh: '小雨', en: 'Light rain' },
  63: { icon: '🌧️', zh: '中雨', en: 'Rain' },
  65: { icon: '🌧️', zh: '大雨', en: 'Heavy rain' },
  66: { icon: '🌧️', zh: '冻雨', en: 'Freezing rain' },
  67: { icon: '🌧️', zh: '冻雨', en: 'Freezing rain' },
  71: { icon: '🌨️', zh: '小雪', en: 'Light snow' },
  73: { icon: '🌨️', zh: '中雪', en: 'Snow' },
  75: { icon: '🌨️', zh: '大雪', en: 'Heavy snow' },
  77: { icon: '🌨️', zh: '米雪', en: 'Snow grains' },
  80: { icon: '🌦️', zh: '小阵雨', en: 'Light rain showers' },
  81: { icon: '🌦️', zh: '阵雨', en: 'Rain showers' },
  82: { icon: '🌧️', zh: '强阵雨', en: 'Violent rain showers' },
  85: { icon: '🌨️', zh: '小阵雪', en: 'Light snow showers' },
  86: { icon: '🌨️', zh: '阵雪', en: 'Snow showers' },
  95: { icon: '⛈️', zh: '雷阵雨', en: 'Thunderstorm' },
  96: { icon: '⛈️', zh: '雷阵雨伴冰雹', en: 'Thunderstorm with hail' },
  99: { icon: '⛈️', zh: '雷阵雨伴冰雹', en: 'Thunderstorm with hail' }
};

/** 城市设置清洗上限（与 store.js WEATHER_CITY_MAX_LENGTH 保持一致） */
const WEATHER_CITY_MAX_LENGTH = 64;

const geocodeCache = new Map(); // key: `语言|城市小写` -> { at, data }
const forecastCache = new Map(); // key: `城市小写|纬度|经度` -> { at, data }
const lastSuccessByCity = new Map(); // 用户输入城市 -> 最近一次成功数据（失败降级）

/** 中文输入按 zh 地理编码语言，其余按 en（Open-Meteo geocoding 支持语言有限） */
function resolveGeoLanguage(language) {
  return typeof language === 'string' && language.toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en';
}

/** 城市名称规范化：去首尾空白、压缩连续空格、截断到 64 字符 */
function normalizeCity(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ').slice(0, WEATHER_CITY_MAX_LENGTH);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 城市 -> 经纬度（Open-Meteo geocoding）。
 * 返回第一个匹配结果；未找到返回 null；网络/解析异常向上抛出（调用方降级）。
 */
async function geocodeCity(city, language) {
  const lang = resolveGeoLanguage(language);
  const key = `${lang}|${city.toLowerCase()}`;
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.at < GEOCODE_CACHE_TTL_MS) {
    return cached.data;
  }

  const url =
    `${GEOCODE_URL}?name=${encodeURIComponent(city)}` +
    `&count=1&language=${lang}&format=json`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo geocoding HTTP ${response.status}`);
  }
  const body = await response.json();
  const results = Array.isArray(body && body.results) ? body.results : [];
  const place = results.length > 0 ? results[0] : null;
  if (
    !place ||
    !Number.isFinite(Number(place.latitude)) ||
    !Number.isFinite(Number(place.longitude))
  ) {
    return null;
  }
  const data = {
    name: typeof place.name === 'string' ? place.name : city,
    country: typeof place.country === 'string' ? place.country : '',
    latitude: Number(place.latitude),
    longitude: Number(place.longitude)
  };
  geocodeCache.set(key, { at: Date.now(), data });
  return data;
}

/** 按 WMO weather code 返回图标与当前语言描述 */
function weatherCodeInfo(code, language) {
  const info = WEATHER_CODE_INFO[Number(code)];
  if (!info) {
    return { icon: '🌡️', label: '—' };
  }
  return {
    icon: info.icon,
    label: resolveGeoLanguage(language) === 'zh' ? info.zh : info.en
  };
}

/** 拉取当前天气（Open-Meteo forecast API 的 current 参数） */
async function fetchForecast(latitude, longitude) {
  const url =
    `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,' +
    'weather_code,wind_speed_10m&timezone=auto&forecast_days=1';
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo forecast HTTP ${response.status}`);
  }
  const body = await response.json();
  const current = body && body.current;
  if (
    !current ||
    !Number.isFinite(Number(current.temperature_2m)) ||
    !Number.isFinite(Number(current.weather_code))
  ) {
    throw new Error('Open-Meteo forecast 响应缺少 current 数据');
  }
  return { current, units: body && body.current_units };
}

function buildWeatherData(place, forecast, language) {
  const current = forecast.current;
  const units = forecast.units || {};
  const code = Number(current.weather_code);
  const info = weatherCodeInfo(code, language);
  return {
    name: place.name || '',
    country: place.country || '',
    time: typeof current.time === 'string' ? current.time : '',
    temperature: Number(current.temperature_2m),
    apparentTemperature: Number(current.apparent_temperature),
    humidity: Number(current.relative_humidity_2m),
    windSpeed: Number(current.wind_speed_10m),
    weatherCode: code,
    description: info.label,
    icon: info.icon,
    units: {
      temperature: units.temperature_2m || '°C',
      humidity: units.relative_humidity_2m || '%',
      windSpeed: units.wind_speed_10m || 'km/h'
    },
    updatedAt: Date.now()
  };
}

/**
 * 获取天气（主进程调用入口）。
 *
 * @param {Object} [options]
 * @param {string} [options.city] 城市名（缺省时由调用方传空 -> weather-empty-city）
 * @param {string} [options.language] 'zh-CN' / 'en' / 'system'（描述语言）
 * @param {boolean} [options.force] 跳过 10 分钟天气缓存（城市坐标缓存 24h 不变）
 * @returns {Promise<{ok: boolean, data?: Object, cached?: boolean, error?: string}>}
 */
async function getWeather(options) {
  const city = normalizeCity(options && options.city);
  const language = (options && options.language) || 'zh-CN';
  const force = Boolean(options && options.force);
  if (!city) {
    return { ok: false, error: 'weather-empty-city', data: null, cached: false };
  }

  try {
    const place = await geocodeCity(city, language);
    if (!place) {
      return {
        ok: false,
        error: 'weather-city-not-found',
        data: lastSuccessByCity.get(city) || null,
        cached: Boolean(lastSuccessByCity.get(city))
      };
    }

    const cacheKey =
      `${normalizeCity(place.name || city).toLowerCase()}|` +
      `${place.latitude.toFixed(4)}|${place.longitude.toFixed(4)}`;
    const cached = forecastCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < FORECAST_CACHE_TTL_MS) {
      return { ok: true, data: cached.data, cached: true };
    }

    const forecast = await fetchForecast(place.latitude, place.longitude);
    const data = buildWeatherData(place, forecast, language);
    forecastCache.set(cacheKey, { at: Date.now(), data });
    lastSuccessByCity.set(city, data);
    return { ok: true, data, cached: false };
  } catch (error) {
    const cachedData = lastSuccessByCity.get(city) || null;
    return {
      ok: false,
      error: 'weather-network-error',
      data: cachedData,
      cached: Boolean(cachedData)
    };
  }
}

module.exports = {
  getWeather,
  normalizeCity,
  weatherCodeInfo,
  WEATHER_CODE_INFO,
  WEATHER_CITY_MAX_LENGTH,
  GEOCODE_URL,
  FORECAST_URL
};
