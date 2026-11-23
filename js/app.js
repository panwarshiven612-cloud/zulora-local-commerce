/**
 * Zulora Local — Main Storefront Application Engine v3
 * Modular, lag-free, Blinkit-inspired quick commerce orchestrator.
 * Open browsing, strict Google Auth gate for orders, smart multi-shop cart.
 */

import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc,
  query, orderBy, onSnapshot, serverTimestamp, increment, isConfigPlaceholder
} from './firebase-init.js';

import {
  initAuth, signInWithGoogle, signOutUser, getCurrentUser
} from './auth.js';

import {
  getCart, loadCartFromStorage, addToCart as cartAdd,
  changeCartQty as cartChangeQty, clearCart, getCartTotals,
  groupCartByShop
} from './cart.js';

import {
  saveUserLocation, getSavedUserLocation
} from './geo-pricing.js';

import { PLATFORM_CONSTANTS } from './config.js';
import { promptPWAInstall } from './pwa.js';
import {
  loadSavedNotifications, renderNotificationDrawer,
  markAllRead, notifyOrderStatus, showToast
} from './notifications.js';

import { openLocationSetupModal } from './location-modal.js';
import { openProductDetailModal } from './product-modal.js';
import {
  renderStorefrontProducts, updateCardStepperDOM,
  renderLiveSuggestions, showLoadingSkeleton
} from './storefront.js';

// ─── Application State ────────────────────────────────────────────────────────
let currentUser = null;
let userLocation = getSavedUserLocation();
let allProducts = [];
let allShops = new Map();
let selectedCategory = 'All';
let searchQuery = '';
let nearbyFilterActive = false;
let pendingCheckoutAfterAuth = false;

// ─── Boot Lifecycle ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateLocationUI();
  initAuth(handleUserAuthChange);
  loadCartFromStorage(allProducts);
  updateCartUI();
  loadPlatformData();
  loadSavedNotifications();
});

