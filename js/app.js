/**
 * Zulora Local — Main Application Logic v2 (Clean & Production-Ready)
 * Real Firestore & Cloudinary data only — Zero fake/demo products.
 * Blinkit-inspired discovery, live search suggestions, product detail modal,
 * dual-role auth & smart multi-shop cart integration.
 */

import {
  db, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, increment,
  isConfigPlaceholder
} from './firebase-init.js';

import {
  initAuth, signInWithGoogle, signOutUser, getCurrentUser
} from './auth.js';

import {
  getCart, loadCartFromStorage, saveCartToStorage,
  addToCart as cartAdd, changeCartQty as cartChangeQty,
  clearCart, getCartTotals, groupCartByShop
} from './cart.js';

import {
  calculateHaversineDistance, calculateDeliveryFeeAndMinOrder,
  getCurrentGpsPosition, saveUserLocation, getSavedUserLocation,
  getEstimatedDeliveryTime
} from './geo-pricing.js';

import { PLATFORM_CONSTANTS } from './config.js';
import { promptPWAInstall } from './pwa.js';
import {
  addNotification, loadSavedNotifications, renderNotificationDrawer,
  markAllRead, notifyOrderStatus, showToast
} from './notifications.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let userLocation = getSavedUserLocation(); // null if not set yet
let allProducts = [];
let allShops = new Map();
let selectedCategory = 'All';
let searchQuery = '';
let nearbyFilterActive = false;
let allCustomCategories = new Set();

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateLocationUI();
  initAuth(handleUserAuthChange);
  loadCartFromStorage(allProducts);
  updateCartUI();
  loadPlatformData();
  loadSavedNotifications();
});

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  // Navigation & 3-Bar Hamburger Drawer
  document.getElementById('btnHamburgerMenu')?.addEventListener('click', openMenuDrawer);
  document.getElementById('btnCloseMenuDrawer')?.addEventListener('click', closeMenuDrawer);
  document.getElementById('topLocationPill')?.addEventListener('click', openLocationSetupModal);
  document.getElementById('navCartBtn')?.addEventListener('click', openCart);

  // Drawer Menu Navigation Links
  document.getElementById('menuItemLocation')?.addEventListener('click', () => {
    closeMenuDrawer();
    openLocationSetupModal();
  });
  document.getElementById('menuItemSettings')?.addEventListener('click', () => {
    closeMenuDrawer();
    openSettingsModal();
  });
  document.getElementById('menuItemAbout')?.addEventListener('click', () => {
    closeMenuDrawer();
    openAboutModal();
  });
  document.getElementById('menuItemTerms')?.addEventListener('click', () => {
    closeMenuDrawer();
    openTermsModal();
  });
  document.getElementById('drawerUserCard')?.addEventListener('click', () => {
    if (!currentUser) {
      closeMenuDrawer();
      openSignInModal();
    }
  });

  // Auth Modals & Actions
  document.getElementById('authBtn')?.addEventListener('click', openSignInModal);
  document.getElementById('btnCloseSignInModal')?.addEventListener('click', closeSignInModal);
  document.getElementById('modalGoogleSignInBtn')?.addEventListener('click', async () => {
    closeSignInModal();
    await handleSignInAction();
  });
  document.getElementById('signOutBtn')?.addEventListener('click', handleSignOutAction);

  // Informational Modals
  document.getElementById('btnCloseTermsModal')?.addEventListener('click', closeTermsModal);
  document.getElementById('btnAgreeTerms')?.addEventListener('click', closeTermsModal);
  document.getElementById('btnCloseSettingsModal')?.addEventListener('click', closeSettingsModal);
  document.getElementById('btnSettingsChangeLocation')?.addEventListener('click', () => {
    closeSettingsModal();
    openLocationSetupModal();
  });
  document.getElementById('btnSettingsEnablePush')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Notifications not supported in this browser.', 'warning');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      showToast('Push notifications enabled!', 'success');
      addNotification('🔔 You will now receive live order and deal notifications!', 'success');
    } else {
      showToast('Notification permission was not granted.', 'info');
    }
  });
  document.getElementById('btnCloseAboutUsModal')?.addEventListener('click', closeAboutModal);

  // Location Controls
  document.getElementById('btnDetectGps')?.addEventListener('click', handleDetectGps);
  document.getElementById('btnManualLocation')?.addEventListener('click', openLocationSetupModal);

  // Search & Live Suggestions (Debounced for 60fps Zero-Lag Speed)
  const searchInput = document.getElementById('searchInput');
  const suggestionsBox = document.getElementById('searchSuggestions');
  let searchDebounceTimer = null;

  searchInput?.addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderLiveSuggestions(searchQuery);
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      renderProducts();
    }, 120);
  });

  // Hide suggestions when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-hero')) {
      suggestionsBox?.classList.remove('show');
    }
  });

  // Filters
  document.getElementById('filterAllBtn')?.addEventListener('click', () => {
    nearbyFilterActive = false;
    document.getElementById('filterAllBtn')?.classList.add('active');
    document.getElementById('filterNearbyBtn')?.classList.remove('active');
    renderProducts();
  });

  document.getElementById('filterNearbyBtn')?.addEventListener('click', () => {
    if (!userLocation || userLocation.lat == null) {
      showToast('Please set your location first to filter nearby items.', 'warning');
      openLocationSetupModal();
      return;
    }
    nearbyFilterActive = true;
    document.getElementById('filterNearbyBtn')?.classList.add('active');
    document.getElementById('filterAllBtn')?.classList.remove('active');
    renderProducts();
  });

  // Category pills
  document.getElementById('categoryScroll')?.addEventListener('click', e => {
    const pill = e.target.closest('.category-pill');
    if (!pill) return;
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedCategory = pill.dataset.category || 'All';
    renderProducts();
  });

  // Cart Drawers
  document.getElementById('floatingCartBar')?.addEventListener('click', openCart);
  document.getElementById('btnOpenCart')?.addEventListener('click', openCart);
  document.getElementById('closeCartDrawer')?.addEventListener('click', closeCart);

  // Global Backdrop
  document.getElementById('drawerBackdrop')?.addEventListener('click', () => {
    closeCart();
    closeNotifDrawer();
    closeMenuDrawer();
  });

  // PWA
  document.getElementById('btnInstallApp')?.addEventListener('click', promptPWAInstall);
  document.getElementById('btnPwaInstall')?.addEventListener('click', promptPWAInstall);
  document.getElementById('btnPwaDismiss')?.addEventListener('click', () => {
    document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  });

  // Refresh
  document.getElementById('btnRefreshData')?.addEventListener('click', () => {
    loadPlatformData();
    showToast('Refreshing products…', 'info');
  });

  // Notifications Drawer
  document.getElementById('btnNotifBell')?.addEventListener('click', openNotifDrawer);
  document.getElementById('btnCloseNotifDrawer')?.addEventListener('click', closeNotifDrawer);
  document.getElementById('btnMarkAllRead')?.addEventListener('click', () => {
    markAllRead();
    renderNotificationDrawer();
  });
}

