/**
 * Zulora Local — Main Application Logic v2
 * Front-page hyperlocal PWA: product discovery, cart, checkout, auth, notifications
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
  requestNotificationPermission, notifyOrderStatus
} from './notifications.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let userLocation = getSavedUserLocation() || {
  lat: PLATFORM_CONSTANTS.DEFAULT_LAT,
  lng: PLATFORM_CONSTANTS.DEFAULT_LNG,
  town: PLATFORM_CONSTANTS.DEFAULT_TOWN,
  isManual: true,
  isFallback: true
};
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
  requestNotificationPermission();
});

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  // Auth
  document.getElementById('authBtn')?.addEventListener('click', handleAuthAction);
  document.getElementById('signOutBtn')?.addEventListener('click', () => {
    if (auth && !isConfigPlaceholder) {
      signOut(auth).catch(err => console.error('[Auth] Sign-out error:', err));
    } else {
      currentUser = null;
      updateAuthUI(null);
      showToast('Signed out (demo mode)', 'info');
    }
  });

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

  // Backdrop — closes whichever drawer is open
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
    showToast('Refreshing…', 'info');
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
      // Admin link
      const navAdmin = document.getElementById('navAdminLink');
      if (navAdmin) {
        navAdmin.classList.toggle('hidden', user.email !== PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL);
      }
      // Sync Firestore user doc
      if (db) {
        try {
          const userRef = doc(db, 'users', user.uid);
          const snap = await getDoc(userRef);
          const payload = {
            displayName: user.displayName || '',
            email: user.email || '',
            photoURL: user.photoURL || '',
            lastLogin: serverTimestamp()
          };
          if (!snap.exists()) {
            payload.createdAt = serverTimestamp();
            payload.location = userLocation;
            await setDoc(userRef, payload);
          } else {
            await updateDoc(userRef, payload);
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
    if (userAvatar) userAvatar.src = user.photoURL || '';
    if (userName) userName.textContent = user.displayName || user.email || 'User';
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
    // Demo mock user
    currentUser = {
      uid: 'demo-user-001',
      displayName: 'Demo User',
      email: 'demo@zulora.local',
      photoURL: PLATFORM_CONSTANTS.BRAND_LOGO_URL
    };
    updateAuthUI(currentUser);
    showToast('Demo mode: signed in as Demo User', 'info');
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Sign-in failed: ' + err.message, 'error');
    }
  }
}

// ─── Location ─────────────────────────────────────────────────────────────────
async function handleDetectGps() {
  const btn = document.getElementById('btnDetectGps');
  if (btn) btn.textContent = '⏳ Detecting…';
  try {
    const loc = await getCurrentGpsPosition();
    userLocation = loc;
    saveUserLocation(loc);
    updateLocationUI();
    renderProducts();
    showToast('📍 Location updated via GPS!', 'success');
  } catch (err) {
    showToast('Could not detect GPS location.', 'error');
  } finally {
    if (btn) btn.textContent = '🛰️ Detect GPS';
  }
}

function handleManualLocationPrompt() {
  const town = prompt('Enter your town or area (e.g. Koramangala, Bengaluru):');
  if (!town || !town.trim()) return;
  userLocation = {
    lat: PLATFORM_CONSTANTS.DEFAULT_LAT,
    lng: PLATFORM_CONSTANTS.DEFAULT_LNG,
    town: town.trim(),
    isManual: true
  };
  saveUserLocation(userLocation);
  updateLocationUI();
  renderProducts();
  showToast(`📍 Location set to "${town.trim()}"`, 'success');
}

function updateLocationUI() {
  const el = document.getElementById('locationTownText');
  if (!el) return;
  if (userLocation?.town) {
    el.textContent = userLocation.town;
  } else if (userLocation?.lat && userLocation?.lng) {
    el.textContent = `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
  } else {
    el.textContent = PLATFORM_CONSTANTS.DEFAULT_TOWN;
  }
}

// ─── Platform Data ────────────────────────────────────────────────────────────
async function loadPlatformData() {
  showLoadingSkeleton();
  if (db && !isConfigPlaceholder) {
    try {
      // Load shops
      const shopsSnap = await getDocs(collection(db, 'shops'));
      allShops.clear();
      shopsSnap.forEach(d => allShops.set(d.id, { id: d.id, ...d.data() }));

      // Load products
      const productsQuery = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
      const productsSnap = await getDocs(productsQuery);
      allProducts = [];
      allCustomCategories.clear();
      productsSnap.forEach(d => {
        const p = { id: d.id, ...d.data() };
        allProducts.push(p);
        if (p.category && !PLATFORM_CONSTANTS.PRESET_CATEGORIES.includes(p.category)) {
          allCustomCategories.add(p.category);
        }
      });
    } catch (err) {
      console.warn('[Firestore] Load error:', err);
      loadMockPlatformData();
    }
  } else {
    loadMockPlatformData();
  }

  if (allProducts.length === 0) loadMockPlatformData();

  renderProducts();
  addDynamicCategoryPills();
}

function loadMockPlatformData() {
  allShops.clear();
  allCustomCategories.clear();

  const shops = [
    {
      id: 'shop001',
      name: 'Fresh Farm Hub',
      ownerName: 'Ramesh Kumar',
      upiId: 'ramesh@upi',
      whatsapp: '919876543210',
      lat: 12.9360, lng: 77.6250,
      deliveryRadiusKm: 5,
      isVerified: true,
      isOpen: true,
      category: 'Crops'
    },
    {
      id: 'shop002',
      name: 'Zulora Electronics',
      ownerName: 'Priya Sharma',
      upiId: 'priya@upi',
      whatsapp: '919876543211',
      lat: 12.9345, lng: 77.6235,
      deliveryRadiusKm: 8,
      isVerified: true,
      isOpen: true,
      category: 'Electronics'
    },
    {
      id: 'shop003',
      name: 'Mithai Bazaar',
      ownerName: 'Suresh Gupta',
      upiId: 'suresh@upi',
      whatsapp: '919876543212',
      lat: 12.9370, lng: 77.6260,
      deliveryRadiusKm: 4,
      isVerified: false,
      isOpen: false,
      category: 'Sweets'
    }
  ];
  shops.forEach(s => allShops.set(s.id, s));

  allProducts = [
    {
      id: 'prod001',
      shopId: 'shop001',
      title: 'Fresh Organic Tomatoes',
      category: 'Crops',
      price: 40,
      mrp: 60,
      unit: '1 kg',
      stock: 50,
      images: [
        'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?w=400',
        'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400'
      ],
      isVerified: true,
      createdAt: { seconds: Date.now() / 1000 }
    },
    {
      id: 'prod002',
      shopId: 'shop001',
      title: 'Basmati Rice Premium',
      category: 'Grocery',
      price: 180,
      mrp: 220,
      unit: '5 kg',
      stock: 20,
      images: [
        'https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?w=400'
      ],
      isVerified: false,
      createdAt: { seconds: Date.now() / 1000 - 100 }
    },
    {
      id: 'prod003',
      shopId: 'shop002',
      title: 'Wireless Earbuds Pro',
      category: 'Electronics',
      price: 999,
      mrp: 1499,
      unit: '1 piece',
      stock: 10,
      images: [
        'https://images.unsplash.com/photo-1605464315542-bda3e2f4e605?w=400',
        'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400'
      ],
      isVerified: true,
      createdAt: { seconds: Date.now() / 1000 - 200 }
    },
    {
      id: 'prod004',
      shopId: 'shop002',
      title: 'Fast Charging USB-C Cable',
      category: 'Electronics',
      price: 199,
      mrp: 349,
      unit: '1 piece',
      stock: 3,
      images: [
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400'
      ],
      isVerified: false,
      createdAt: { seconds: Date.now() / 1000 - 300 }
    },
    {
      id: 'prod005',
      shopId: 'shop003',
      title: 'Kaju Katli Box',
      category: 'Sweets',
      price: 350,
      mrp: 400,
      unit: '500 g',
      stock: 0,
      images: [
        'https://images.unsplash.com/photo-1565299507177-b0ac66763828?w=400'
      ],
      isVerified: false,
      createdAt: { seconds: Date.now() / 1000 - 400 }
    },
    {
      id: 'prod006',
      shopId: 'shop001',
      title: 'Handmade Pottery Set',
      category: 'Handcraft',
      price: 650,
      mrp: 850,
      unit: '1 set',
      stock: 7,
      images: [
        'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=400'
      ],
      isVerified: true,
      createdAt: { seconds: Date.now() / 1000 - 500 }
    }
  ];

  // Custom categories
  allProducts.forEach(p => {
    if (p.category && !PLATFORM_CONSTANTS.PRESET_CATEGORIES.includes(p.category)) {
      allCustomCategories.add(p.category);
    }
  });
}

function addDynamicCategoryPills() {
  const scroll = document.getElementById('categoryScroll');
  if (!scroll) return;
  const existing = new Set(
    Array.from(scroll.querySelectorAll('.category-pill')).map(p => p.dataset.category)
  );
  allCustomCategories.forEach(cat => {
    if (existing.has(cat)) return;
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
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="product-card skeleton-card" aria-hidden="true">
      <div class="skeleton skeleton-img"></div>
      <div class="skeleton skeleton-line" style="width:80%;margin:12px auto 6px;"></div>
      <div class="skeleton skeleton-line" style="width:60%;margin:0 auto 6px;"></div>
      <div class="skeleton skeleton-line" style="width:40%;margin:0 auto;"></div>
    </div>
  `).join('');
  const countEl = document.getElementById('productCount');
  if (countEl) countEl.textContent = 'Loading products…';
}

// ─── Render Products ──────────────────────────────────────────────────────────
function renderProducts() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  // Filter
  let filtered = allProducts.filter(p => {
    // Category
    if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;

    // Search
    if (searchQuery) {
      const shop = allShops.get(p.shopId);
      const haystack = [
        p.title || '',
        p.category || '',
        shop?.name || ''
      ].join(' ').toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }

    // Nearby filter
    if (nearbyFilterActive) {
      const shop = allShops.get(p.shopId);
      if (!shop?.lat || !shop?.lng) return false;
      const dist = calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng);
      const radius = shop.deliveryRadiusKm ?? PLATFORM_CONSTANTS.DEFAULT_DELIVERY_RADIUS_KM;
      if (dist == null || dist > radius) return false;
    }

    return true;
  });

  // Sort by distance ascending
  filtered.sort((a, b) => {
    const shopA = allShops.get(a.shopId);
    const shopB = allShops.get(b.shopId);
    const dA = shopA?.lat ? (calculateHaversineDistance(userLocation.lat, userLocation.lng, shopA.lat, shopA.lng) ?? 999) : 999;
    const dB = shopB?.lat ? (calculateHaversineDistance(userLocation.lat, userLocation.lng, shopB.lat, shopB.lng) ?? 999) : 999;
    return dA - dB;
  });

  // Update count
  const countEl = document.getElementById('productCount');
  if (countEl) {
    countEl.textContent = filtered.length === 0
      ? 'No products found'
      : `${filtered.length} product${filtered.length !== 1 ? 's' : ''} near you`;
  }

  // Empty state
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;text-align:center;padding:3rem 1rem;">
        <div style="font-size:3rem;margin-bottom:1rem;">🔍</div>
        <h3 style="color:var(--slate-600,#64748b);margin-bottom:.5rem;">No products found</h3>
        <p style="color:var(--slate-500,#94a3b8);font-size:.9rem;">Try a different category, location or search term.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(product => buildProductCard(product)).join('');
}

function buildProductCard(product) {
  const shop = allShops.get(product.shopId) || {};
  const isVerified = shop.isVerified || product.isVerified;
  const isOpen = shop.isOpen !== false;
  const outOfStock = product.stock <= 0;
  const lowStock = product.stock > 0 && product.stock <= 5;

  // Distance & time
  const distKm = (shop.lat && shop.lng)
    ? calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng)
    : null;
  const distLabel = distKm != null ? `📍 ${distKm} km` : '📍 —';
  const timeLabel = `⚡ ${getEstimatedDeliveryTime(distKm)}`;

  // Discount
  const hasDiscount = product.mrp && product.mrp > product.price;
  const discountPct = hasDiscount ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;

  // Verified badge html
  const verifiedBadgeHtml = isVerified
    ? `<img src="${escapeHtml(PLATFORM_CONSTANTS.VERIFIED_BADGE_URL)}" class="verified-badge" title="Verified Seller" alt="Verified" />`
    : '';

  // Image section
  const images = product.images && product.images.length > 0 ? product.images : ['https://via.placeholder.com/300x200?text=No+Image'];
  let imageHtml;
  if (images.length > 1) {
    const dots = images.map((_, i) =>
      `<span class="carousel-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></span>`
    ).join('');
    imageHtml = `
      <div class="img-carousel" data-idx="0" data-product-id="${escapeHtml(product.id)}">
        <img class="carousel-img" src="${escapeHtml(images[0])}" alt="${escapeHtml(product.title)}" loading="lazy" />
        <button class="carousel-prev" onclick="window.carouselPrev('${escapeHtml(product.id)}')" aria-label="Previous image">‹</button>
        <button class="carousel-next" onclick="window.carouselNext('${escapeHtml(product.id)}')" aria-label="Next image">›</button>
        <div class="carousel-dots">${dots}</div>
      </div>
    `;
  } else {
    imageHtml = `<img class="product-img" src="${escapeHtml(images[0])}" alt="${escapeHtml(product.title)}" loading="lazy" />`;
  }

  // Cart qty
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
      <div class="card-image-wrap" style="position:relative;">
        ${imageHtml}
        ${verifiedBadgeHtml}
        <span class="badge badge-distance" style="position:absolute;top:8px;left:8px;">${distLabel}</span>
        <span class="badge badge-time" style="position:absolute;top:8px;right:8px;">${timeLabel}</span>
        <span class="badge badge-shop-status ${isOpen ? 'badge-open' : 'badge-closed'}"
              style="position:absolute;bottom:8px;left:8px;">
          ${isOpen ? '🟢 Open' : '🔴 Closed'}
        </span>
        ${outOfStock ? `<div class="out-of-stock-overlay"><span>Out of Stock</span></div>` : ''}
      </div>
      <div class="product-details">
        <div class="product-shop-row">
          <span class="product-shop-name">${escapeHtml(shop.name || 'Unknown Shop')}</span>
          ${isVerified ? `<img src="${escapeHtml(PLATFORM_CONSTANTS.VERIFIED_BADGE_URL)}" class="verified-badge-sm" title="Verified Seller" alt="✓" />` : ''}
        </div>
        <h3 class="product-title">${escapeHtml(product.title)}</h3>
        ${product.unit ? `<span class="product-unit">${escapeHtml(product.unit)}</span>` : ''}
        <div class="product-pricing">
          <span class="product-price">₹${product.price}</span>
          ${hasDiscount ? `<span class="product-mrp">₹${product.mrp}</span>` : ''}
          ${hasDiscount ? `<span class="product-discount">${discountPct}% off</span>` : ''}
        </div>
        ${lowStock ? `<p class="stock-warning">⚠️ Only ${product.stock} left!</p>` : ''}
        <div class="product-cart-action">${cartHtml}</div>
      </div>
    </div>
  `;
}

// ─── Carousel ─────────────────────────────────────────────────────────────────
window.carouselPrev = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product || !product.images || product.images.length <= 1) return;
  const carousel = document.querySelector(`.img-carousel[data-product-id="${productId}"]`);
  if (!carousel) return;
  let idx = parseInt(carousel.dataset.idx || '0', 10);
  idx = (idx - 1 + product.images.length) % product.images.length;
  carousel.dataset.idx = idx;
  carousel.querySelector('.carousel-img').src = product.images[idx];
  updateCarouselDots(carousel, idx);
};

window.carouselNext = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product || !product.images || product.images.length <= 1) return;
  const carousel = document.querySelector(`.img-carousel[data-product-id="${productId}"]`);
  if (!carousel) return;
  let idx = parseInt(carousel.dataset.idx || '0', 10);
  idx = (idx + 1) % product.images.length;
  carousel.dataset.idx = idx;
  carousel.querySelector('.carousel-img').src = product.images[idx];
  updateCarouselDots(carousel, idx);
};

function updateCarouselDots(carousel, activeIdx) {
  carousel.querySelectorAll('.carousel-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === activeIdx);
  });
}

// ─── Cart ─────────────────────────────────────────────────────────────────────
window.addToCart = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  if (product.stock <= 0) { showToast('This product is out of stock.', 'warning'); return; }
  if (cart[productId]) {
    cart[productId].qty += 1;
  } else {
    cart[productId] = { product, qty: 1 };
  }
  saveCartToStorage();
  updateCartUI();
  renderProducts(); // refresh qty pills
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
  } catch (e) { cart = {}; }
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
    const shopId = item.product.shopId || 'unknown';
    if (!groups[shopId]) groups[shopId] = { shop: allShops.get(shopId) || { name: 'Unknown Shop' }, items: [] };
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
        <p style="color:var(--slate-500,#94a3b8);font-weight:600;">Your cart is empty.</p>
        <p style="color:var(--slate-400,#cbd5e1);font-size:.85rem;">Browse products and add items to get started!</p>
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
    const distKm = (shop.lat && shop.lng)
      ? calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng)
      : null;
    const { deliveryFee } = calculateDeliveryFeeAndMinOrder(distKm);

    const rows = group.items.map(item => `
      <div class="cart-item">
        <img src="${escapeHtml(item.product.images?.[0] || '')}" alt="${escapeHtml(item.product.title)}" class="cart-item-img" />
        <div class="cart-item-info">
          <div class="cart-item-title">${escapeHtml(item.product.title)}</div>
          <div class="cart-item-unit">${escapeHtml(item.product.unit || '')}</div>
          <div class="cart-item-price">₹${item.product.price} × ${item.qty} = ₹${(item.product.price * item.qty).toFixed(2)}</div>
        </div>
        <div class="qty-pill">
          <button class="qty-btn" onclick="window.changeCartQty('${escapeHtml(item.product.id)}',-1)">−</button>
          <span class="qty-count">${item.qty}</span>
          <button class="qty-btn" onclick="window.changeCartQty('${escapeHtml(item.product.id)}',1)">+</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="cart-shop-section">
        <div class="cart-shop-header">
          <strong>${escapeHtml(shop.name || 'Shop')}</strong>
          <span class="cart-delivery-fee">🛵 Delivery: ₹${deliveryFee}</span>
        </div>
        ${rows}
        <div class="cart-shop-subtotal">Shop Subtotal: ₹${shopTotal.toFixed(2)}</div>
      </div>
    `;
  }).join('');

  body.innerHTML = shopSections;
  footer.innerHTML = `
    <div class="cart-grand-total">Grand Total: <strong>₹${grandTotal.toFixed(2)}</strong></div>
    <button class="btn btn-primary btn-block" onclick="window.openCheckoutModal()">Proceed to Checkout →</button>
  `;
}

// ─── Checkout ─────────────────────────────────────────────────────────────────
window.openCheckoutModal = function() {
  // Remove any old modal
  document.getElementById('checkoutModal')?.remove();

  const groups = groupCartByShop();
  const grandTotal = Object.values(cart).reduce((s, i) => s + i.product.price * i.qty, 0);

  // Build UPI QR sections per shop (shown when UPI selected)
  const qrSections = Object.entries(groups).map(([shopId, group]) => {
    const shop = group.shop;
    const shopTotal = group.items.reduce((s, i) => s + i.product.price * i.qty, 0);
    const upiId = shop.upiId || 'zulora@upi';
    const upiStr = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shop.name || 'Seller')}&am=${shopTotal}&cu=INR`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiStr)}`;
    return `
      <div class="upi-qr-block">
        <div class="upi-shop-name">${escapeHtml(shop.name || 'Shop')}</div>
        <img src="${qrUrl}" alt="UPI QR for ${escapeHtml(shop.name || 'shop')}" class="upi-qr-img" />
        <div class="upi-amount">Pay ₹${shopTotal.toFixed(2)} to <strong>${escapeHtml(upiId)}</strong></div>
      </div>
    `;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'checkoutModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Checkout">
      <div class="modal-header">
        <h3>🛍️ Checkout</h3>
        <button class="btn btn-icon" onclick="document.getElementById('checkoutModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <label class="form-label">Your Name *</label>
        <input id="coName" type="text" class="form-input" placeholder="Enter your full name" />

        <label class="form-label">Phone Number *</label>
        <input id="coPhone" type="tel" class="form-input" placeholder="+91 XXXXXXXXXX" />

        <label class="form-label">Delivery Address *</label>
        <textarea id="coAddress" class="form-input" rows="2" placeholder="House no., Street, Landmark, City…"></textarea>

        <label class="form-label">Payment Method *</label>
        <div class="payment-options">
          <label class="payment-opt">
            <input type="radio" name="coPayment" value="UPI" checked /> 💳 UPI (QR Code)
          </label>
          <label class="payment-opt">
            <input type="radio" name="coPayment" value="COD" /> 💵 Cash on Delivery
          </label>
        </div>

        <div id="upiQrSection" class="upi-qr-section">
          <p style="font-size:.85rem;color:var(--slate-600,#475569);margin-bottom:.75rem;">
            Scan the QR code(s) below and pay each seller directly:
          </p>
          ${qrSections}
        </div>

        <div class="cart-grand-total" style="margin-top:1rem;">Total: <strong>₹${grandTotal.toFixed(2)}</strong></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('checkoutModal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="window.executeOrderPlacement()">Place Order ✓</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Toggle UPI section
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
      buyerName: name,
      buyerPhone: phone,
      buyerAddress: address,
      buyerUid: currentUser?.uid || 'guest',
      shopId,
      shopName: shop.name || 'Unknown Shop',
      items: group.items.map(i => ({
        productId: i.product.id,
        title: i.product.title,
        qty: i.qty,
        price: i.product.price
      })),
      totalAmount: shopTotal,
      paymentMethod: payment,
      status: 'Placed',
      createdAt: new Date().toISOString()
    };

    let orderId;
    if (db && !isConfigPlaceholder) {
      try {
        const ref = await addDoc(collection(db, 'orders'), {
          ...orderData,
          createdAt: serverTimestamp()
        });
        orderId = ref.id;
        // Decrement stock
        for (const item of group.items) {
          try {
            const pRef = doc(db, 'products', item.product.id);
            await updateDoc(pRef, { stock: increment(-item.qty) });
          } catch (e) {}
        }
      } catch (err) {
        console.warn('[Firestore] Order save error:', err);
        orderId = 'DEMO-' + Date.now();
      }
    } else {
      orderId = 'DEMO-' + Date.now();
      try {
        const existing = JSON.parse(localStorage.getItem('zulora_orders') || '[]');
        existing.unshift({ id: orderId, ...orderData });
        localStorage.setItem('zulora_orders', JSON.stringify(existing.slice(0, 50)));
      } catch (e) {}
    }
    orderIds.push({ orderId, shop, orderData });
    notifyOrderStatus(orderId, 'Placed');
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

  const waMessages = orderIds.map(({ orderId, shop, orderData }) => {
    const waNum = shop.whatsapp || PLATFORM_CONSTANTS.HELPLINE_WHATSAPP;
    const msg = encodeURIComponent(
      `🛒 New Order #${orderId}\n` +
      `Buyer: ${buyer.name} | ${buyer.phone}\n` +
      `Address: ${buyer.address}\n` +
      `Payment: ${buyer.payment}\n` +
      `Amount: ₹${orderData.totalAmount}\n` +
      `Items: ${orderData.items.map(i => `${i.title} x${i.qty}`).join(', ')}`
    );
    return { waNum, waUrl: `https://wa.me/${waNum}?text=${msg}`, shopName: shop.name };
  });

  const waLinks = waMessages.map(w =>
    `<a href="${w.waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp">
       💬 WhatsApp ${escapeHtml(w.shopName || 'Seller')}
     </a>`
  ).join('');

  const modal = document.createElement('div');
  modal.id = 'orderSuccessModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Order Placed">
      <div class="modal-header" style="background:var(--green-50,#f0fdf4);">
        <h3 style="color:var(--green-700,#15803d);">🎉 Order Placed Successfully!</h3>
        <button class="btn btn-icon" onclick="document.getElementById('orderSuccessModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="text-align:center;">
        <div style="font-size:3rem;margin-bottom:1rem;">✅</div>
        <p>Thank you, <strong>${escapeHtml(buyer.name)}</strong>! Your order has been placed.</p>
        <p style="font-size:.85rem;color:var(--slate-500,#94a3b8);margin:.5rem 0 1.5rem;">
          Order confirmation will be sent to ${escapeHtml(buyer.phone)}.
        </p>
        <div class="order-actions" style="display:flex;flex-direction:column;gap:.75rem;">
          ${waLinks}
          <a href="tel:${PLATFORM_CONSTANTS.HELPLINE_PHONE}" class="btn btn-secondary">
            📞 Call Helpline ${PLATFORM_CONSTANTS.HELPLINE_PHONE_DISPLAY}
          </a>
          <a href="./orders.html" class="btn btn-primary">📦 Track My Orders</a>
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

// ─── Toast (re-export for global use) ────────────────────────────────────────
import { showToast } from './notifications.js';

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