// ─── Setup Event Listeners ────────────────────────────────────────────────────
function setupEventListeners() {
  // Navigation & 3-Bar Hamburger Drawer
  document.getElementById('btnHamburgerMenu')?.addEventListener('click', openMenuDrawer);
  document.getElementById('btnCloseMenuDrawer')?.addEventListener('click', closeMenuDrawer);
  document.getElementById('topLocationPill')?.addEventListener('click', () => {
    openLocationSetupModal({
      currentLocation: userLocation,
      currentUser,
      db,
      isConfigPlaceholder,
      onLocationSaved: handleLocationSaved
    });
  });
  document.getElementById('navCartBtn')?.addEventListener('click', openCart);

  // Drawer Menu Navigation Links
  document.getElementById('menuItemLocation')?.addEventListener('click', () => {
    closeMenuDrawer();
    openLocationSetupModal({
      currentLocation: userLocation,
      currentUser,
      db,
      isConfigPlaceholder,
      onLocationSaved: handleLocationSaved
    });
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
  document.getElementById('btnSettingsSignOut')?.addEventListener('click', async () => {
    closeSettingsModal();
    await handleSignOutAction();
  });
  document.getElementById('btnSettingsChangeLocation')?.addEventListener('click', () => {
    closeSettingsModal();
    openLocationSetupModal({
      currentLocation: userLocation,
      currentUser,
      db,
      isConfigPlaceholder,
      onLocationSaved: handleLocationSaved
    });
  });
  document.getElementById('btnSettingsEnablePush')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Notifications are not supported in this browser.', 'warning');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      showToast('🔔 Push notifications enabled!', 'success');
    } else {
      showToast('Notification permission was not granted.', 'info');
    }
  });
  document.getElementById('btnCloseAboutUsModal')?.addEventListener('click', closeAboutModal);

  // Location Controls in Banner
  document.getElementById('btnDetectGps')?.addEventListener('click', async () => {
    openLocationSetupModal({
      currentLocation: userLocation,
      currentUser,
      db,
      isConfigPlaceholder,
      onLocationSaved: handleLocationSaved
    });
  });
  document.getElementById('btnManualLocation')?.addEventListener('click', () => {
    openLocationSetupModal({
      currentLocation: userLocation,
      currentUser,
      db,
      isConfigPlaceholder,
      onLocationSaved: handleLocationSaved
    });
  });

  // Debounced Search Input & Live Suggestions
  const searchInput = document.getElementById('searchInput');
  const suggestionsBox = document.getElementById('searchSuggestions');
  let searchDebounceTimer = null;

  searchInput?.addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    renderLiveSuggestions(suggestionsBox, searchQuery, allProducts, selectedTitle => {
      if (searchInput) searchInput.value = selectedTitle;
      searchQuery = selectedTitle;
      refreshProductGrid();
    });

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      refreshProductGrid();
    }, 120);
  });

  // Close suggestions when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-hero')) {
      suggestionsBox?.classList.remove('show');
    }
  });

  // Filters: All vs Nearby
  document.getElementById('filterAllBtn')?.addEventListener('click', () => {
    nearbyFilterActive = false;
    document.getElementById('filterAllBtn')?.classList.add('active');
    document.getElementById('filterNearbyBtn')?.classList.remove('active');
    refreshProductGrid();
  });

  document.getElementById('filterNearbyBtn')?.addEventListener('click', () => {
    if (!userLocation || userLocation.lat == null) {
      showToast('Please set your location first to filter nearby items.', 'warning');
      openLocationSetupModal({
        currentLocation: userLocation,
        currentUser,
        db,
        isConfigPlaceholder,
        onLocationSaved: handleLocationSaved
      });
      return;
    }
    nearbyFilterActive = true;
    document.getElementById('filterNearbyBtn')?.classList.add('active');
    document.getElementById('filterAllBtn')?.classList.remove('active');
    refreshProductGrid();
  });

  // Category Pills Navigation
  document.getElementById('categoryScroll')?.addEventListener('click', e => {
    const pill = e.target.closest('.category-pill');
    if (!pill) return;
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedCategory = pill.dataset.category || 'All';
    refreshProductGrid();
  });

  // Cart Drawer Triggers
  document.getElementById('floatingCartBar')?.addEventListener('click', openCart);
  document.getElementById('btnOpenCart')?.addEventListener('click', openCart);
  document.getElementById('closeCartDrawer')?.addEventListener('click', closeCart);

  // Global Backdrop
  document.getElementById('drawerBackdrop')?.addEventListener('click', () => {
    closeCart();
    closeNotifDrawer();
    closeMenuDrawer();
  });

  // PWA Install
  document.getElementById('btnInstallApp')?.addEventListener('click', promptPWAInstall);
  document.getElementById('btnPwaInstall')?.addEventListener('click', promptPWAInstall);
  document.getElementById('btnPwaDismiss')?.addEventListener('click', () => {
    document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  });

  // Data Refresh
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