// ─── Menu Drawer Controls ─────────────────────────────────────────────────────
function openMenuDrawer() {
  const drawer = document.getElementById('menuDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) {
    drawer.classList.remove('hidden');
    // Force reflow for smooth CSS slide transition
    void drawer.offsetWidth;
    drawer.classList.add('open');
  }
  if (backdrop) backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeMenuDrawer() {
  const drawer = document.getElementById('menuDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
  setTimeout(() => drawer?.classList.add('hidden'), 280);
}

// ─── Modal Visibility Controls ────────────────────────────────────────────────
function openSignInModal() {
  document.getElementById('signInModal')?.classList.add('open');
}
function closeSignInModal() {
  document.getElementById('signInModal')?.classList.remove('open');
}

function openTermsModal() {
  document.getElementById('termsModal')?.classList.add('open');
}
function closeTermsModal() {
  document.getElementById('termsModal')?.classList.remove('open');
}
window.openTermsModal = openTermsModal;

function openSettingsModal() {
  const locDesc = document.getElementById('settingsLocationDesc');
  if (locDesc) {
    locDesc.textContent = (userLocation && userLocation.town) ? `Current: ${userLocation.town}` : 'Current: All Locations (Worldwide)';
  }
  document.getElementById('settingsModal')?.classList.add('open');
}
function closeSettingsModal() {
  document.getElementById('settingsModal')?.classList.remove('open');
}

function openAboutModal() {
  document.getElementById('aboutUsModal')?.classList.add('open');
}
function closeAboutModal() {
  document.getElementById('aboutUsModal')?.classList.remove('open');
}

// ─── Auth Handling ────────────────────────────────────────────────────────────
async function handleSignInAction() {
  await signInWithGoogle();
}

async function handleSignOutAction() {
  await signOutUser();
}

async function handleUserAuthChange(user) {
  currentUser = user;
  updateAuthUI(user);

  if (user && db && !isConfigPlaceholder) {
    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        const data = snap.data();
        if (data.location && (data.location.town || data.location.lat != null)) {
          userLocation = data.location;
          saveUserLocation(userLocation);
          updateLocationUI();
          renderProducts();
        } else if (!userLocation) {
          setTimeout(() => openLocationSetupModal(), 600);
        }
      } else {
        if (!userLocation) {
          setTimeout(() => openLocationSetupModal(), 600);
        }
      }
    } catch (e) {
      console.warn('[Firestore] User profile check:', e);
    }
  }
}

function updateAuthUI(user) {
  const authBtn = document.getElementById('authBtn');
  const userMenu = document.getElementById('userMenu');
  const navAdmin = document.getElementById('navAdminLink');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');

  // Drawer menu user card elements
  const drawerUserAvatar = document.getElementById('drawerUserAvatar');
  const drawerUserName = document.getElementById('drawerUserName');
  const drawerUserEmail = document.getElementById('drawerUserEmail');
  const drawerAdminLink = document.getElementById('drawerAdminLink');

  if (user) {
    authBtn?.classList.add('hidden');
    userMenu?.classList.remove('hidden');
    if (userAvatar) userAvatar.src = user.photoURL || PLATFORM_CONSTANTS.BRAND_LOGO_URL;
    if (userName) userName.textContent = user.displayName ? user.displayName.split(' ')[0] : 'Account';

    if (drawerUserAvatar) drawerUserAvatar.src = user.photoURL || PLATFORM_CONSTANTS.BRAND_LOGO_URL;
    if (drawerUserName) drawerUserName.textContent = user.displayName || 'Signed-In Shopper';
    if (drawerUserEmail) drawerUserEmail.textContent = user.email || 'Google Account Active';

    const isSupremeAdmin = user.email === PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL;
    if (navAdmin) navAdmin.classList.toggle('hidden', !isSupremeAdmin);
    if (drawerAdminLink) drawerAdminLink.classList.toggle('hidden', !isSupremeAdmin);
  } else {
    authBtn?.classList.remove('hidden');
    userMenu?.classList.add('hidden');
    if (navAdmin) navAdmin.classList.add('hidden');

    if (drawerUserAvatar) drawerUserAvatar.src = PLATFORM_CONSTANTS.BRAND_LOGO_URL;
    if (drawerUserName) drawerUserName.textContent = 'Welcome, Shopper!';
    if (drawerUserEmail) drawerUserEmail.textContent = 'Sign in to track orders & save address';
    if (drawerAdminLink) drawerAdminLink.classList.add('hidden');
  }
}

// ─── Location Engine ──────────────────────────────────────────────────────────
async function handleDetectGps() {
  const btn = document.getElementById('btnDetectGps');
  if (btn) btn.textContent = '⏳ Detecting…';
  try {
    const loc = await getCurrentGpsPosition();
    userLocation = { ...userLocation, ...loc };
    saveUserLocation(userLocation);
    updateLocationUI();
    renderProducts();
    await syncLocationToFirestore(userLocation);
    showToast('📍 GPS Location saved!', 'success');
  } catch (err) {
    showToast(err.message || 'Could not detect GPS location. Please enter manually.', 'warning');
    openLocationSetupModal();
  } finally {
    if (btn) btn.textContent = '🛰️ Detect GPS';
  }
}

function updateLocationUI() {
  const el = document.getElementById('locationTownText');
  const topEl = document.getElementById('topLocationText');

  const displayText = (userLocation && userLocation.town && userLocation.town !== 'Location not set')
    ? userLocation.town
    : ((userLocation && userLocation.lat != null) ? `${userLocation.lat.toFixed(3)}, ${userLocation.lng.toFixed(3)}` : 'Set Location');

  if (topEl) topEl.textContent = displayText;
  if (el) el.textContent = displayText === 'Set Location' ? 'All Locations (Worldwide)' : displayText;
}

async function syncLocationToFirestore(loc) {
  if (currentUser && db && !isConfigPlaceholder) {
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, { location: loc, updatedAt: serverTimestamp() });
    } catch (e) {
      console.warn('[Firestore] Location sync failed:', e);
    }
  }
}

