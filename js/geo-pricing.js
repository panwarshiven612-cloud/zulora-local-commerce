/**
 * Zulora Local — Hyperlocal Geo-Pricing Engine v2
 */
import { PLATFORM_CONSTANTS } from './config.js';

export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 10) / 10;
}

function toRad(d) { return d * Math.PI / 180; }

export function getEstimatedDeliveryTime(distKm) {
  if (distKm == null) return 'Fast Delivery';
  if (distKm <= 1)  return '10–15 mins';
  if (distKm <= 2)  return '15–20 mins';
  if (distKm <= 6)  return '20–30 mins';
  const mn = Math.round(25 + (distKm-6)*3), mx = Math.round(35 + (distKm-6)*4);
  return `${mn}–${mx} mins`;
}

export function calculateDeliveryFeeAndMinOrder(distKm, totalWeightKg = 0.5) {
  const dist = distKm != null ? Math.max(0.2, distKm) : 1;
  let minOrder = 50, baseFee = 15, weightFee = 0;
  if (dist <= 1) { minOrder = 50; baseFee = 15; }
  else if (dist <= 2) { minOrder = 100; baseFee = Math.max(15, Math.round(dist * 15)); }
  else { minOrder = 150; baseFee = Math.round(dist * 15); }
  if (totalWeightKg > 2) weightFee = Math.ceil(totalWeightKg - 2) * 10;
  return {
    minOrder,
    deliveryFee: baseFee + weightFee,
    baseFee,
    weightFee,
    distKm: distKm != null ? dist : null,
    deliveryTime: getEstimatedDeliveryTime(distKm)
  };
}

export function getCurrentGpsPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      p => resolve({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        town: `${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`,
        isManual: false
      }),
      err => {
        const saved = getSavedUserLocation();
        if (saved && saved.lat != null) resolve(saved);
        else reject(new Error('GPS permission denied or unavailable. Please enter your location manually.'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

export function saveUserLocation(loc) {
  try {
    if (loc) localStorage.setItem('zulora_user_location', JSON.stringify(loc));
    else localStorage.removeItem('zulora_user_location');
  } catch(e) {}
}

export function getSavedUserLocation() {
  try {
    const raw = localStorage.getItem('zulora_user_location');
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    return null;
  }
}
