/**
 * Zulora Local — Main Application Logic v2 (Clean & Production-Ready)
 * Real Firestore data only — Zero fake/demo products.
 * Strict image sizing, zero horizontal overflow, Google Auth, GPS & manual location.
 */

import {
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, increment,
  isConfigPlaceholder
} from './firebase-init.js';

import {
  calculateHaversineDistance, calculateDeliveryFeeAndMinOrder,
  getCurrentGpsPosition, saveUserLocation, getSavedUserLocation,
  getEstimatedDeliveryTime
} from './geo-pricing.js';

import { PLATFORM_CONSTANTS } from './config.js';
import { promptPWAInstall } from './pwa.js';
import {
  addNotification, loadSavedNotifications, renderNotificationDrawer,
  markAllRead, startCartReminder, clearCartReminder,
  notifyOrderStatus, showToast
} from './notifications.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let userLocation = getSavedUserLocation(); // null if not set yet
let allProducts = [];
let allShops = new Map();
let cart = {};
let selectedCategory = 'All';
let searchQuery = '';
let nearbyFilterActive = false;
let allCustomCategories = new Set();

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateLocationUI();
  initAuthListener();
  loadCartFromStorage();
  loadPlatformData();
  loadSavedNotifications();
});

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  // Auth
  document.getElementById('authBtn')?.addEventListener('click', handleAuthAction);
  document.getElementById('signOutBtn')?.addEventListener('click', handleSignOut);

  // Location
  document.getElementById('btnDetectGps')?.addEventListener('click', handleDetectGps);
  document.getElementById('btnManualLocation')?.addEventListener('click', handleManualLocationPrompt);

  // Search
  document.getElementById('searchInput')?.addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderProducts();
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

  // Category pills (event delegation)
  document.getElementById('categoryScroll')?.addEventListener('click', e => {
    const pill = e.target.closest('.category-pill');
    if (!pill) return;
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedCategory = pill.dataset.category || 'All';
    renderProducts();
  });

  // Cart
  document.getElementById('floatingCartBar')?.addEventListener('click', openCart);
  document.getElementById('btnOpenCart')?.addEventListener('click', openCart);
  document.getElementById('closeCartDrawer')?.addEventListener('click', closeCart);

  // Drawer Backdrop
  document.getElementById('drawerBackdrop')?.addEventListener('click', () => {
    closeCart();
    closeNotifDrawer();
  });

  // PWA
  document.getElementById('btnInstallApp')?.addEventListener('click', promptPWAInstall);
  document.getElementById('btnPwaInstall')?.addEventListener('click', promptPWAInstall);
  document.getElementById('btnPwaBannerInstall')?.addEventListener('click', promptPWAInstall);
  document.getElementById('btnPwaBannerDismiss')?.addEventListener('click', () => {
    document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  });
  document.getElementById('btnPwaDismiss')?.addEventListener('click', () => {
    document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  });

  // Refresh
  document.getElementById('btnRefreshData')?.addEventListener('click', () => {
    loadPlatformData();
    showToast('Refreshing products…', 'info');
  });

  // Notifications
  document.getElementById('btnNotifBell')?.addEventListener('click', openNotifDrawer);
  document.getElementById('btnCloseNotifDrawer')?.addEventListener('click', closeNotifDrawer);
  document.getElementById('btnMarkAllRead')?.addEventListener('click', () => {
    markAllRead();
    renderNotificationDrawer();
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function initAuthListener() {
  if (!auth || isConfigPlaceholder) {
    updateAuthUI(null);
    return;
  }

  onAuthStateChanged(auth, async user => {
    currentUser = user;
    updateAuthUI(user);

    if (user) {
      // Admin link visibility
      const navAdmin = document.getElementById('navAdminLink');
      if (navAdmin) {
        navAdmin.classList.toggle('hidden', user.email !== PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL);
      }

      // Sync user profile and check for location
      if (db) {
        try {
          const userRef = doc(db, 'users', user.uid);
          const snap = await getDoc(userRef);

          if (snap.exists()) {
            const data = snap.data();
            if (data.location && data.location.town) {
              userLocation = data.location;
              saveUserLocation(userLocation);
              updateLocationUI();
              renderProducts();
            } else if (!userLocation) {
              // User has logged in but has never set a location
              setTimeout(() => openLocationSetupModal(), 800);
            }
            await updateDoc(userRef, {
              displayName: user.displayName || '',
              email: user.email || '',
              photoURL: user.photoURL || '',
              lastLogin: serverTimestamp()
            });
          } else {
            // New user registration in Firestore
            const newPayload = {
              uid: user.uid,
              displayName: user.displayName || '',
              email: user.email || '',
              photoURL: user.photoURL || '',
              createdAt: serverTimestamp(),
              lastLogin: serverTimestamp()
            };
            if (userLocation) {
              newPayload.location = userLocation;
            }
            await setDoc(userRef, newPayload);

            if (!userLocation) {
              setTimeout(() => openLocationSetupModal(), 800);
            }
          }
        } catch (err) {
          console.warn('[Firestore] User sync error:', err);
        }
      }
    }
  });
}

function updateAuthUI(user) {
  const authBtn = document.getElementById('authBtn');
  const userMenu = document.getElementById('userMenu');
  const navAdmin = document.getElementById('navAdminLink');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');

  if (user) {
    authBtn?.classList.add('hidden');
    userMenu?.classList.remove('hidden');
    if (userAvatar) userAvatar.src = user.photoURL || PLATFORM_CONSTANTS.BRAND_LOGO_URL;
    if (userName) userName.textContent = user.displayName ? user.displayName.split(' ')[0] : 'Account';
    if (navAdmin) {
      navAdmin.classList.toggle('hidden', user.email !== PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL);
    }
  } else {
    authBtn?.classList.remove('hidden');
    userMenu?.classList.add('hidden');
    if (navAdmin) navAdmin.classList.add('hidden');
  }
}

async function handleAuthAction() {
  if (!auth || isConfigPlaceholder) {
    showToast('Firebase authentication is initializing or offline.', 'warning');
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
    showToast('Signed in successfully!', 'success');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Sign-in failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }
}

async function handleSignOut() {
  if (auth && !isConfigPlaceholder) {
    try {
      await signOut(auth);
      currentUser = null;
      updateAuthUI(null);
      showToast('Signed out successfully.', 'info');
    } catch (err) {
      console.error('[Auth] Sign-out error:', err);
    }
  }
}

// ─── Location Handling ────────────────────────────────────────────────────────
async function handleDetectGps() {
  const btn = document.getElementById('btnDetectGps');
  if (btn) btn.textContent = '⏳ Detecting…';
  try {
    const loc = await getCurrentGpsPosition();
    userLocation = loc;
    saveUserLocation(loc);
    updateLocationUI();
    renderProducts();
    await syncLocationToFirestore(loc);
    showToast('📍 Location updated via GPS!', 'success');
  } catch (err) {
    showToast(err.message || 'Could not detect GPS location. Please enter manually.', 'warning');
    openLocationSetupModal();
  } finally {
    if (btn) btn.textContent = '🛰️ Detect GPS';
  }
}

function handleManualLocationPrompt() {
  openLocationSetupModal();
}

function updateLocationUI() {
  const el = document.getElementById('locationTownText');
  if (!el) return;

  if (userLocation && userLocation.town && userLocation.town !== 'Location not set') {
    el.textContent = userLocation.town;
  } else if (userLocation && userLocation.lat != null && userLocation.lng != null) {
    el.textContent = `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
  } else {
    el.textContent = 'All Locations (Worldwide)';
  }
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

function openLocationSetupModal() {
  document.getElementById('locationSetupModal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'locationSetupModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Set Location">
      <div class="modal-header">
        <h3 style="font-size:1.15rem;font-weight:700;color:var(--slate-900);">📍 Set Delivery Location</h3>
        <button class="btn btn-icon" onclick="document.getElementById('locationSetupModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:1.25rem 1rem;">
        <p style="font-size:0.9rem;color:var(--slate-600);margin-bottom:1.25rem;line-height:1.5;">
          Set your local location to discover neighbourhood shops, see real-time delivery estimates, and enable instant doorstep delivery.
        </p>
        <button id="modalBtnGps" class="btn btn-primary btn-block" style="margin-bottom:1rem;display:flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.75rem;">
          🛰️ Detect GPS Location
        </button>
        <div style="text-align:center;font-size:0.8rem;color:var(--slate-400);margin-bottom:1rem;font-weight:600;">— OR ENTER MANUALLY —</div>
        <div class="form-group" style="margin-bottom:1rem;">
          <label class="form-label" for="manualTownInput" style="font-size:0.85rem;font-weight:600;color:var(--slate-700);display:block;margin-bottom:0.4rem;">
            Town, Village, City, or Landmark
          </label>
          <input
            id="manualTownInput"
            type="text"
            class="form-input"
            placeholder="e.g. Indiranagar, Bengaluru or Village Name"
            style="width:100%;padding:0.65rem 0.85rem;border:1px solid var(--slate-300);border-radius:var(--radius-md);font-size:0.9rem;"
          />
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;gap:0.75rem;">
        <button class="btn btn-ghost" onclick="document.getElementById('locationSetupModal').remove()">
          Browse Worldwide
        </button>
        <button id="modalBtnSaveManual" class="btn btn-secondary">
          Save Location
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
      userLocation = loc;
      saveUserLocation(loc);
      updateLocationUI();
      renderProducts();
      await syncLocationToFirestore(loc);
      showToast('📍 GPS Location saved!', 'success');
      modal.remove();
    } catch (e) {
      showToast(e.message || 'Could not detect GPS location.', 'warning');
      if (b) b.textContent = '🛰️ Detect GPS Location';
    }
  });

  modal.querySelector('#modalBtnSaveManual')?.addEventListener('click', async () => {
    const input = modal.querySelector('#manualTownInput');
    const val = input?.value.trim();
    if (!val) {
      showToast('Please enter your area, town, or landmark.', 'warning');
      return;
    }
    userLocation = {
      town: val,
      lat: null,
      lng: null,
      isManual: true
    };
    saveUserLocation(userLocation);
    updateLocationUI();
    renderProducts();
    await syncLocationToFirestore(userLocation);
    showToast(`📍 Location set to "${val}"`, 'success');
    modal.remove();
  });
}

// ─── Real Platform Data Load ──────────────────────────────────────────────────
async function loadPlatformData() {
  showLoadingSkeleton();

  if (db && !isConfigPlaceholder) {
    try {
      // 1. Load registered shops
      const shopsSnap = await getDocs(collection(db, 'shops'));
      allShops.clear();
      shopsSnap.forEach(d => {
        allShops.set(d.id, { id: d.id, ...d.data() });
      });

      // 2. Load all real products created by sellers
      const productsQuery = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
      const productsSnap = await getDocs(productsQuery);
      allProducts = [];
      allCustomCategories.clear();

      productsSnap.forEach(d => {
        const p = { id: d.id, ...d.data() };
        // Valid real product check
        if (p.title && (p.price != null)) {
          allProducts.push(p);
          if (p.category && !PLATFORM_CONSTANTS.PRESET_CATEGORIES.includes(p.category)) {
            allCustomCategories.add(p.category);
          }
        }
      });
    } catch (err) {
      console.error('[Firestore] Real products load error:', err);
      allProducts = [];
    }
  } else {
    allProducts = [];
  }

  // Render real products (or clean empty state if no products yet)
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

// ─── Loading Skeleton ─────────────────────────────────────────────────────────
function showLoadingSkeleton() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  grid.innerHTML = Array(4).fill(0).map(() => `
    <div class="product-card skeleton-card" aria-hidden="true">
      <div class="skeleton skeleton-img" style="aspect-ratio:4/3;width:100%;"></div>
      <div style="padding:1rem;">
        <div class="skeleton skeleton-line" style="width:75%;margin-bottom:0.5rem;height:14px;"></div>
        <div class="skeleton skeleton-line" style="width:50%;margin-bottom:0.5rem;height:12px;"></div>
        <div class="skeleton skeleton-line" style="width:35%;height:16px;"></div>
      </div>
    </div>
  `).join('');
  const countEl = document.getElementById('productCount');
  if (countEl) countEl.textContent = 'Loading products…';
}

// ─── Render Products ──────────────────────────────────────────────────────────
function renderProducts() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  // Filter products
  let filtered = allProducts.filter(p => {
    // Category filter
    if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;

    // Search query filter
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

    // Nearby only filter
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

  // Sort: if user location has lat/lng, prioritize closer items; else keep latest
  if (userLocation && userLocation.lat != null && userLocation.lng != null) {
    filtered.sort((a, b) => {
      const shopA = allShops.get(a.shopId);
      const shopB = allShops.get(b.shopId);
      const dA = shopA?.lat ? (calculateHaversineDistance(userLocation.lat, userLocation.lng, shopA.lat, shopA.lng) ?? 9999) : 9999;
      const dB = shopB?.lat ? (calculateHaversineDistance(userLocation.lat, userLocation.lng, shopB.lat, shopB.lng) ?? 9999) : 9999;
      return dA - dB;
    });
  }

  // Update count text
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

  // Clean empty state if platform has 0 products
  if (allProducts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;text-align:center;padding:3.5rem 1rem;background:var(--glass-bg);border:1px dashed var(--slate-300);border-radius:var(--radius-lg);margin:1rem auto;max-width:600px;">
        <div style="font-size:3.5rem;margin-bottom:0.75rem;">🛍️</div>
        <h3 style="color:var(--slate-800);font-size:1.25rem;font-weight:700;margin-bottom:0.5rem;">No products uploaded yet</h3>
        <p style="color:var(--slate-500);font-size:0.95rem;max-width:440px;margin:0 auto 1.5rem;line-height:1.5;">
          No products uploaded yet. Sign in and switch to Seller Mode to upload the first product to Cloudinary!
        </p>
        <a href="./seller.html" class="btn btn-primary btn-lg" style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.5rem;border-radius:var(--radius-full);font-weight:700;">
          🛒 Switch to Seller Mode
        </a>
      </div>
    `;
    return;
  }

  // Search/Filter empty state
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;text-align:center;padding:3rem 1rem;background:var(--glass-bg);border-radius:var(--radius-lg);margin:1rem auto;max-width:500px;">
        <div style="font-size:3rem;margin-bottom:0.75rem;">🔍</div>
        <h3 style="color:var(--slate-700);font-size:1.15rem;font-weight:700;margin-bottom:0.5rem;">No matching products found</h3>
        <p style="color:var(--slate-500);font-size:0.9rem;margin-bottom:1.25rem;">
          Try selecting "All Items", clearing your search term, or browsing worldwide.
        </p>
        <button class="btn btn-secondary btn-sm" onclick="window.resetFilters()">
          ↺ Reset Filters
        </button>
      </div>
    `;
    return;
  }

  // Render product cards
  grid.innerHTML = filtered.map(product => buildProductCard(product)).join('');
}

window.resetFilters = function() {
  selectedCategory = 'All';
  searchQuery = '';
  nearbyFilterActive = false;
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
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

  // Calculate distance
  const distKm = (userLocation?.lat != null && shop.lat != null)
    ? calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng)
    : null;
  const distLabel = distKm != null ? `📍 ${distKm} km` : '📍 Delivery Available';
  const timeLabel = `⚡ ${getEstimatedDeliveryTime(distKm)}`;

  // Discount
  const hasDiscount = product.mrp && product.mrp > product.price;
  const discountPct = hasDiscount ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;

  // Verified blue-tick badge HTML (strictly constrained)
  const verifiedBadgeHtml = isVerified
    ? `<img src="${escapeHtml(PLATFORM_CONSTANTS.VERIFIED_BADGE_URL)}" class="verified-badge-sm" title="Verified Seller" alt="✓" />`
    : '';

  // Images setup
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
        <button class="carousel-prev" onclick="window.carouselPrev('${escapeHtml(product.id)}')" aria-label="Previous image">‹</button>
        <button class="carousel-next" onclick="window.carouselNext('${escapeHtml(product.id)}')" aria-label="Next image">›</button>
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

  // Cart button
  const qty = cart[product.id]?.qty || 0;
  const cartHtml = outOfStock
    ? `<button class="btn-add-cart btn-out-of-stock" disabled>Out of Stock</button>`
    : qty > 0
      ? `<div class="qty-pill">
           <button class="qty-btn" onclick="window.changeCartQty('${escapeHtml(product.id)}', -1)">−</button>
           <span class="qty-count">${qty}</span>
           <button class="qty-btn" onclick="window.changeCartQty('${escapeHtml(product.id)}', 1)">+</button>
         </div>`
      : `<button class="btn-add-cart" onclick="window.addToCart('${escapeHtml(product.id)}')">🛒 Add to Cart</button>`;

  return `
    <div class="product-card" role="listitem" data-product-id="${escapeHtml(product.id)}">
      <div style="position:relative;width:100%;">
        ${imageHtml}
        <span class="badge badge-distance" style="position:absolute;top:8px;left:8px;z-index:2;">${distLabel}</span>
        <span class="badge badge-time" style="position:absolute;top:8px;right:8px;z-index:2;">${timeLabel}</span>
        <span class="badge badge-shop-status ${isOpen ? 'badge-open' : 'badge-closed'}" style="position:absolute;bottom:8px;left:8px;z-index:2;">
          ${isOpen ? '🟢 Open' : '🔴 Closed'}
        </span>
        ${outOfStock ? `<div class="out-of-stock-overlay" style="position:absolute;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;z-index:3;"><span>Out of Stock</span></div>` : ''}
      </div>
      <div class="product-details" style="padding:0.85rem;display:flex;flex-direction:column;flex:1;">
        <div class="product-shop-row" style="display:flex;align-items:center;gap:0.35rem;margin-bottom:0.25rem;">
          <span class="product-shop-name" style="font-size:0.75rem;font-weight:700;color:var(--azure-700);">${escapeHtml(shop.name || 'Local Seller')}</span>
          ${verifiedBadgeHtml}
        </div>
        <h3 class="product-title" style="font-size:0.95rem;font-weight:700;color:var(--slate-900);line-height:1.3;margin-bottom:0.25rem;">${escapeHtml(product.title)}</h3>
        ${product.unit ? `<span class="product-unit" style="font-size:0.75rem;color:var(--slate-500);margin-bottom:0.4rem;">${escapeHtml(product.unit)}</span>` : ''}
        <div class="product-pricing" style="display:flex;align-items:baseline;gap:0.4rem;margin-top:auto;margin-bottom:0.6rem;">
          <span class="product-price" style="font-size:1.1rem;font-weight:800;color:var(--slate-900);">₹${product.price}</span>
          ${hasDiscount ? `<span class="product-mrp" style="font-size:0.8rem;text-decoration:line-through;color:var(--slate-400);">₹${product.mrp}</span>` : ''}
          ${hasDiscount ? `<span class="product-discount" style="font-size:0.75rem;font-weight:700;color:var(--emerald-600);">${discountPct}% off</span>` : ''}
        </div>
        ${lowStock ? `<p class="stock-warning" style="font-size:0.72rem;color:var(--rose-600);font-weight:600;margin-bottom:0.4rem;">⚠️ Only ${product.stock} left!</p>` : ''}
        <div class="product-cart-action">${cartHtml}</div>
      </div>
    </div>
  `;
}

// ─── Image Carousel Controls ──────────────────────────────────────────────────
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

// ─── Cart Handling ────────────────────────────────────────────────────────────
window.addToCart = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  if (product.stock <= 0) {
    showToast('This item is currently out of stock.', 'warning');
    return;
  }
  if (cart[productId]) {
    cart[productId].qty += 1;
  } else {
    cart[productId] = { product, qty: 1 };
  }
  saveCartToStorage();
  updateCartUI();
  renderProducts();
  showToast(`"${product.title}" added to cart!`, 'success');
};

window.changeCartQty = function(productId, delta) {
  if (!cart[productId]) return;
  cart[productId].qty += delta;
  if (cart[productId].qty <= 0) {
    delete cart[productId];
  }
  saveCartToStorage();
  updateCartUI();
  renderProducts();
  if (Object.keys(cart).length === 0) {
    clearCartReminder();
  }
};

function saveCartToStorage() {
  try {
    const simplified = {};
    Object.entries(cart).forEach(([id, item]) => {
      simplified[id] = { qty: item.qty, productId: item.product.id };
    });
    localStorage.setItem('zulora_cart', JSON.stringify(simplified));
  } catch (e) {}
}

function loadCartFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem('zulora_cart') || '{}');
    cart = {};
    Object.entries(raw).forEach(([id, item]) => {
      const product = allProducts.find(p => p.id === id);
      if (product) cart[id] = { product, qty: item.qty };
    });
  } catch (e) {
    cart = {};
  }
  updateCartUI();
}

function updateCartUI() {
  const items = Object.values(cart);
  const totalCount = items.reduce((s, i) => s + i.qty, 0);
  const totalPrice = items.reduce((s, i) => s + i.product.price * i.qty, 0);

  const bar = document.getElementById('floatingCartBar');
  const countEl = document.getElementById('floatingCartCount');
  const totalEl = document.getElementById('floatingCartTotal');

  if (bar) bar.classList.toggle('hidden', totalCount === 0);
  if (countEl) countEl.textContent = totalCount;
  if (totalEl) totalEl.textContent = totalPrice.toFixed(2);

  if (totalCount > 0) {
    startCartReminder(totalCount);
  } else {
    clearCartReminder();
  }
}

function groupCartByShop() {
  const groups = {};
  Object.values(cart).forEach(item => {
    const shopId = item.product.shopId || 'shop_direct';
    if (!groups[shopId]) {
      groups[shopId] = {
        shop: allShops.get(shopId) || { name: 'Direct Seller', id: shopId },
        items: []
      };
    }
    groups[shopId].items.push(item);
  });
  return groups;
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

  const groups = groupCartByShop();
  const groupList = Object.entries(groups);

  if (groupList.length === 0) {
    body.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;">
        <div style="font-size:3rem;margin-bottom:1rem;">🛒</div>
        <p style="color:var(--slate-700);font-weight:700;font-size:1.1rem;margin-bottom:0.25rem;">Your cart is empty</p>
        <p style="color:var(--slate-500);font-size:0.85rem;">Browse products to add your favourite items!</p>
      </div>
    `;
    footer.innerHTML = '';
    return;
  }

  let grandTotal = 0;
  let shopSections = groupList.map(([shopId, group]) => {
    const shopTotal = group.items.reduce((s, i) => s + i.product.price * i.qty, 0);
    grandTotal += shopTotal;
    const shop = group.shop;
    const distKm = (userLocation?.lat != null && shop.lat != null)
      ? calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng)
      : null;
    const { deliveryFee, minOrder } = calculateDeliveryFeeAndMinOrder(distKm);

    const rows = group.items.map(item => {
      const coverImg = Array.isArray(item.product.images) && item.product.images.length > 0
        ? item.product.images[0]
        : (item.product.imageUrl || 'https://via.placeholder.com/100x100?text=Item');
      return `
        <div class="cart-item" style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 0;border-bottom:1px solid var(--slate-100);">
          <img src="${escapeHtml(coverImg)}" alt="${escapeHtml(item.product.title)}" class="cart-item-img" style="width:52px;height:52px;border-radius:var(--radius-md);object-fit:cover;flex-shrink:0;" />
          <div class="cart-item-info" style="flex:1;min-width:0;">
            <div class="cart-item-title" style="font-size:0.85rem;font-weight:700;color:var(--slate-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.product.title)}</div>
            ${item.product.unit ? `<div class="cart-item-unit" style="font-size:0.75rem;color:var(--slate-500);">${escapeHtml(item.product.unit)}</div>` : ''}
            <div class="cart-item-price" style="font-size:0.85rem;font-weight:700;color:var(--slate-900);margin-top:0.2rem;">
              ₹${item.product.price} × ${item.qty} = ₹${(item.product.price * item.qty).toFixed(2)}
            </div>
          </div>
          <div class="qty-pill">
            <button class="qty-btn" onclick="window.changeCartQty('${escapeHtml(item.product.id)}', -1)">−</button>
            <span class="qty-count">${item.qty}</span>
            <button class="qty-btn" onclick="window.changeCartQty('${escapeHtml(item.product.id)}', 1)">+</button>
          </div>
        </div>
      `;
    }).join('');

    const belowMin = shopTotal < minOrder;

    return `
      <div class="cart-shop-section" style="background:var(--slate-50);border:1px solid var(--slate-200);border-radius:var(--radius-md);padding:0.85rem;margin-bottom:1rem;">
        <div class="cart-shop-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;padding-bottom:0.4rem;border-bottom:1px solid var(--slate-200);">
          <strong style="font-size:0.9rem;color:var(--slate-900);">${escapeHtml(shop.name || 'Local Seller')}</strong>
          <span class="cart-delivery-fee" style="font-size:0.78rem;font-weight:600;color:var(--azure-700);">🛵 Delivery: ₹${deliveryFee}</span>
        </div>
        ${rows}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.5rem;font-size:0.85rem;">
          <span style="color:var(--slate-500);">Shop Subtotal</span>
          <strong style="color:var(--slate-900);">₹${shopTotal.toFixed(2)}</strong>
        </div>
        ${belowMin ? `<div style="font-size:0.72rem;color:var(--amber-700);margin-top:0.3rem;">⚠️ Min order for this shop is ₹${minOrder}</div>` : ''}
      </div>
    `;
  }).join('');

  body.innerHTML = shopSections;
  footer.innerHTML = `
    <div class="cart-grand-total" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;font-size:1.1rem;">
      <span>Grand Total:</span>
      <strong style="color:var(--azure-800);font-size:1.25rem;">₹${grandTotal.toFixed(2)}</strong>
    </div>
    <button class="btn btn-primary btn-block" onclick="window.openCheckoutModal()" style="padding:0.85rem;font-size:1rem;font-weight:700;border-radius:var(--radius-full);">
      Proceed to Checkout →
    </button>
  `;
}