export function openLocationSetupModal() {
  document.getElementById('locationSetupModal')?.remove();

  const curTown = userLocation?.town || '';
  const curRegion = userLocation?.region || '';
  const curStreet = userLocation?.street || '';
  const curPhone = userLocation?.phone || currentUser?.phoneNumber || '';

  const modal = document.createElement('div');
  modal.id = 'locationSetupModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Set Location" style="max-width:500px;">
      <div class="modal-header">
        <h3 style="font-size:1.1rem;font-weight:700;">📍 Set Your Delivery Location</h3>
        <button class="btn btn-icon" onclick="document.getElementById('locationSetupModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:1.1rem;">
        <p style="font-size:0.84rem;color:var(--slate-600);margin-bottom:1rem;line-height:1.45;">
          Capture your location to calculate exact ₹15/km delivery charges, estimated arrival times, and find nearest local merchants.
        </p>

        <button id="modalBtnGps" class="btn btn-primary btn-block" style="margin-bottom:1rem;padding:0.75rem;font-size:0.9rem;border-radius:var(--radius-full);">
          🛰️ Auto-Detect Current GPS Location
        </button>

        <div style="text-align:center;font-size:0.75rem;color:var(--slate-400);margin-bottom:1rem;font-weight:700;">— OR ENTER DOORSTEP ADDRESS —</div>

        <div style="display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1rem;">
          <div>
            <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;">City / Town / Village *</label>
            <input id="locTownInput" type="text" placeholder="e.g. Haldwani, Nainital or Village" value="${escapeHtml(curTown)}" style="width:100%;padding:0.6rem;border:1.5px solid var(--slate-300);border-radius:var(--radius-md);font-size:0.85rem;" />
          </div>

          <div>
            <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;">State / Region</label>
            <input id="locRegionInput" type="text" placeholder="e.g. Uttarakhand, Delhi NCR, Maharashtra" value="${escapeHtml(curRegion)}" style="width:100%;padding:0.6rem;border:1.5px solid var(--slate-300);border-radius:var(--radius-md);font-size:0.85rem;" />
          </div>

          <div>
            <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;">Street / Landmark / House No. *</label>
            <input id="locStreetInput" type="text" placeholder="e.g. Near Shiv Temple, Main Market, House #12" value="${escapeHtml(curStreet)}" style="width:100%;padding:0.6rem;border:1.5px solid var(--slate-300);border-radius:var(--radius-md);font-size:0.85rem;" />
          </div>

          <div>
            <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;">Mobile Phone Number</label>
            <input id="locPhoneInput" type="tel" placeholder="e.g. 9876543210" value="${escapeHtml(curPhone)}" style="width:100%;padding:0.6rem;border:1.5px solid var(--slate-300);border-radius:var(--radius-md);font-size:0.85rem;" />
          </div>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;">
        <button class="btn btn-ghost" onclick="document.getElementById('locationSetupModal').remove()">
          Browse Worldwide
        </button>
        <button id="modalBtnSaveManual" class="btn btn-secondary" style="font-weight:700;">
          Save Location ✓
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#modalBtnGps')?.addEventListener('click', async () => {
    const b = modal.querySelector('#modalBtnGps');
    if (b) b.textContent = '⏳ Detecting…';
    try {
      const loc = await getCurrentGpsPosition();
      userLocation = { ...userLocation, ...loc };
      saveUserLocation(userLocation);
      updateLocationUI();
      renderProducts();
      await syncLocationToFirestore(userLocation);
      showToast('📍 GPS Location saved!', 'success');
      modal.remove();
    } catch (e) {
      showToast(e.message || 'Could not detect GPS location.', 'warning');
      if (b) b.textContent = '🛰️ Auto-Detect Current GPS Location';
    }
  });

  modal.querySelector('#modalBtnSaveManual')?.addEventListener('click', async () => {
    const town = modal.querySelector('#locTownInput')?.value.trim();
    const region = modal.querySelector('#locRegionInput')?.value.trim();
    const street = modal.querySelector('#locStreetInput')?.value.trim();
    const phone = modal.querySelector('#locPhoneInput')?.value.trim();

    if (!town) {
      showToast('Please enter your City / Town / Village.', 'warning');
      return;
    }

    const fullAddress = `${street ? street + ', ' : ''}${town}${region ? ', ' + region : ''}`;
    userLocation = {
      ...(userLocation || {}),
      town,
      region,
      street,
      phone,
      address: fullAddress,
      isManual: true
    };
    saveUserLocation(userLocation);
    updateLocationUI();
    renderProducts();
    await syncLocationToFirestore(userLocation);
    showToast(`📍 Location set to "${town}"`, 'success');
    modal.remove();
  });
}

// ─── Real Firestore Products Load ─────────────────────────────────────────────
async function loadPlatformData() {
  showLoadingSkeleton();

  if (db && !isConfigPlaceholder) {
    try {
      // 1. Fetch real shops
      const shopsSnap = await getDocs(collection(db, 'shops'));
      allShops.clear();
      shopsSnap.forEach(d => {
        allShops.set(d.id, { id: d.id, ...d.data() });
      });

      // 2. Fetch real products
      const productsQuery = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
      const productsSnap = await getDocs(productsQuery);
      allProducts = [];
      allCustomCategories.clear();

      productsSnap.forEach(d => {
        const p = { id: d.id, ...d.data() };
        if (p.title && (p.price != null)) {
          allProducts.push(p);
          if (p.category && !PLATFORM_CONSTANTS.PRESET_CATEGORIES.includes(p.category)) {
            allCustomCategories.add(p.category);
          }
        }
      });
    } catch (err) {
      console.error('[Firestore] Real products fetch error:', err);
      allProducts = [];
    }
  } else {
    allProducts = [];
  }

  // Reload cart items matching real products
  loadCartFromStorage(allProducts);
  updateCartUI();

  renderProducts();
  addDynamicCategoryPills();
}

function addDynamicCategoryPills() {
  const scroll = document.getElementById('categoryScroll');
  if (!scroll) return;

  const existing = new Set(
    Array.from(scroll.querySelectorAll('.category-pill')).map(p => p.dataset.category)
  );

  allCustomCategories.forEach(cat => {
    if (!cat || existing.has(cat)) return;
    const pill = document.createElement('div');
    pill.className = 'category-pill';
    pill.dataset.category = cat;
    pill.setAttribute('role', 'listitem');
    pill.setAttribute('tabindex', '0');
    pill.textContent = `🏷️ ${cat}`;
    scroll.appendChild(pill);
  });
}

function showLoadingSkeleton() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  grid.innerHTML = Array(4).fill(0).map(() => `
    <div class="product-card skeleton-card" aria-hidden="true">
      <div class="card-image-wrap" style="background:#e2e8f0;"></div>
      <div style="padding:0.75rem;">
        <div style="width:70%;height:12px;background:#e2e8f0;margin-bottom:0.4rem;border-radius:4px;"></div>
        <div style="width:50%;height:10px;background:#e2e8f0;margin-bottom:0.5rem;border-radius:4px;"></div>
        <div style="width:30%;height:14px;background:#e2e8f0;border-radius:4px;"></div>
      </div>
    </div>
  `).join('');
  const countEl = document.getElementById('productCount');
  if (countEl) countEl.textContent = 'Loading products…';
}

// ─── Live Search Suggestions ──────────────────────────────────────────────────
function renderLiveSuggestions(query) {
  const box = document.getElementById('searchSuggestions');
  if (!box) return;

  if (!query || query.length < 2) {
    box.innerHTML = '';
    box.classList.remove('show');
    return;
  }

  const matches = allProducts.filter(p => {
    const shop = allShops.get(p.shopId);
    return (
      (p.title || '').toLowerCase().includes(query) ||
      (p.category || '').toLowerCase().includes(query) ||
      (shop?.name || '').toLowerCase().includes(query)
    );
  }).slice(0, 5);

  if (!matches.length) {
    box.innerHTML = '';
    box.classList.remove('show');
    return;
  }

  box.innerHTML = matches.map(p => `
    <div class="suggestion-item" onclick="window.selectSearchSuggestion('${escapeHtml(p.title)}')">
      <span>🔍 <strong>${escapeHtml(p.title)}</strong></span>
      <span style="color:var(--azure-600);font-weight:700;">₹${p.price}</span>
    </div>
  `).join('');
  box.classList.add('show');
}

window.selectSearchSuggestion = function(title) {
  const input = document.getElementById('searchInput');
  if (input) input.value = title;
  searchQuery = title.toLowerCase();
  document.getElementById('searchSuggestions')?.classList.remove('show');
  renderProducts();
};

