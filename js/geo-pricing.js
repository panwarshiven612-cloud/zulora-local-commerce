/**
 * Zulora Local — Hyperlocal Geo-Pricing & Profile Persistence Engine v3
 */
import { PLATFORM_CONSTANTS } from './config.js';

export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const nLat1 = Number(lat1), nLon1 = Number(lon1), nLat2 = Number(lat2), nLon2 = Number(lon2);
  if ([nLat1, nLon1, nLat2, nLon2].some(isNaN)) return null;
  const R = 6371;
  const dLat = toRad(nLat2 - nLat1), dLon = toRad(nLon2 - nLon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(nLat1)) * Math.cos(toRad(nLat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function toRad(d) { return d * Math.PI / 180; }

export function getEstimatedDeliveryTime(distKm) {
  if (distKm == null) return 'Fast Delivery';
  if (distKm <= 1)  return '10–15 mins';
  if (distKm <= 2)  return '15–20 mins';
  if (distKm <= 6)  return '20–30 mins';
  const mn = Math.round(25 + (distKm - 6) * 3), mx = Math.round(35 + (distKm - 6) * 4);
  return `${mn}–${mx} mins`;
}

export function calculateDeliveryFeeAndMinOrder(distKm, totalWeightKg = 0.5, perKmRate = 15) {
  const dist = distKm != null ? Math.max(0.5, distKm) : 1;
  const rate = (typeof perKmRate === 'number' && !isNaN(perKmRate) && perKmRate > 0) ? perKmRate : 15;
  const minOrder = 50; // Exact minimum order is ₹50
  const baseFee = Math.max(rate, Math.round(dist * rate)); // Distance charge: customizable per km (minimum 1 km fee)

  // Weight rule: First 2 kg free of extra weight surcharge;
  // for extra weight above 2 kg, charge ₹10 per km for the extra weight tier
  const extraWeightKg = Math.max(0, totalWeightKg - 2);
  const extraWeightTiers = extraWeightKg > 0 ? Math.ceil(extraWeightKg) : 0;
  const weightFee = extraWeightTiers > 0 ? Math.round(extraWeightTiers * (dist * 10)) : 0;

  return {
    minOrder,
    deliveryFee: baseFee + weightFee,
    baseFee,
    weightFee,
    extraWeightKg: Math.round(extraWeightKg * 10) / 10,
    distKm: distKm != null ? Math.round(dist * 10) / 10 : null,
    deliveryTime: getEstimatedDeliveryTime(distKm),
    perKmRate: rate
  };
}

// Cache reverse geocode result per session to avoid repeat API calls
let _geoCache = null;

/**
 * Calls Nominatim (OpenStreetMap) reverse geocoder.
 * Returns { town, region, country } or null on failure.
 */
async function reverseGeocode(lat, lng) {
  if (_geoCache && _geoCache.lat === lat && _geoCache.lng === lng) return _geoCache.result;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'ZuloraLocal/1.0 (zulora.help@gmail.com)' }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const addr = data.address || {};
    const town = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state_district || '';
    const region = addr.state || addr.region || '';
    const country = addr.country || '';
    const street = [addr.house_number, addr.road, addr.suburb || addr.neighbourhood].filter(Boolean).join(', ');
    const result = { town: town || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, region, country, street };
    _geoCache = { lat, lng, result };
    return result;
  } catch (e) {
    console.warn('[GeoCode] Nominatim reverse geocode failed:', e);
    return null;
  }
}

export async function getCurrentGpsPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async p => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        const accuracy = p.coords.accuracy;
        try {
          const geo = await reverseGeocode(lat, lng);
          resolve({
            lat, lng, accuracy,
            town: geo ? geo.town : `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            region: geo ? geo.region : '',
            country: geo ? geo.country : '',
            street: geo ? geo.street : '',
            isManual: false
          });
        } catch (_) {
          resolve({
            lat, lng, accuracy,
            town: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            region: '', country: '', street: '',
            isManual: false
          });
        }
      },
      err => {
        const saved = getSavedUserLocation();
        if (saved && saved.lat != null) resolve(saved);
        else reject(new Error('GPS permission denied or unavailable. Please enter your City/Town manually.'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

export function saveUserLocation(loc) {
  try {
    if (loc) localStorage.setItem('zulora_user_location', JSON.stringify(loc));
    else localStorage.removeItem('zulora_user_location');
  } catch (e) {}
}

export function getSavedUserLocation() {
  try {
    const raw = localStorage.getItem('zulora_user_location');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveUserProfile(profile) {
  try {
    if (profile) {
      const existing = getSavedUserProfile() || {};
      localStorage.setItem('zulora_user_profile', JSON.stringify({ ...existing, ...profile }));
    } else {
      localStorage.removeItem('zulora_user_profile');
    }
  } catch (e) {}
}

export function getSavedUserProfile() {
  try {
    const raw = localStorage.getItem('zulora_user_profile');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
