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
  if (distKm == null) return '15–25 mins';
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
  return { minOrder, deliveryFee: baseFee + weightFee, baseFee, weightFee,
           distKm: dist, deliveryTime: getEstimatedDeliveryTime(dist) };
}

export function getCurrentGpsPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation not supported.')); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, isManual: false }),
      err => {
        const saved = getSavedUserLocation();
        if (saved) resolve(saved);
        else resolve({ lat: PLATFORM_CONSTANTS.DEFAULT_LAT, lng: PLATFORM_CONSTANTS.DEFAULT_LNG, town: PLATFORM_CONSTANTS.DEFAULT_TOWN, isManual: true, isFallback: true });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

export function saveUserLocation(loc) {
  try { localStorage.setItem('zulora_user_location', JSON.stringify(loc)); } catch(e) {}
}

export function getSavedUserLocation() {
  try { return JSON.parse(localStorage.getItem('zulora_user_location') || 'null'); } catch(e) { return null; }
}