// ─── Render Products (Zero Fake Products) ─────────────────────────────────────
function renderProducts() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  let filtered = allProducts.filter(p => {
    if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;

    if (searchQuery) {
      const shop = allShops.get(p.shopId);
      const haystack = [
        p.title || '',
        p.category || '',
        p.description || '',
        shop?.name || '',
        shop?.handle || ''
      ].join(' ').toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }

    if (nearbyFilterActive) {
      if (!userLocation || userLocation.lat == null || userLocation.lng == null) return true;
      const shop = allShops.get(p.shopId);
      if (!shop?.lat || !shop?.lng) return false;
      const dist = calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng);
      const radius = shop.deliveryRadiusKm ?? PLATFORM_CONSTANTS.DEFAULT_DELIVERY_RADIUS_KM;
      if (dist == null || dist > radius) return false;
    }

    return true;
  });

  // Sort: prioritize closer items if user location has lat/lng
  if (userLocation && userLocation.lat != null && userLocation.lng != null) {
    filtered.sort((a, b) => {
      const shopA = allShops.get(a.shopId);
      const shopB = allShops.get(b.shopId);
      const dA = shopA?.lat ? (calculateHaversineDistance(userLocation.lat, userLocation.lng, shopA.lat, shopA.lng) ?? 9999) : 9999;
      const dB = shopB?.lat ? (calculateHaversineDistance(userLocation.lat, userLocation.lng, shopB.lat, shopB.lng) ?? 9999) : 9999;
      return dA - dB;
    });
  }

  // Update product count label
  const countEl = document.getElementById('productCount');
  if (countEl) {
    if (allProducts.length === 0) {
      countEl.textContent = '0 products';
    } else if (filtered.length === 0) {
      countEl.textContent = 'No matching products';
    } else {
      const locationLabel = userLocation?.town ? `near ${userLocation.town}` : 'worldwide';
      countEl.textContent = `${filtered.length} product${filtered.length !== 1 ? 's' : ''} available ${locationLabel}`;
    }
  }

  // Clean empty state if platform has 0 real products
  if (allProducts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;text-align:center;padding:3.5rem 1rem;background:var(--pearl-glass-card);border:1px dashed var(--slate-300);border-radius:var(--radius-lg);margin:1rem auto;max-width:560px;">
        <div style="font-size:3.5rem;margin-bottom:0.75rem;">🛍️</div>
        <h3 style="color:var(--slate-800);font-size:1.25rem;font-weight:800;margin-bottom:0.5rem;">No products uploaded yet</h3>
        <p style="color:var(--slate-500);font-size:0.9rem;max-width:440px;margin:0 auto 1.5rem;line-height:1.5;">
          No products uploaded yet. Sign in and switch to Seller Mode to upload the first product to Cloudinary!
        </p>
        <a href="./seller.html" class="btn btn-primary btn-lg" style="display:inline-flex;align-items:center;gap:0.5rem;font-weight:700;">
          🛒 Switch to Seller Mode
        </a>
      </div>
    `;
    return;
  }

  // Filter empty state
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;text-align:center;padding:3rem 1rem;background:var(--pearl-glass-card);border-radius:var(--radius-lg);margin:1rem auto;max-width:480px;">
        <div style="font-size:3rem;margin-bottom:0.5rem;">🔍</div>
        <h3 style="color:var(--slate-700);font-size:1.15rem;font-weight:700;margin-bottom:0.5rem;">No matching products found</h3>
        <p style="color:var(--slate-500);font-size:0.85rem;margin-bottom:1.25rem;">
          Try clearing search or switching category filters.
        </p>
        <button class="btn btn-secondary btn-sm" onclick="window.resetFilters()">
          ↺ Reset Filters
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(product => buildProductCard(product)).join('');
}

window.resetFilters = function() {
  selectedCategory = 'All';
  searchQuery = '';
  nearbyFilterActive = false;
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  document.querySelectorAll('.category-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.category === 'All');
  });
  document.getElementById('filterAllBtn')?.classList.add('active');
  document.getElementById('filterNearbyBtn')?.classList.remove('active');
  renderProducts();
};

function buildProductCard(product) {
  const shop = allShops.get(product.shopId) || {};
  const isVerified = Boolean(shop.isVerified || product.isVerified);
  const isOpen = shop.isOpen !== false;
  const outOfStock = product.stock <= 0;
  const lowStock = product.stock > 0 && product.stock <= 5;

  const distKm = (userLocation?.lat != null && shop.lat != null)
    ? calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng)
    : null;
  const distLabel = distKm != null ? `📍 ${distKm} km` : '📍 Available';
  const timeLabel = `⚡ ${getEstimatedDeliveryTime(distKm)}`;

  const hasDiscount = product.mrp && product.mrp > product.price;
  const discountPct = hasDiscount ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;

  // Verified blue tick badge strictly 15px
  const verifiedBadgeHtml = isVerified
    ? `<img src="${escapeHtml(PLATFORM_CONSTANTS.VERIFIED_BADGE_URL)}" class="verified-badge-sm" title="Verified Seller" alt="✓" />`
    : '';

  const rawImages = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : (product.imageUrl ? [product.imageUrl] : ['https://via.placeholder.com/400x300?text=Product+Image']);

  let imageHtml;
  if (rawImages.length > 1) {
    const dots = rawImages.map((_, i) =>
      `<span class="carousel-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></span>`
    ).join('');
    imageHtml = `
      <div class="img-carousel" data-idx="0" data-product-id="${escapeHtml(product.id)}">
        <img class="carousel-img" src="${escapeHtml(rawImages[0])}" alt="${escapeHtml(product.title)}" loading="lazy" />
        <button class="carousel-prev" onclick="event.stopPropagation(); window.carouselPrev('${escapeHtml(product.id)}')" aria-label="Previous image">‹</button>
        <button class="carousel-next" onclick="event.stopPropagation(); window.carouselNext('${escapeHtml(product.id)}')" aria-label="Next image">›</button>
        <div class="carousel-dots">${dots}</div>
      </div>
    `;
  } else {
    imageHtml = `
      <div class="card-image-wrap">
        <img class="product-img" src="${escapeHtml(rawImages[0])}" alt="${escapeHtml(product.title)}" loading="lazy" />
      </div>
    `;
  }

  const cart = getCart();
  const qty = cart[product.id]?.qty || 0;
  const cartHtml = outOfStock
    ? `<button class="btn-add-cart btn-out-of-stock" disabled>Out of Stock</button>`
    : qty > 0
      ? `<div class="qty-pill">
           <button class="qty-btn" onclick="event.stopPropagation(); window.handleCartChange('${escapeHtml(product.id)}', -1)">−</button>
           <span class="qty-count">${qty}</span>
           <button class="qty-btn" onclick="event.stopPropagation(); window.handleCartChange('${escapeHtml(product.id)}', 1)">+</button>
         </div>`
      : `<button class="btn-add-cart" onclick="event.stopPropagation(); window.handleCartAdd('${escapeHtml(product.id)}')">🛒 Add</button>`;

  return `
    <div class="product-card" role="listitem" onclick="window.openProductDetailModal('${escapeHtml(product.id)}')">
      <div style="position:relative;width:100%;">
        ${imageHtml}
        <span class="badge badge-distance" style="position:absolute;top:6px;left:6px;z-index:2;">${distLabel}</span>
        <span class="badge badge-time" style="position:absolute;top:6px;right:6px;z-index:2;">${timeLabel}</span>
        <span class="badge badge-shop-status ${isOpen ? 'badge-open' : 'badge-closed'}" style="position:absolute;bottom:6px;left:6px;z-index:2;">
          ${isOpen ? '🟢 Open' : '🔴 Closed'}
        </span>
      </div>
      <div style="padding:0.75rem;display:flex;flex-direction:column;flex:1;">
        <div style="display:flex;align-items:center;gap:0.25rem;margin-bottom:0.2rem;">
          <span style="font-size:0.72rem;font-weight:700;color:var(--azure-700);">${escapeHtml(shop.name || 'Local Seller')}</span>
          ${verifiedBadgeHtml}
        </div>
        <h3 style="font-size:0.9rem;font-weight:700;color:var(--slate-900);line-height:1.25;margin-bottom:0.25rem;">${escapeHtml(product.title)}</h3>
        ${product.unit ? `<span style="font-size:0.72rem;color:var(--slate-400);margin-bottom:0.35rem;">${escapeHtml(product.unit)}</span>` : ''}
        <div style="display:flex;align-items:baseline;gap:0.35rem;margin-top:auto;margin-bottom:0.5rem;">
          <span style="font-size:1.05rem;font-weight:800;color:var(--slate-900);">₹${product.price}</span>
          ${hasDiscount ? `<span style="font-size:0.75rem;text-decoration:line-through;color:var(--slate-400);">₹${product.mrp}</span>` : ''}
          ${hasDiscount ? `<span style="font-size:0.72rem;font-weight:700;color:var(--emerald-600);">${discountPct}% off</span>` : ''}
        </div>
        ${lowStock ? `<p style="font-size:0.7rem;color:var(--rose-600);font-weight:600;margin-bottom:0.35rem;">⚠️ Only ${product.stock} left!</p>` : ''}
        <div id="cart_action_${escapeHtml(product.id)}" class="product-cart-action">${cartHtml}</div>
      </div>
    </div>
  `;
}

