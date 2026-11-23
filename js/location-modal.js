/**
 * Zulora Local — Modular Location Selection Engine (js/location-modal.js)
 * City / Town / Village precision, manual address & phone capture,
 * GPS auto-detect and Firestore synchronization.
 */

import { getCurrentGpsPosition, saveUserLocation } from './geo-pricing.js';
import { showToast } from './notifications.js';

/**
 * Open the City / Village & Doorstep Delivery Location Modal
 */
export function openLocationSetupModal({
  currentLocation = null,
  currentUser = null,
  db = null,
  isConfigPlaceholder = false,
  onLocationSaved = null
} = {}) {
  document.getElementById('locationSetupModal')?.remove();

  const curTown = currentLocation?.town && currentLocation.town !== 'All Locations' ? currentLocation.town : '';
  const curRegion = currentLocation?.region || '';
  const curStreet = currentLocation?.street || '';
  const curPhone = currentLocation?.phone || currentUser?.phoneNumber || '';

  const modal = document.createElement('div');
  modal.id = 'locationSetupModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Set Delivery Location" style="max-width:500px;">
      <div class="modal-header">
        <h3 style="font-size:1.1rem;font-weight:800;color:var(--slate-900);">📍 Set Your Delivery Location</h3>
        <button class="btn btn-icon" id="btnCloseLocModal" aria-label="Close">✕</button>
      </div>
      <div class="modal-body" style="padding:1.25rem;">
        <p style="font-size:0.84rem;color:var(--slate-600);margin-bottom:1rem;line-height:1.45;">
          Select your City, Town, or Village so we can calculate exact ₹15/km delivery charges, estimated arrival times, and find nearest neighbourhood stores.
        </p>

        <button id="modalBtnGps" class="btn btn-primary btn-block" style="margin-bottom:1.1rem;padding:0.75rem;font-size:0.9rem;border-radius:var(--radius-full);background:var(--azure-600);">
          🛰️ Auto-Detect Current GPS Location
        </button>

        <div style="text-align:center;font-size:0.75rem;color:var(--slate-400);margin-bottom:1rem;font-weight:700;">
          — OR ENTER CITY / VILLAGE &amp; ADDRESS —
        </div>

        <div style="display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1rem;">
          <div>
            <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;color:var(--slate-700);">
              City / Town / Village *
            </label>
            <input id="locTownInput" type="text" placeholder="e.g. Haldwani, Nainital, Rampur, or Village" value="${escapeHtml(curTown)}" style="width:100%;padding:0.6rem 0.85rem;border:1.5px solid var(--border-subtle);border-radius:var(--radius-sm);font-size:0.88rem;" />
          </div>

          <div>
            <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;color:var(--slate-700);">
              State / Region
            </label>
            <input id="locRegionInput" type="text" placeholder="e.g. Uttarakhand, Uttar Pradesh, Delhi NCR" value="${escapeHtml(curRegion)}" style="width:100%;padding:0.6rem 0.85rem;border:1.5px solid var(--border-subtle);border-radius:var(--radius-sm);font-size:0.88rem;" />
          </div>

          <div>
            <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;color:var(--slate-700);">
              Street / Landmark / House No. *
            </label>
            <input id="locStreetInput" type="text" placeholder="e.g. Near Shiv Temple, Main Bazaar, House #14" value="${escapeHtml(curStreet)}" style="width:100%;padding:0.6rem 0.85rem;border:1.5px solid var(--border-subtle);border-radius:var(--radius-sm);font-size:0.88rem;" />
          </div>

          <div>
            <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;color:var(--slate-700);">
              Mobile Phone Number (for Delivery)
            </label>
            <input id="locPhoneInput" type="tel" placeholder="e.g. 9876543210" value="${escapeHtml(curPhone)}" style="width:100%;padding:0.6rem 0.85rem;border:1.5px solid var(--border-subtle);border-radius:var(--radius-sm);font-size:0.88rem;" />
          </div>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;">
        <button class="btn btn-ghost" id="btnBrowseAllLocs">
          Browse All Locations
        </button>
        <button id="modalBtnSaveManual" class="btn btn-primary" style="font-weight:700;background:var(--emerald-600);border-color:var(--emerald-600);">
          Save Location ✓
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close handlers
  modal.querySelector('#btnCloseLocModal')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#btnBrowseAllLocs')?.addEventListener('click', () => {
    modal.remove();
  });

  // GPS Auto-detect
  const gpsBtn = modal.querySelector('#modalBtnGps');
  gpsBtn?.addEventListener('click', async () => {
    gpsBtn.textContent = '⏳ Detecting & resolving city name…';
    try {
      const loc = await getCurrentGpsPosition();
      const newLoc = { ...(currentLocation || {}), ...loc };
      saveUserLocation(newLoc);
      if (onLocationSaved) onLocationSaved(newLoc);
      await syncLocationToFirestore(newLoc, currentUser, db, isConfigPlaceholder);
      showToast(`📍 Location set to "${loc.town || 'your area'}"`, 'success');
      modal.remove();
    } catch (e) {
      showToast(e.message || 'Could not detect GPS location. Please enter manually.', 'warning');
      gpsBtn.textContent = '🛰️ Auto-Detect Current GPS Location';
    }
  });

  // Manual save
  modal.querySelector('#modalBtnSaveManual')?.addEventListener('click', async () => {
    const town = modal.querySelector('#locTownInput')?.value.trim();
    const region = modal.querySelector('#locRegionInput')?.value.trim();
    const street = modal.querySelector('#locStreetInput')?.value.trim();
    const phone = modal.querySelector('#locPhoneInput')?.value.trim();

    if (!town) {
      showToast('Please enter your City / Town / Village name.', 'warning');
      return;
    }

    const fullAddress = `${street ? street + ', ' : ''}${town}${region ? ', ' + region : ''}`;
    const newLoc = {
      ...(currentLocation || {}),
      town,
      region,
      street,
      phone,
      address: fullAddress,
      isManual: true
    };

    saveUserLocation(newLoc);
    if (onLocationSaved) onLocationSaved(newLoc);
    await syncLocationToFirestore(newLoc, currentUser, db, isConfigPlaceholder);
    showToast(`📍 Location set to "${town}"`, 'success');
    modal.remove();
  });
}

async function syncLocationToFirestore(loc, currentUser, db, isConfigPlaceholder) {
  if (currentUser && db && !isConfigPlaceholder) {
    try {
      const { doc, updateDoc, serverTimestamp } = await import('./firebase-init.js');
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, { location: loc, updatedAt: serverTimestamp() });
    } catch (e) {
      console.warn('[Location] Firestore user sync notice:', e);
    }
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