// ─── 3-Bar Left Menu Drawer Controls ──────────────────────────────────────────
function openMenuDrawer() {
  const drawer = document.getElementById('menuDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) {
    drawer.classList.remove('hidden');
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

// ─── Modal Dialog Handlers ───────────────────────────────────────────────────
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
    locDesc.textContent = (userLocation && userLocation.town) ? `Current: ${userLocation.town}` : 'Current: All Locations';
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

// ─── Location & Auth Synchronization ──────────────────────────────────────────
function handleLocationSaved(newLoc) {
  userLocation = newLoc;
  updateLocationUI();
  refreshProductGrid();
}

function updateLocationUI() {
  const el = document.getElementById('locationTownText');
  const topEl = document.getElementById('topLocationText');

  const displayText = (userLocation && userLocation.town && userLocation.town !== 'All Locations')
    ? (userLocation.region ? `${userLocation.town}, ${userLocation.region}` : userLocation.town)
    : ((userLocation && userLocation.lat != null) ? `${userLocation.lat.toFixed(3)}, ${userLocation.lng.toFixed(3)}` : 'Set Location');

  if (topEl) topEl.textContent = displayText;
  if (el) el.textContent = displayText === 'Set Location' ? 'All Locations (Worldwide)' : displayText;
}

async function handleSignInAction() {
  const user = await signInWithGoogle();
  if (user && pendingCheckoutAfterAuth) {
    pendingCheckoutAfterAuth = false;
    openCheckoutModal();
  }
}

async function handleSignOutAction() {
  const step1 = confirm('Are you sure you want to sign out of Zulora Local?');
  if (!step1) return;
  const step2 = confirm('Final confirmation: Sign out now? Your cart items will be saved locally.');
  if (!step2) return;
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
          refreshProductGrid();
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

// ─── Real Firestore Products Load (Live onSnapshot Sync) ─────────────────────
let unsubShops = null;
let unsubProducts = null;

function loadPlatformData() {
  const grid = document.getElementById('productGrid');
  showLoadingSkeleton(grid, 4);

  if (!db || isConfigPlaceholder) {
    allProducts = [];
    allShops.clear();
    loadCartFromStorage(allProducts);
    updateCartUI();
    refreshProductGrid();
    return;
  }

  // 1. Real-time shops listener (syncs shop updates and verification blue ticks live!)
  if (unsubShops) unsubShops();
  try {
    unsubShops = onSnapshot(collection(db, 'shops'), snapshot => {
      allShops.clear();
      snapshot.forEach(d => {
        allShops.set(d.id, { id: d.id, ...d.data() });
      });
      refreshProductGrid();
    }, err => {
      console.warn('[Firestore] Shops live listener notice:', err);
    });
  } catch (err) {
    console.warn('[Firestore] Shops listener setup:', err);
  }

  // 2. Real-time products listener (syncs additions, edits, and deletions live!)
  if (unsubProducts) unsubProducts();
  try {
    unsubProducts = onSnapshot(collection(db, 'products'), snapshot => {
      const rawProds = [];
      snapshot.forEach(d => {
        const p = { id: d.id, ...d.data() };
        if (p.title && (p.price != null)) {
          rawProds.push(p);
        }
      });

      // Sort client-side by createdAt descending (no composite index required)
      rawProds.sort((a, b) => {
        const tA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : (a.createdAtIso ? new Date(a.createdAtIso).getTime() : 0);
        const tB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : (b.createdAtIso ? new Date(b.createdAtIso).getTime() : 0);
        return tB - tA;
      });

      allProducts = rawProds;

      // Cleanse cart: immediately purge any deleted products from user's active cart
      loadCartFromStorage(allProducts);
      updateCartUI();
      refreshProductGrid();
    }, err => {
      console.warn('[Firestore] Products live listener notice:', err);
    });
  } catch (err) {
    console.warn('[Firestore] Products listener setup:', err);
  }
}

function refreshProductGrid() {
  const grid = document.getElementById('productGrid');
  const countEl = document.getElementById('productCount');
  renderStorefrontProducts({
    container: grid,
    countElement: countEl,
    products: allProducts,
    allShops,
    userLocation,
    cart: getCart(),
    selectedCategory,
    searchQuery,
    nearbyFilterActive
  });
}

// ─── Fast In-Card Stepper & Cart Integration ──────────────────────────────────
window.handleCartAdd = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  cartAdd(product);
  updateCartUI();
  const cart = getCart();
  const qty = cart[productId]?.qty || 0;
  updateCardStepperDOM(productId, qty, product);
};

window.handleCartChange = function(productId, delta) {
  const product = allProducts.find(p => p.id === productId);
  cartChangeQty(productId, delta);
  updateCartUI();
  const cart = getCart();
  const qty = cart[productId]?.qty || 0;
  updateCardStepperDOM(productId, qty, product);
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

// ─── Product Detail Modal Opening ─────────────────────────────────────────────
window.openProductDetailModal = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  const shop = allShops.get(product.shopId) || {};
  const cart = getCart();
  const cartQty = cart[productId]?.qty || 0;

  openProductDetailModal({
    product,
    shop,
    userLocation,
    cartQty,
    onAddToCart: (pId) => window.handleCartAdd(pId),
    onCartChange: (pId, delta) => window.handleCartChange(pId, delta)
  });
};

// ─── Cart Drawer Controls & Multi-Shop Breakdown ──────────────────────────────
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
      <div style="text-align:center;padding:3.5rem 1rem;">
        <div style="font-size:3rem;margin-bottom:0.75rem;">🛒</div>
        <p style="color:var(--slate-800);font-weight:800;font-size:1.1rem;margin-bottom:0.25rem;">Your cart is empty</p>
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
        <div class="shop-cart-item">
          <img src="${escapeHtml(coverImg)}" alt="${escapeHtml(item.product.title)}" class="shop-cart-item-img" />
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.84rem;font-weight:700;color:var(--slate-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(item.product.title)}
            </div>
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
      <div class="shop-cart-card">
        <div class="shop-cart-header">
          <div>
            <strong style="font-size:0.88rem;color:var(--slate-900);">${escapeHtml(group.shop.name || 'Local Seller')}</strong>
            <span style="display:block;font-size:0.7rem;color:var(--slate-400);">Self-Delivery by merchant</span>
          </div>
          <span style="font-size:0.74rem;font-weight:700;color:var(--azure-700);background:var(--azure-50);padding:0.2rem 0.5rem;border-radius:var(--radius-sm);">
            ${group.distKm ? `📍 ${group.distKm.toFixed(1)} km` : '📍 Local'}
          </span>
        </div>

        ${rows}

        <div class="shop-bill-breakdown">
          <div class="shop-bill-row">
            <span>Items Subtotal</span>
            <span>₹${group.shopTotal.toFixed(2)}</span>
          </div>
          <div class="shop-bill-row">
            <span>Distance Delivery Fee (${group.distKm ? group.distKm.toFixed(1) : 1} km @ ₹15/km)</span>
            <span>₹${(group.baseFee || 15).toFixed(2)}</span>
          </div>
          <div class="shop-bill-row">
            <span>Weight Surcharge (${(group.totalWeightKg || 0).toFixed(1)} kg, first 2 kg free)</span>
            <span>${group.weightFee > 0 ? `₹${group.weightFee.toFixed(2)}` : '<strong style="color:var(--emerald-600);">FREE</strong>'}</span>
          </div>
          <div class="shop-bill-total">
            <span>Store Total</span>
            <strong style="color:var(--azure-800);">₹${group.grandTotal.toFixed(2)}</strong>
          </div>
        </div>

        ${group.isBelowMinOrder ? `
          <div class="shortfall-alert">
            <span>⚠️</span>
            <span>Minimum order for this store is <strong>₹${group.minOrder}</strong>. Please add items worth <strong>₹${group.shortfall.toFixed(2)}</strong> more.</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  body.innerHTML = shopSections;
  footer.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;font-size:1.05rem;">
      <span style="font-weight:700;">Grand Total:</span>
      <strong style="color:var(--azure-800);font-size:1.25rem;">₹${totalGrand.toFixed(2)}</strong>
    </div>
    ${hasAnyShortfall ? `
      <div style="background:#fef2f2;border:1px solid #fee2e2;border-radius:var(--radius-md);padding:0.5rem;font-size:0.75rem;color:#b91c1c;margin-bottom:0.6rem;text-align:center;">
        ⚠️ One or more stores do not meet the ₹50 minimum order threshold.
      </div>
    ` : ''}
    <button class="btn btn-primary btn-block" onclick="window.handleCheckoutClick()" ${hasAnyShortfall ? 'disabled style="opacity:0.6;cursor:not-allowed;"' : ''} style="padding:0.75rem;font-size:0.95rem;font-weight:800;border-radius:var(--radius-full);background:var(--emerald-600);border-color:var(--emerald-600);">
      Proceed to Checkout →
    </button>
  `;
}
window.renderCartDrawerContent = renderCartDrawerContent;

// ─── STRICT GOOGLE AUTH GATE FOR ORDERS ───────────────────────────────────────
window.handleCheckoutClick = function() {
  if (!currentUser) {
    pendingCheckoutAfterAuth = true;
    showToast('Please sign in with Google to place your order.', 'info');
    openSignInModal();
    return;
  }
  openCheckoutModal();
};

// ─── Checkout & Order Placement ───────────────────────────────────────────────
window.openCheckoutModal = function() {
  if (!currentUser) {
    pendingCheckoutAfterAuth = true;
    openSignInModal();
    return;
  }

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
      <div class="checkout-upi-box">
        <div style="font-size:0.85rem;font-weight:800;margin-bottom:0.25rem;color:var(--slate-900);">${escapeHtml(shop.name || 'Seller')}</div>
        <div style="font-size:1.05rem;font-weight:900;color:var(--azure-800);margin-bottom:0.25rem;">₹${shopTotal.toFixed(2)}</div>
        ${hasCustomQr
          ? `<img src="${escapeHtml(shop.upiQrImageUrl)}" alt="Seller UPI QR Code" style="width:140px;height:140px;margin:0.5rem auto;display:block;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);" />`
          : ''
        }
        ${upiId
          ? `<div style="margin-top:0.4rem;">
               <div style="font-size:0.74rem;color:var(--slate-500);margin-bottom:0.25rem;">UPI ID to pay:</div>
               <div class="checkout-upi-id-pill">
                 <span class="checkout-upi-id-text">${escapeHtml(upiId)}</span>
                 <button onclick="navigator.clipboard.writeText('${escapeHtml(upiId)}').then(()=>{ alert('✓ UPI ID copied to clipboard!'); })" style="background:none;border:none;cursor:pointer;font-size:0.85rem;" title="Copy UPI ID">📋</button>
               </div>
             </div>`
          : `<div style="font-size:0.78rem;color:var(--slate-500);margin-top:0.35rem;">Contact merchant for direct UPI transfer.</div>`
        }
      </div>
    `;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'checkoutModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box checkout-modal-box" role="dialog" aria-modal="true" aria-label="Complete Order">
      <div class="modal-header">
        <h3 style="font-size:1.1rem;font-weight:800;">🛍️ Complete Your Order</h3>
        <button class="btn btn-icon" onclick="document.getElementById('checkoutModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:1.25rem;">
        <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;">Full Name *</label>
        <input id="coName" type="text" placeholder="Your name" value="${escapeHtml(currentUser?.displayName || '')}" style="width:100%;margin-bottom:0.65rem;padding:0.55rem;border:1px solid var(--border-subtle);border-radius:var(--radius-md);font-size:0.88rem;" />

        <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;">Mobile Phone *</label>
        <input id="coPhone" type="tel" placeholder="+91 XXXXXXXXXX" value="${escapeHtml(userLocation?.phone || '')}" style="width:100%;margin-bottom:0.65rem;padding:0.55rem;border:1px solid var(--border-subtle);border-radius:var(--radius-md);font-size:0.88rem;" />

        <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;">Delivery Address / Landmark *</label>
        <textarea id="coAddress" rows="2" placeholder="House no, street, town, landmark" style="width:100%;margin-bottom:0.65rem;padding:0.55rem;border:1px solid var(--border-subtle);border-radius:var(--radius-md);font-size:0.88rem;">${escapeHtml(userLocation?.address || userLocation?.town || '')}</textarea>

        <label style="font-size:0.8rem;font-weight:700;display:block;margin-bottom:0.25rem;">Payment Option *</label>
        <div style="display:flex;gap:1.5rem;margin-bottom:0.85rem;">
          <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem;cursor:pointer;font-weight:600;">
            <input type="radio" name="coPayment" value="UPI" checked /> 💳 Direct UPI
          </label>
          <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem;cursor:pointer;font-weight:600;">
            <input type="radio" name="coPayment" value="COD" /> 💵 Cash on Delivery
          </label>
        </div>

        <div id="upiQrSection" style="margin-bottom:0.85rem;">
          <p style="font-size:0.75rem;color:var(--slate-500);margin-bottom:0.4rem;">
            Pay directly to seller via UPI:
          </p>
          ${qrSections}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0.85rem;background:var(--azure-50);border-radius:var(--radius-md);margin-bottom:0.75rem;">
          <span style="font-size:0.85rem;color:var(--azure-900);font-weight:800;">Total Payable Amount:</span>
          <strong style="font-size:1.15rem;color:var(--azure-800);">₹${grandTotal.toFixed(2)}</strong>
        </div>

        <p style="font-size:0.72rem;color:var(--slate-500);text-align:center;margin:0;">
          By placing an order, you agree to the <a href="#" onclick="window.openTermsModal();return false;" style="color:var(--azure-600);text-decoration:underline;font-weight:700;">Zulora Terms & Conditions</a> and Merchant Self-Delivery Policy.
        </p>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;">
        <button class="btn btn-ghost" onclick="document.getElementById('checkoutModal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="window.executeOrderPlacement()" style="background:var(--emerald-600);border-color:var(--emerald-600);font-weight:800;">Place Order ✓</button>
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
  if (!currentUser) {
    showToast('Please sign in with Google to place an order.', 'warning');
    openSignInModal();
    return;
  }

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

    const generatedOrderCode = 'ZUL-' + Math.floor(100000 + Math.random() * 900000);
    const orderData = {
      orderCode: generatedOrderCode,
      orderId: generatedOrderCode,
      buyerName: name,
      buyerPhone: phone,
      buyerAddress: address,
      buyerUid: currentUser?.uid || 'guest',
      buyerEmail: currentUser?.email || '',
      buyerCityTown: userLocation?.town || '',
      buyerState: userLocation?.region || '',
      buyerCoords: (userLocation?.lat != null && userLocation?.lng != null)
        ? { lat: userLocation.lat, lng: userLocation.lng }
        : null,
      sellerUid: group.shop.sellerUid || group.shop.ownerUid || group.shop.ownerId || shopId,
      shopId,
      shopName: group.shop.name || 'Local Seller',
      shopPhone: group.shop.phone || '',
      shopEmail: group.shop.ownerEmail || group.shop.email || '',
      shopUpiId: group.shop.upiId || '',
      shopQrUrl: group.shop.upiQrImageUrl || '',
      sellerPhone: group.shop.phone || '',
      sellerEmail: group.shop.ownerEmail || group.shop.email || '',
      items: group.items.map(i => ({
        productId: i.product.id,
        title: i.product.title,
        qty: i.qty,
        quantity: i.qty,
        price: i.product.price,
        unit: i.product.unit || '',
        weightKg: i.product.weightKg || i.product.weight || 0.5
      })),
      subtotal: group.shopTotal,
      itemsSubtotal: group.shopTotal,
      distanceKm: group.distKm != null ? group.distKm : null,
      distKm: group.distKm != null ? group.distKm : null,
      deliveryCharge: group.baseFee || group.deliveryFee || 15,
      baseDeliveryFee: group.baseFee || group.deliveryFee || 15,
      extraWeightCharge: group.weightFee || 0,
      weightFee: group.weightFee || 0,
      totalWeightKg: group.totalWeightKg,
      totalAmount: shopTotal,
      grandTotal: shopTotal,
      paymentMethod: payment,
      paymentMode: payment,
      status: 'placed',
      orderStatus: 'Placed',
      buyerDeliveredConfirmed: false,
      deliveryModel: 'Self-Delivery (Merchant)',
      cancelableUntil: Date.now() + 5 * 60 * 1000,
      createdAt: serverTimestamp(),
      createdAtIso: new Date().toISOString(),
      updatedAt: serverTimestamp()
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
  refreshProductGrid();
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
      <div class="modal-header" style="background:var(--emerald-50);">
        <h3 style="color:var(--emerald-700);font-size:1.1rem;font-weight:800;">🎉 Order Placed Successfully!</h3>
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
          <a href="./orders.html" class="btn btn-primary" style="padding:0.6rem 1rem;font-weight:800;background:var(--azure-600);">
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

// ─── Notification Drawer Controls ─────────────────────────────────────────────
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

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