// ─── Product Detail Modal ─────────────────────────────────────────────────────
window.openProductDetailModal = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const shop = allShops.get(product.shopId) || {};
  const isVerified = Boolean(shop.isVerified || product.isVerified);
  const rawImages = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : (product.imageUrl ? [product.imageUrl] : ['https://via.placeholder.com/400x300?text=Product+Image']);

  const cleanPhone = (shop.phone || '').replace(/[^0-9]/g, '');
  const callUrl = cleanPhone ? `tel:+91${cleanPhone}` : `tel:${PLATFORM_CONSTANTS.HELPLINE_PHONE}`;
  const waPhone = cleanPhone ? (cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone) : PLATFORM_CONSTANTS.HELPLINE_WHATSAPP;
  const waMsg = encodeURIComponent(`Hi ${shop.name || 'Seller'}, I am interested in ordering "${product.title}" on Zulora Local.`);
  const waUrl = `https://wa.me/${waPhone}?text=${waMsg}`;
  const sellerEmail = shop.ownerEmail || shop.email || '';

  const distKm = (userLocation?.lat != null && shop.lat != null)
    ? calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng)
    : null;
  const eta = getEstimatedDeliveryTime(distKm);

  const hasDiscount = product.mrp && product.mrp > product.price;
  const discountPct = hasDiscount ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;

  document.getElementById('productDetailModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'productDetailModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box product-modal-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(product.title)}">
      <div class="modal-header">
        <h3 style="font-size:1.05rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(product.title)}
        </h3>
        <button class="btn btn-icon" onclick="document.getElementById('productDetailModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <!-- Gallery -->
        <div class="product-modal-gallery">
          <img id="detailHeroImg" src="${escapeHtml(rawImages[0])}" alt="${escapeHtml(product.title)}" />
        </div>
        ${rawImages.length > 1 ? `
          <div style="display:flex;gap:0.4rem;overflow-x:auto;margin-bottom:0.85rem;padding-bottom:0.25rem;">
            ${rawImages.map((img, i) => `
              <img src="${escapeHtml(img)}" onclick="document.getElementById('detailHeroImg').src='${escapeHtml(img)}'" style="width:52px;height:40px;border-radius:4px;object-fit:cover;cursor:pointer;border:1px solid var(--slate-300);" alt="Thumb ${i+1}" />
            `).join('')}
          </div>
        ` : ''}

        <div style="display:flex;align-items:center;gap:0.35rem;margin-bottom:0.4rem;">
          <span style="font-size:0.84rem;font-weight:700;color:var(--azure-700);">${escapeHtml(shop.name || 'Local Seller')}</span>
          ${isVerified ? `<img src="${PLATFORM_CONSTANTS.VERIFIED_BADGE_URL}" class="verified-badge-sm" alt="✓" />` : ''}
          <span class="badge" style="background:var(--slate-100);font-size:0.7rem;margin-left:auto;">${escapeHtml(product.category || 'General')}</span>
        </div>

        <div style="font-size:0.75rem;color:var(--azure-800);background:var(--azure-50);border:1px solid var(--azure-200);border-radius:var(--radius-sm);padding:0.4rem 0.6rem;margin-bottom:0.75rem;display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
          <span>📍 ${distKm != null ? `${distKm} km from you` : 'Hyperlocal Merchant'}</span>
          <span>•</span>
          <span>⚡ ${eta} delivery</span>
          ${sellerEmail ? `<span>• 📧 ${escapeHtml(sellerEmail)}</span>` : ''}
        </div>

        <div class="product-modal-pricing">
          <span class="product-modal-price">₹${product.price}</span>
          ${hasDiscount ? `<span class="product-modal-mrp">₹${product.mrp}</span>` : ''}
          ${hasDiscount ? `<span class="product-modal-discount">${discountPct}% off</span>` : ''}
        </div>

        <p class="product-modal-desc">${escapeHtml(product.description || 'Freshly prepared and packaged by verified local merchant for immediate doorstep delivery.')}</p>

        <div style="font-size:0.78rem;color:var(--slate-500);margin-bottom:1rem;display:flex;flex-direction:column;gap:0.25rem;">
          <span>📦 Weight/Unit: <strong>${escapeHtml(product.unit || '1 pc')}</strong> (${product.weightKg || 0.5} kg)</span>
          <span>📊 Availability: <strong>${product.stock > 0 ? `${product.stock} items left in stock` : 'Out of Stock'}</strong></span>
        </div>

        <div class="product-modal-actions">
          <a href="${callUrl}" class="btn btn-secondary btn-sm" style="flex:1;">
            📞 Call Seller
          </a>
          <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" style="flex:1;">
            💬 WhatsApp
          </a>
          <button class="btn btn-primary btn-sm" onclick="window.handleCartAdd('${escapeHtml(product.id)}'); document.getElementById('productDetailModal').remove();" style="flex:1.2;">
            🛒 Add to Cart
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

// ─── Carousel Controls ────────────────────────────────────────────────────────
window.carouselPrev = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  const images = Array.isArray(product.images) && product.images.length > 0 ? product.images : [product.imageUrl];
  if (!images || images.length <= 1) return;

  const carousel = document.querySelector(`.img-carousel[data-product-id="${productId}"]`);
  if (!carousel) return;

  let idx = parseInt(carousel.dataset.idx || '0', 10);
  idx = (idx - 1 + images.length) % images.length;
  carousel.dataset.idx = idx;
  const imgEl = carousel.querySelector('.carousel-img');
  if (imgEl) imgEl.src = images[idx];
  updateCarouselDots(carousel, idx);
};