// ─── Checkout & Order Placement ───────────────────────────────────────────────
window.openCheckoutModal = function() {
  document.getElementById('checkoutModal')?.remove();

  const groups = groupCartByShop();
  const grandTotal = Object.values(cart).reduce((s, i) => s + i.product.price * i.qty, 0);

  // Generate UPI QR codes per seller
  const qrSections = Object.entries(groups).map(([shopId, group]) => {
    const shop = group.shop;
    const shopTotal = group.items.reduce((s, i) => s + i.product.price * i.qty, 0);
    const upiId = shop.upiId || 'zulora@upi';
    const upiStr = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shop.name || 'Zulora Seller')}&am=${shopTotal}&cu=INR`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiStr)}`;
    return `
      <div class="upi-qr-block" style="text-align:center;padding:0.75rem;border:1px solid var(--slate-200);border-radius:var(--radius-md);margin-bottom:0.75rem;">
        <div style="font-size:0.85rem;font-weight:700;margin-bottom:0.4rem;">${escapeHtml(shop.name || 'Seller')}</div>
        <img src="${qrUrl}" alt="UPI QR for ${escapeHtml(shop.name || 'Seller')}" style="width:140px;height:140px;margin:0 auto;display:block;" />
        <div style="font-size:0.78rem;color:var(--slate-600);margin-top:0.4rem;">Pay ₹${shopTotal.toFixed(2)} to <strong>${escapeHtml(upiId)}</strong></div>
      </div>
    `;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'checkoutModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Checkout">
      <div class="modal-header">
        <h3 style="font-size:1.15rem;font-weight:700;">🛍️ Complete Your Order</h3>
        <button class="btn btn-icon" onclick="document.getElementById('checkoutModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:1rem;">
        <label class="form-label" style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:0.3rem;">Full Name *</label>
        <input id="coName" type="text" class="form-input" placeholder="Your name" value="${escapeHtml(currentUser?.displayName || '')}" style="width:100%;margin-bottom:0.75rem;padding:0.6rem;border:1px solid var(--slate-300);border-radius:var(--radius-md);" />

        <label class="form-label" style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:0.3rem;">Mobile Phone *</label>
        <input id="coPhone" type="tel" class="form-input" placeholder="+91 XXXXXXXXXX" style="width:100%;margin-bottom:0.75rem;padding:0.6rem;border:1px solid var(--slate-300);border-radius:var(--radius-md);" />

        <label class="form-label" style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:0.3rem;">Delivery Address / Landmark *</label>
        <textarea id="coAddress" class="form-input" rows="2" placeholder="House no, street, town, landmark" style="width:100%;margin-bottom:0.75rem;padding:0.6rem;border:1px solid var(--slate-300);border-radius:var(--radius-md);">${escapeHtml(userLocation?.town || '')}</textarea>

        <label class="form-label" style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:0.3rem;">Payment Method *</label>
        <div style="display:flex;gap:1.5rem;margin-bottom:1rem;">
          <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.9rem;cursor:pointer;">
            <input type="radio" name="coPayment" value="UPI" checked /> 💳 UPI (Direct to Seller)
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.9rem;cursor:pointer;">
            <input type="radio" name="coPayment" value="COD" /> 💵 Cash on Delivery
          </label>
        </div>

        <div id="upiQrSection" style="margin-bottom:1rem;">
          <p style="font-size:0.8rem;color:var(--slate-500);margin-bottom:0.5rem;">
            Scan the QR code to pay the seller directly:
          </p>
          ${qrSections}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;background:var(--azure-50);border-radius:var(--radius-md);">
          <span style="font-size:0.9rem;color:var(--azure-900);font-weight:600;">Total Payable:</span>
          <strong style="font-size:1.15rem;color:var(--azure-800);">₹${grandTotal.toFixed(2)}</strong>
        </div>
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
      const upiSection = document.getElementById('upiQrSection');
      if (upiSection) upiSection.style.display = radio.value === 'UPI' ? 'block' : 'none';
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

  const groups = groupCartByShop();
  const orderIds = [];

  for (const [shopId, group] of Object.entries(groups)) {
    const shop = group.shop;
    const shopTotal = group.items.reduce((s, i) => s + i.product.price * i.qty, 0);

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
        unit: i.product.unit || ''
      })),
      grandTotal: shopTotal,
      totalAmount: shopTotal,
      paymentMode: payment,
      orderStatus: 'Placed',
      createdAt: serverTimestamp()
    };

    let docId = 'ORD-' + Date.now();
    if (db && !isConfigPlaceholder) {
      try {
        const ref = await addDoc(collection(db, 'orders'), orderData);
        docId = ref.id;
        // Decrement product stock in Firestore
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
  cart = {};
  saveCartToStorage();
  updateCartUI();
  clearCartReminder();

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
    return `<a href="https://wa.me/${cleanNum}?text=${msg}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp" style="display:flex;align-items:center;justify-content:center;gap:0.4rem;padding:0.65rem 1rem;font-weight:700;">
      💬 WhatsApp ${escapeHtml(shop.name || 'Seller')}
    </a>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'orderSuccessModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Order Placed">
      <div class="modal-header" style="background:var(--emerald-50,#ecfdf5);">
        <h3 style="color:var(--emerald-700,#047857);font-size:1.15rem;font-weight:700;">🎉 Order Placed Successfully!</h3>
        <button class="btn btn-icon" onclick="document.getElementById('orderSuccessModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="text-align:center;padding:1.5rem 1rem;">
        <div style="font-size:3.5rem;margin-bottom:0.75rem;">✅</div>
        <p style="font-size:1rem;color:var(--slate-800);margin-bottom:0.5rem;">
          Thank you, <strong>${escapeHtml(buyer.name)}</strong>!
        </p>
        <p style="font-size:0.85rem;color:var(--slate-500);margin-bottom:1.5rem;">
          Your order has been sent to the merchant. You can confirm via WhatsApp or track live status anytime.
        </p>
        <div style="display:flex;flex-direction:column;gap:0.6rem;">
          ${waLinks}
          <a href="./orders.html" class="btn btn-primary" style="padding:0.65rem 1rem;font-weight:700;">
            📦 Track My Orders
          </a>
          <a href="tel:${PLATFORM_CONSTANTS.HELPLINE_PHONE}" class="btn btn-ghost" style="font-size:0.85rem;">
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