window.carouselNext = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  const images = Array.isArray(product.images) && product.images.length > 0 ? product.images : [product.imageUrl];
  if (!images || images.length <= 1) return;

  const carousel = document.querySelector(`.img-carousel[data-product-id="${productId}"]`);
  if (!carousel) return;

  let idx = parseInt(carousel.dataset.idx || '0', 10);
  idx = (idx + 1) % images.length;
  carousel.dataset.idx = idx;
  const imgEl = carousel.querySelector('.carousel-img');
  if (imgEl) imgEl.src = images[idx];
  updateCarouselDots(carousel, idx);
};

function updateCarouselDots(carousel, activeIdx) {
  carousel.querySelectorAll('.carousel-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === activeIdx);
  });
}

// ─── Cart Integration ─────────────────────────────────────────────────────────
function updateCardStepperDOM(productId) {
  const container = document.getElementById(`cart_action_${productId}`);
  if (!container) return;
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  const outOfStock = product.stock <= 0;
  const cart = getCart();
  const qty = cart[productId]?.qty || 0;

  if (outOfStock) {
    container.innerHTML = `<button class="btn-add-cart btn-out-of-stock" disabled>Out of Stock</button>`;
  } else if (qty > 0) {
    container.innerHTML = `
      <div class="qty-pill">
        <button class="qty-btn" onclick="event.stopPropagation(); window.handleCartChange('${escapeHtml(productId)}', -1)">−</button>
        <span class="qty-count">${qty}</span>
        <button class="qty-btn" onclick="event.stopPropagation(); window.handleCartChange('${escapeHtml(productId)}', 1)">+</button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button class="btn-add-cart" onclick="event.stopPropagation(); window.handleCartAdd('${escapeHtml(productId)}')">🛒 Add</button>
    `;
  }
}
window.updateCardStepperDOM = updateCardStepperDOM;

window.handleCartAdd = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  cartAdd(product);
  updateCartUI();
  updateCardStepperDOM(productId);
};

window.handleCartChange = function(productId, delta) {
  cartChangeQty(productId, delta);
  updateCartUI();
  updateCardStepperDOM(productId);
};

function updateCartUI() {
  const { totalCount, totalPrice } = getCartTotals();
  const bar = document.getElementById('floatingCartBar');
  const countEl = document.getElementById('floatingCartCount');
  const totalEl = document.getElementById('floatingCartTotal');
  const navCountEl = document.getElementById('navCartCount');

  if (bar) bar.classList.toggle('hidden', totalCount === 0);
  if (countEl) countEl.textContent = totalCount;
  if (totalEl) totalEl.textContent = totalPrice.toFixed(2);
  if (navCountEl) {
    navCountEl.textContent = totalCount;
    navCountEl.style.display = totalCount > 0 ? 'inline-block' : 'none';
  }
}

function openCart() {
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';
  renderCartDrawerContent();
}

function closeCart() {
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
}

function renderCartDrawerContent() {
  const body = document.getElementById('cartDrawerBody');
  const footer = document.getElementById('cartDrawerFooter');
  if (!body || !footer) return;

  const groups = groupCartByShop(allShops, userLocation);
  const groupList = Object.entries(groups);

  if (groupList.length === 0) {
    body.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;">
        <div style="font-size:3rem;margin-bottom:0.75rem;">🛒</div>
        <p style="color:var(--slate-800);font-weight:700;font-size:1.05rem;margin-bottom:0.25rem;">Your cart is empty</p>
        <p style="color:var(--slate-500);font-size:0.85rem;">Discover neighbourhood items and start your order!</p>
      </div>
    `;
    footer.innerHTML = '';
    return;
  }

  let totalGrand = 0;
  let hasAnyShortfall = false;

  const shopSections = groupList.map(([shopId, group]) => {
    totalGrand += group.grandTotal;
    if (group.isBelowMinOrder) hasAnyShortfall = true;

    const rows = group.items.map(item => {
      const coverImg = Array.isArray(item.product.images) && item.product.images.length > 0
        ? item.product.images[0]
        : (item.product.imageUrl || 'https://via.placeholder.com/100x100?text=Item');
      return `
        <div style="display:flex;align-items:center;gap:0.65rem;padding:0.65rem 0;border-bottom:1px solid var(--slate-100);">
          <img src="${escapeHtml(coverImg)}" alt="${escapeHtml(item.product.title)}" style="width:48px;height:48px;border-radius:var(--radius-md);object-fit:cover;flex-shrink:0;" />
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.82rem;font-weight:700;color:var(--slate-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.product.title)}</div>
            ${item.product.unit ? `<div style="font-size:0.72rem;color:var(--slate-400);">${escapeHtml(item.product.unit)}</div>` : ''}
            <div style="font-size:0.82rem;font-weight:700;color:var(--slate-900);margin-top:0.15rem;">
              ₹${item.product.price} × ${item.qty} = ₹${(item.product.price * item.qty).toFixed(2)}
            </div>
          </div>
          <div class="qty-pill">
            <button class="qty-btn" onclick="window.handleCartChange('${escapeHtml(item.product.id)}', -1); window.renderCartDrawerContent();">−</button>
            <span class="qty-count">${item.qty}</span>
            <button class="qty-btn" onclick="window.handleCartChange('${escapeHtml(item.product.id)}', 1); window.renderCartDrawerContent();">+</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="background:var(--slate-50);border:1px solid var(--slate-200);border-radius:var(--radius-md);padding:0.85rem;margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;padding-bottom:0.4rem;border-bottom:1px solid var(--slate-200);">
          <div>
            <strong style="font-size:0.88rem;color:var(--slate-900);">${escapeHtml(group.shop.name || 'Local Seller')}</strong>
            <span style="display:block;font-size:0.7rem;color:var(--slate-400);">Self-Delivery by merchant</span>
          </div>
          <span style="font-size:0.75rem;font-weight:700;color:var(--azure-700);background:var(--azure-50);padding:0.2rem 0.5rem;border-radius:var(--radius-sm);">
            ${group.distKm ? `📍 ${group.distKm.toFixed(1)} km` : '📍 Local'}
          </span>
        </div>
        ${rows}
        <div style="margin-top:0.6rem;padding-top:0.5rem;border-top:1px dashed var(--slate-200);font-size:0.8rem;display:flex;flex-direction:column;gap:0.25rem;">
          <div style="display:flex;justify-content:space-between;color:var(--slate-600);">
            <span>Items Subtotal</span>
            <span>₹${group.shopTotal.toFixed(2)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;color:var(--slate-600);">
            <span>Distance Delivery Fee (${group.distKm ? group.distKm.toFixed(1) : 1} km @ ₹15/km)</span>
            <span>₹${(group.baseFee || 15).toFixed(2)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;color:var(--slate-600);">
            <span>Weight Surcharge (${(group.totalWeightKg || 0).toFixed(1)} kg, first 2 kg free)</span>
            <span>${group.weightFee > 0 ? `₹${group.weightFee.toFixed(2)}` : '<strong style="color:var(--emerald-600);">FREE</strong>'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-weight:700;color:var(--slate-900);margin-top:0.2rem;padding-top:0.2rem;border-top:1px solid var(--slate-200);">
            <span>Store Total</span>
            <strong style="color:var(--azure-800);">₹${group.grandTotal.toFixed(2)}</strong>
          </div>
        </div>
        ${group.isBelowMinOrder ? `
          <div style="background:#fffbeb;border:1px solid #fef3c7;border-radius:var(--radius-sm);padding:0.4rem 0.6rem;font-size:0.73rem;color:#b45309;margin-top:0.5rem;display:flex;align-items:center;gap:0.35rem;">
            <span>⚠️</span>
            <span>Minimum order for this store is <strong>₹${group.minOrder}</strong>. Please add <strong>₹${group.shortfall.toFixed(2)}</strong> more.</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  body.innerHTML = shopSections;
  footer.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;font-size:1.05rem;">
      <span style="font-weight:600;">Grand Total (incl. delivery):</span>
      <strong style="color:var(--azure-800);font-size:1.2rem;">₹${totalGrand.toFixed(2)}</strong>
    </div>
    ${hasAnyShortfall ? `
      <div style="background:#fef2f2;border:1px solid #fee2e2;border-radius:var(--radius-md);padding:0.5rem;font-size:0.75rem;color:#b91c1c;margin-bottom:0.6rem;text-align:center;">
        ⚠️ One or more stores in your cart do not meet the ₹50 minimum order threshold.
      </div>
    ` : ''}
    <button class="btn btn-primary btn-block" onclick="window.openCheckoutModal()" ${hasAnyShortfall ? 'disabled style="opacity:0.6;cursor:not-allowed;"' : ''} style="padding:0.75rem;font-size:0.95rem;font-weight:700;border-radius:var(--radius-full);">
      Proceed to Checkout →
    </button>
  `;
}
window.renderCartDrawerContent = renderCartDrawerContent;

// ─── Checkout & Order Placement ───────────────────────────────────────────────
window.openCheckoutModal = function() {
  document.getElementById('checkoutModal')?.remove();

  const groups = groupCartByShop(allShops, userLocation);
  const anyBelow = Object.values(groups).find(g => g.isBelowMinOrder);
  if (anyBelow) {
    showToast(`Order from "${anyBelow.shop.name || 'Store'}" is below the ₹50 minimum order value. Please add ₹${anyBelow.shortfall.toFixed(2)} more.`, 'warning');
    return;
  }

  const grandTotal = Object.values(groups).reduce((sum, g) => sum + g.grandTotal, 0);

  const qrSections = Object.entries(groups).map(([shopId, group]) => {
    const shop = group.shop;
    const shopTotal = group.grandTotal;
    const upiId = shop.upiId || '';
    const hasCustomQr = Boolean(shop.upiQrImageUrl);

    return `
      <div style="text-align:center;padding:0.75rem;border:1px solid var(--slate-200);border-radius:var(--radius-md);margin-bottom:0.65rem;background:#ffffff;">
        <div style="font-size:0.82rem;font-weight:700;margin-bottom:0.35rem;color:var(--slate-900);">${escapeHtml(shop.name || 'Seller')}</div>
        <div style="font-size:1rem;font-weight:800;color:var(--azure-800);margin-bottom:0.25rem;">₹${shopTotal.toFixed(2)}</div>
        ${hasCustomQr
          ? `<img src="${escapeHtml(shop.upiQrImageUrl)}" alt="UPI QR Code" style="width:140px;height:140px;margin:0.5rem auto;display:block;border-radius:var(--radius-sm);border:1px solid var(--slate-200);" />`
          : ''
        }
        ${upiId
          ? `<div style="margin-top:0.5rem;">
               <div style="font-size:0.75rem;color:var(--slate-500);margin-bottom:0.3rem;">UPI ID to pay:</div>
               <div style="display:inline-flex;align-items:center;gap:0.4rem;background:var(--slate-50);border:1.5px solid var(--azure-200);border-radius:var(--radius-md);padding:0.4rem 0.75rem;">
                 <span style="font-size:0.9rem;font-weight:700;color:var(--azure-800);font-family:monospace;">${escapeHtml(upiId)}</span>
                 <button onclick="navigator.clipboard.writeText('${escapeHtml(upiId)}').then(()=>{ const t=document.createElement('div'); t.style.cssText='position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);background:#0284C7;color:#fff;padding:0.5rem 1rem;border-radius:9999px;font-size:0.8rem;font-weight:700;z-index:9999;'; t.textContent='✓ UPI ID copied!'; document.body.appendChild(t); setTimeout(()=>t.remove(),1800); })" style="background:none;border:none;cursor:pointer;font-size:0.85rem;" title="Copy UPI ID">📋</button>
               </div>
             </div>`
          : `<div style="font-size:0.8rem;color:var(--slate-500);margin-top:0.4rem;">Contact seller for UPI payment details.</div>`
        }
      </div>
    `;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'checkoutModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Checkout">
      <div class="modal-header">
        <h3 style="font-size:1.1rem;font-weight:700;">🛍️ Complete Your Order</h3>
        <button class="btn btn-icon" onclick="document.getElementById('checkoutModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:1rem;">
        <label style="font-size:0.82rem;font-weight:700;display:block;margin-bottom:0.25rem;">Full Name *</label>
        <input id="coName" type="text" placeholder="Your name" value="${escapeHtml(currentUser?.displayName || '')}" style="width:100%;margin-bottom:0.65rem;padding:0.55rem;border:1px solid var(--slate-300);border-radius:var(--radius-md);font-size:0.85rem;" />

        <label style="font-size:0.82rem;font-weight:700;display:block;margin-bottom:0.25rem;">Mobile Phone *</label>
        <input id="coPhone" type="tel" placeholder="+91 XXXXXXXXXX" style="width:100%;margin-bottom:0.65rem;padding:0.55rem;border:1px solid var(--slate-300);border-radius:var(--radius-md);font-size:0.85rem;" />

        <label style="font-size:0.82rem;font-weight:700;display:block;margin-bottom:0.25rem;">Delivery Address / Landmark *</label>
        <textarea id="coAddress" rows="2" placeholder="House no, street, town, landmark" style="width:100%;margin-bottom:0.65rem;padding:0.55rem;border:1px solid var(--slate-300);border-radius:var(--radius-md);font-size:0.85rem;">${escapeHtml(userLocation?.town || '')}</textarea>

        <label style="font-size:0.82rem;font-weight:700;display:block;margin-bottom:0.25rem;">Payment Option *</label>
        <div style="display:flex;gap:1.5rem;margin-bottom:0.85rem;">
          <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem;cursor:pointer;">
            <input type="radio" name="coPayment" value="UPI" checked /> 💳 Direct UPI (Scan QR)
          </label>
          <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem;cursor:pointer;">
            <input type="radio" name="coPayment" value="COD" /> 💵 Cash on Delivery
          </label>
        </div>

        <div id="upiQrSection" style="margin-bottom:0.85rem;">
          <p style="font-size:0.75rem;color:var(--slate-500);margin-bottom:0.4rem;">
            Pay directly to seller via UPI:
          </p>
          ${qrSections}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.65rem;background:var(--azure-50);border-radius:var(--radius-md);margin-bottom:0.75rem;">
          <span style="font-size:0.85rem;color:var(--azure-900);font-weight:700;">Total Amount:</span>
          <strong style="font-size:1.1rem;color:var(--azure-800);">₹${grandTotal.toFixed(2)}</strong>
        </div>

        <p style="font-size:0.73rem;color:var(--slate-500);text-align:center;margin:0;">
          By placing an order, you agree to the <a href="#" onclick="window.openTermsModal();return false;" style="color:var(--azure-600);text-decoration:underline;">Zulora Terms & Conditions</a> and Merchant Self-Delivery Policy.
        </p>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;">
        <button class="btn btn-ghost" onclick="document.getElementById('checkoutModal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="window.executeOrderPlacement()">Place Order ✓</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('input[name="coPayment"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const upiSec = document.getElementById('upiQrSection');
      if (upiSec) upiSec.style.display = radio.value === 'UPI' ? 'block' : 'none';
    });
  });
};

window.executeOrderPlacement = async function() {
  const name = document.getElementById('coName')?.value.trim();
  const phone = document.getElementById('coPhone')?.value.trim();
  const address = document.getElementById('coAddress')?.value.trim();
  const paymentEl = document.querySelector('input[name="coPayment"]:checked');
  const payment = paymentEl?.value || 'COD';

  if (!name) { showToast('Please enter your name.', 'warning'); return; }
  if (!phone || phone.length < 7) { showToast('Please enter a valid phone number.', 'warning'); return; }
  if (!address) { showToast('Please enter your delivery address.', 'warning'); return; }

  const groups = groupCartByShop(allShops, userLocation);
  const anyBelow = Object.values(groups).find(g => g.isBelowMinOrder);
  if (anyBelow) {
    showToast(`Order from "${anyBelow.shop.name || 'Store'}" is below the ₹50 minimum order value. Please add ₹${anyBelow.shortfall.toFixed(2)} more.`, 'warning');
    return;
  }

  const orderIds = [];

  for (const [shopId, group] of Object.entries(groups)) {
    const shop = group.shop;
    const shopTotal = group.grandTotal;

    const orderData = {
      orderId: 'ZUL-' + Math.floor(100000 + Math.random() * 900000),
      buyerName: name,
      buyerPhone: phone,
      buyerAddress: address,
      buyerUid: currentUser?.uid || 'guest',
      shopId,
      shopName: shop.name || 'Local Seller',
      sellerPhone: shop.phone || '',
      sellerEmail: shop.email || '',
      items: group.items.map(i => ({
        productId: i.product.id,
        title: i.product.title,
        qty: i.qty,
        quantity: i.qty,
        price: i.product.price,
        unit: i.product.unit || '',
        weightKg: i.product.weightKg || 0.5
      })),
      itemsSubtotal: group.shopTotal,
      baseDeliveryFee: group.baseFee,
      weightFee: group.weightFee,
      totalWeightKg: group.totalWeightKg,
      distKm: group.distKm,
      deliveryFee: group.deliveryFee,
      grandTotal: shopTotal,
      totalAmount: shopTotal,
      paymentMode: payment,
      orderStatus: 'Placed',
      buyerDeliveredConfirmed: false,
      deliveryModel: 'Self-Delivery (Merchant)',
      cancelableUntil: Date.now() + 5 * 60 * 1000,
      createdAt: serverTimestamp()
    };

    let docId = 'ORD-' + Date.now();
    if (db && !isConfigPlaceholder) {
      try {
        const ref = await addDoc(collection(db, 'orders'), orderData);
        docId = ref.id;

        for (const item of group.items) {
          try {
            const pRef = doc(db, 'products', item.product.id);
            await updateDoc(pRef, {
              stock: increment(-item.qty),
              salesCount: increment(item.qty)
            });
          } catch (e) {}
        }
      } catch (err) {
        console.warn('[Firestore] Order placement save error:', err);
      }
    }

    orderIds.push({ orderId: orderData.orderId, docId, shop, orderData });
    notifyOrderStatus(orderData.orderId, 'Placed');
  }

  // Clear cart
  clearCart();
  updateCartUI();

  document.getElementById('checkoutModal')?.remove();
  closeCart();
  renderProducts();
  showOrderSuccessModal(orderIds, { name, phone, address, payment });
};

function showOrderSuccessModal(orderIds, buyer) {
  document.getElementById('orderSuccessModal')?.remove();

  const waLinks = orderIds.map(({ orderId, shop, orderData }) => {
    const waNum = (shop.whatsapp || shop.phone || PLATFORM_CONSTANTS.HELPLINE_WHATSAPP).replace(/[^0-9]/g, '');
    const cleanNum = waNum.startsWith('91') ? waNum : '91' + waNum;
    const msg = encodeURIComponent(
      `🛒 *New Order on Zulora Local (#${orderId})*\n\n` +
      `👤 *Buyer:* ${buyer.name} (${buyer.phone})\n` +
      `📍 *Address:* ${buyer.address}\n` +
      `💵 *Payment:* ${buyer.payment}\n` +
      `💰 *Total:* ₹${orderData.totalAmount}\n\n` +
      `📦 *Items:*\n` +
      orderData.items.map(i => `• ${i.title} (${i.unit}) x ${i.qty} - ₹${i.price * i.qty}`).join('\n')
    );
    return `<a href="https://wa.me/${cleanNum}?text=${msg}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp" style="padding:0.6rem 1rem;font-weight:700;">
      💬 WhatsApp ${escapeHtml(shop.name || 'Seller')}
    </a>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'orderSuccessModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Order Placed">
      <div class="modal-header" style="background:var(--emerald-50,#ecfdf5);">
        <h3 style="color:var(--emerald-700,#047857);font-size:1.1rem;font-weight:700;">🎉 Order Placed Successfully!</h3>
        <button class="btn btn-icon" onclick="document.getElementById('orderSuccessModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="text-align:center;padding:1.5rem 1rem;">
        <div style="font-size:3.5rem;margin-bottom:0.75rem;">✅</div>
        <p style="font-size:0.95rem;color:var(--slate-800);margin-bottom:0.4rem;">
          Thank you, <strong>${escapeHtml(buyer.name)}</strong>!
        </p>
        <p style="font-size:0.82rem;color:var(--slate-500);margin-bottom:1.25rem;">
          Your order has been transmitted directly to the merchant.
        </p>
        <div style="display:flex;flex-direction:column;gap:0.55rem;">
          ${waLinks}
          <a href="./orders.html" class="btn btn-primary" style="padding:0.6rem 1rem;font-weight:700;">
            📦 Track My Orders
          </a>
          <a href="tel:${PLATFORM_CONSTANTS.HELPLINE_PHONE}" class="btn btn-ghost" style="font-size:0.8rem;">
            📞 Support: ${PLATFORM_CONSTANTS.HELPLINE_PHONE_DISPLAY}
          </a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ─── Notification Drawer ───────────────────────────────────────────────────────
function openNotifDrawer() {
  document.getElementById('notifDrawer')?.classList.remove('hidden');
  document.getElementById('drawerBackdrop')?.classList.add('active');
  renderNotificationDrawer();
  document.body.style.overflow = 'hidden';
}

function closeNotifDrawer() {
  document.getElementById('notifDrawer')?.classList.add('hidden');
  document.getElementById('drawerBackdrop')?.classList.remove('active');
  document.body.style.overflow = '';
}

// ─── XSS-safe helper ─────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
