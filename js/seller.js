/**
 * Zulora Local — Seller / Merchant Dashboard v2
 * Full dashboard: auth, product upload (multi-image), live orders, shop profile,
 * commission ledger, KPI stats, and demo fallback.
 */

import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion,
  isConfigPlaceholder
} from './firebase-init.js';

import { uploadMultipleImages } from './cloudinary.js';
import { getCurrentGpsPosition } from './geo-pricing.js';
import { PLATFORM_CONSTANTS } from './config.js';
import { showToast, addNotification } from './notifications.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentSeller = null;
let currentShop   = null;
let sellerProducts = [];
let liveOrders     = [];
let unsubscribeOrders   = null;
let unsubscribeProducts = null;
let selectedFiles       = [];   // FileList from multi-image input

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initAuth();
});

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  // Auth
  document.getElementById('btnSellerLogin')?.addEventListener('click', handleSellerLogin);
  document.getElementById('btnSellerLogout')?.addEventListener('click', handleSellerLogout);

  // Shop status toggle
  document.getElementById('shopStatusToggle')?.addEventListener('change', handleToggleShopStatus);

  // GPS capture
  document.getElementById('btnCaptureShopGps')?.addEventListener('click', handleCaptureShopGps);

  // Shop profile form submit
  document.getElementById('shopProfileForm')?.addEventListener('submit', handleSaveShopProfile);

  // Multi-image file input
  document.getElementById('productImages')?.addEventListener('change', handleMultiImageSelect);

  // Product upload form
  document.getElementById('productUploadForm')?.addEventListener('submit', handleUploadProduct);

  // Delivery radius slider
  document.getElementById('shopDeliveryRadius')?.addEventListener('input', (e) => {
    const val = document.getElementById('shopRadiusVal');
    if (val) val.textContent = e.target.value;
  });

  // Category select: show/hide custom category input
  document.getElementById('productCategory')?.addEventListener('change', (e) => {
    const customGroup = document.getElementById('customCategoryGroup');
    const customInput = document.getElementById('customCategoryInput');
    if (e.target.value === 'add_custom') {
      customGroup?.classList.remove('hidden');
      customInput?.focus();
    } else {
      customGroup?.classList.add('hidden');
      if (customInput) customInput.value = '';
    }
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function initAuth() {
  if (isConfigPlaceholder || !auth) {
    // Demo mode — no real Firebase
    loadDemoShop();
    return;
  }
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentSeller = user;
      showDashboard(user);
      loadOrCreateShop(user);
    } else {
      currentSeller = null;
      showAuthGate();
    }
  });
}

async function handleSellerLogin() {
  if (isConfigPlaceholder || !auth) {
    loadDemoShop();
    return;
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    currentSeller = result.user;
  } catch (err) {
    console.error('[Seller] login error:', err);
    showToast('Sign-in failed: ' + (err.message || 'Unknown error'), 'error');
  }
}

async function handleSellerLogout() {
  try {
    if (unsubscribeOrders)   { unsubscribeOrders();   unsubscribeOrders   = null; }
    if (unsubscribeProducts) { unsubscribeProducts(); unsubscribeProducts = null; }
    if (!isConfigPlaceholder && auth) await signOut(auth);
    currentSeller = null;
    currentShop   = null;
    sellerProducts = [];
    liveOrders     = [];
    showAuthGate();
  } catch (err) {
    console.error('[Seller] logout error:', err);
  }
}

function showDashboard(user) {
  document.getElementById('authSection')?.classList.add('hidden');
  const dash = document.getElementById('dashboardSection');
  if (dash) { dash.style.display = 'block'; }
  document.getElementById('btnSellerLogout')?.classList.remove('hidden');
  document.getElementById('sellerNameDisplay').textContent = user.displayName || user.email || 'Seller';
}

function showAuthGate() {
  document.getElementById('authSection')?.classList.remove('hidden');
  const dash = document.getElementById('dashboardSection');
  if (dash) { dash.style.display = 'none'; }
  document.getElementById('btnSellerLogout')?.classList.add('hidden');
}

// ─── Shop load / create ───────────────────────────────────────────────────────
async function loadOrCreateShop(user) {
  if (!db) return;
  try {
    const shopRef = doc(db, 'shops', user.uid);
    const snap    = await getDoc(shopRef);
    if (snap.exists()) {
      currentShop = { id: snap.id, ...snap.data() };
      populateShopForm(currentShop);
    } else {
      // Create initial shop doc
      const initial = {
        ownerUid:        user.uid,
        ownerName:       user.displayName || '',
        ownerEmail:      user.email || '',
        shopName:        (user.displayName || 'My Shop') + "'s Store",
        handle:          '',
        category:        '',
        phone:           '',
        upiId:           '',
        deliveryRadiusKm: PLATFORM_CONSTANTS.DEFAULT_DELIVERY_RADIUS_KM,
        description:     '',
        lat:             null,
        lng:             null,
        isOpen:          false,
        isVerified:      false,
        customCategories: [],
        createdAt:       serverTimestamp()
      };
      await setDoc(shopRef, initial);
      currentShop = { id: user.uid, ...initial };
      showToast('Welcome! Your shop profile has been created 🎉', 'success');
    }
    listenToSellerProducts(user.uid);
    listenToSellerOrders(user.uid);
  } catch (err) {
    console.error('[Seller] loadOrCreateShop error:', err);
    showToast('Could not load shop: ' + err.message, 'error');
  }
}

function populateShopForm(shop) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  };
  set('shopName',     shop.shopName     || '');
  set('shopHandle',   shop.handle       || '');
  set('shopCategory', shop.category     || '');
  set('shopPhone',    shop.phone        || '');
  set('shopUpiId',    shop.upiId        || '');
  set('shopDescription', shop.description || '');
  set('shopLat',      shop.lat          ?? '');
  set('shopLng',      shop.lng          ?? '');

  const radius = shop.deliveryRadiusKm || PLATFORM_CONSTANTS.DEFAULT_DELIVERY_RADIUS_KM;
  const sliderEl = document.getElementById('shopDeliveryRadius');
  if (sliderEl) sliderEl.value = radius;
  const radVal = document.getElementById('shopRadiusVal');
  if (radVal) radVal.textContent = radius;

  const toggle = document.getElementById('shopStatusToggle');
  const label  = document.getElementById('shopStatusLabel');
  if (toggle) toggle.checked = !!shop.isOpen;
  if (label) label.textContent = shop.isOpen ? 'Open ✅' : 'Closed ❌';
}

// ─── Shop status toggle ───────────────────────────────────────────────────────
async function handleToggleShopStatus(e) {
  const isOpen = e.target.checked;
  const label  = document.getElementById('shopStatusLabel');
  if (label) label.textContent = isOpen ? 'Open ✅' : 'Closed ❌';
  showToast(`Your shop is now ${isOpen ? 'OPEN 🟢' : 'CLOSED 🔴'}`, isOpen ? 'success' : 'info');

  if (!db || !currentShop) return;
  try {
    await updateDoc(doc(db, 'shops', currentShop.id), { isOpen, updatedAt: serverTimestamp() });
    if (currentShop) currentShop.isOpen = isOpen;
  } catch (err) {
    console.error('[Seller] toggle status error:', err);
    // revert UI
    e.target.checked = !isOpen;
    if (label) label.textContent = !isOpen ? 'Open ✅' : 'Closed ❌';
    showToast('Could not update shop status', 'error');
  }
}

// ─── GPS Capture ──────────────────────────────────────────────────────────────
async function handleCaptureShopGps() {
  showToast('Detecting your GPS location…', 'info');
  try {
    const pos = await getCurrentGpsPosition();
    document.getElementById('shopLat').value = pos.lat.toFixed(6);
    document.getElementById('shopLng').value = pos.lng.toFixed(6);
    showToast(`📍 GPS captured: ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`, 'success');
  } catch (err) {
    showToast('Could not get GPS: ' + err.message, 'error');
  }
}

// ─── Save Shop Profile ────────────────────────────────────────────────────────
async function handleSaveShopProfile(e) {
  e.preventDefault();
  const handle = document.getElementById('shopHandle')?.value.trim();
  if (handle && !/^[a-z0-9_]{3,30}$/.test(handle)) {
    showToast('Handle must be 3–30 lowercase letters, digits, or underscores.', 'error');
    return;
  }

  const payload = {
    shopName:         document.getElementById('shopName')?.value.trim() || '',
    handle:           handle,
    category:         document.getElementById('shopCategory')?.value || '',
    phone:            document.getElementById('shopPhone')?.value.trim() || '',
    upiId:            document.getElementById('shopUpiId')?.value.trim() || '',
    description:      document.getElementById('shopDescription')?.value.trim() || '',
    deliveryRadiusKm: parseFloat(document.getElementById('shopDeliveryRadius')?.value) || 5,
    lat:              parseFloat(document.getElementById('shopLat')?.value) || null,
    lng:              parseFloat(document.getElementById('shopLng')?.value) || null,
    updatedAt:        serverTimestamp()
  };

  if (!db || !currentShop) {
    // Demo mode
    Object.assign(currentShop, payload);
    showToast('Shop profile saved (demo mode)!', 'success');
    return;
  }

  try {
    await updateDoc(doc(db, 'shops', currentShop.id), payload);
    Object.assign(currentShop, payload);
    showToast('✅ Shop profile saved successfully!', 'success');
  } catch (err) {
    console.error('[Seller] save profile error:', err);
    showToast('Could not save profile: ' + err.message, 'error');
  }
}

// ─── Multi-Image Select ───────────────────────────────────────────────────────
function handleMultiImageSelect(e) {
  const files = Array.from(e.target.files);
  selectedFiles = files;

  const grid = document.getElementById('imagePreviewGrid');
  if (grid) grid.innerHTML = '';

  if (files.length > 6) {
    showToast('⚠️ Max 6 images allowed. Only the first 6 will be used.', 'warning');
    selectedFiles = files.slice(0, 6);
  }

  selectedFiles.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = document.createElement('img');
      img.src   = ev.target.result;
      img.className = 'preview-thumb';
      img.title     = file.name;
      img.alt       = `Preview ${idx + 1}`;
      grid?.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

// ─── Upload Product ───────────────────────────────────────────────────────────
async function handleUploadProduct(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSubmitProduct');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Uploading…'; }

  try {
    // Gather form values
    const title    = document.getElementById('productTitle')?.value.trim();
    const catSelect = document.getElementById('productCategory')?.value;
    const customCat = document.getElementById('customCategoryInput')?.value.trim();
    const category  = (catSelect === 'add_custom' ? customCat : catSelect) || 'General';
    const price    = parseFloat(document.getElementById('productPrice')?.value) || 0;
    const mrp      = parseFloat(document.getElementById('productMrp')?.value) || 0;
    const unit     = document.getElementById('productUnit')?.value.trim() || '';
    const weightKg = parseFloat(document.getElementById('productWeightKg')?.value) || 0;
    const stock    = parseInt(document.getElementById('productStock')?.value, 10) || 0;

    if (!title) { showToast('Product title is required.', 'error'); return; }

    // Save custom category to shop
    if (catSelect === 'add_custom' && customCat && db && currentShop) {
      try {
        await updateDoc(doc(db, 'shops', currentShop.id), {
          customCategories: arrayUnion(customCat)
        });
        if (!currentShop.customCategories) currentShop.customCategories = [];
        if (!currentShop.customCategories.includes(customCat)) {
          currentShop.customCategories.push(customCat);
        }
      } catch (_) { /* non-fatal */ }
    }

    // Upload images
    let imageUrl = 'https://placehold.co/400x300?text=No+Image';
    let images   = [];

    if (selectedFiles.length > 0) {
      showToast('📤 Uploading images…', 'info');
      const results = await uploadMultipleImages(
        selectedFiles.slice(0, 6),
        (fileIdx, pct) => updateProgressBar(fileIdx, pct)
      );
      imageUrl = results[0]?.url || imageUrl;
      images   = results.map(r => r.url);
    }

    // Build product payload
    const productPayload = {
      shopId:    currentShop?.id || 'demo_shop',
      sellerUid: currentSeller?.uid || 'demo_uid',
      title,
      category,
      price,
      mrp,
      unit,
      weightKg,
      stock,
      inStock:   stock > 0,
      imageUrl,
      images,
      salesCount: 0,
      createdAt:  serverTimestamp ? serverTimestamp() : new Date().toISOString()
    };

    if (db && !isConfigPlaceholder) {
      await addDoc(collection(db, 'products'), productPayload);
    } else {
      // Demo: store in localStorage
      const demoProds = JSON.parse(localStorage.getItem('zulora_demo_products') || '[]');
      demoProds.unshift({ id: 'demo_' + Date.now(), ...productPayload, createdAt: new Date().toISOString() });
      localStorage.setItem('zulora_demo_products', JSON.stringify(demoProds));
      sellerProducts = demoProds;
      renderSellerProducts();
      updateDashboardStats();
    }

    showToast('✅ Product uploaded successfully!', 'success');
    addNotification(`New product listed: "${title}"`, 'success');

    // Reset form
    document.getElementById('productUploadForm')?.reset();
    const grid = document.getElementById('imagePreviewGrid');
    if (grid) grid.innerHTML = '';
    const prog = document.getElementById('multiUploadProgress');
    if (prog) prog.innerHTML = '';
    selectedFiles = [];
    document.getElementById('customCategoryGroup')?.classList.add('hidden');

  } catch (err) {
    console.error('[Seller] upload product error:', err);
    showToast('Upload failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '➕ Upload Product to Store'; }
  }
}

// ─── Progress Bars ─────────────────────────────────────────────────────────────
function updateProgressBar(fileIdx, pct) {
  const container = document.getElementById('multiUploadProgress');
  if (!container) return;

  let wrap = document.getElementById(`prog-wrap-${fileIdx}`);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'progress-bar-wrap';
    wrap.id        = `prog-wrap-${fileIdx}`;
    wrap.innerHTML = `
      <span class="progress-bar-label">File ${fileIdx + 1}</span>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" id="prog-${fileIdx}" style="width:0%"></div>
      </div>
      <span style="font-size:.78rem;color:var(--slate-600);min-width:36px;" id="prog-pct-${fileIdx}">0%</span>
    `;
    container.appendChild(wrap);
  }

  const fill = document.getElementById(`prog-${fileIdx}`);
  const pctEl = document.getElementById(`prog-pct-${fileIdx}`);
  if (fill)  fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';

  if (pct >= 100) {
    setTimeout(() => wrap?.remove(), 800);
  }
}

// ─── Live Products Listener ────────────────────────────────────────────────────
function listenToSellerProducts(uid) {
  if (!db || !uid) return;
  if (unsubscribeProducts) unsubscribeProducts();

  const q = query(
    collection(db, 'products'),
    where('sellerUid', '==', uid),
    orderBy('createdAt', 'desc')
  );

  unsubscribeProducts = onSnapshot(q, (snap) => {
    sellerProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSellerProducts();
    updateDashboardStats();
  }, (err) => {
    console.error('[Seller] products listener error:', err);
  });
}

// ─── Live Orders Listener ─────────────────────────────────────────────────────
function listenToSellerOrders(uid) {
  if (!db || !uid) return;
  if (unsubscribeOrders) unsubscribeOrders();

  const q = query(
    collection(db, 'orders'),
    where('sellerUid', '==', uid),
    orderBy('createdAt', 'desc')
  );

  unsubscribeOrders = onSnapshot(q, (snap) => {
    liveOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSellerOrders();
    updateDashboardStats();
  }, (err) => {
    console.error('[Seller] orders listener error:', err);
  });
}

// ─── Render Products Table ─────────────────────────────────────────────────────
function renderSellerProducts() {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;

  if (sellerProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">
      <div class="empty-icon">📦</div>
      <p>No products yet — upload your first product above!</p>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = sellerProducts.map(p => {
    const imgBadge = (p.images && p.images.length > 1)
      ? `<span class="img-count-badge">+${p.images.length}</span>` : '';
    const statusClass = p.inStock ? 'instock' : 'outstock';
    const statusLabel = p.inStock ? '✅ In Stock' : '❌ Out';
    const nextInStock  = !p.inStock;
    const age = p.createdAt ? calculateProductAge(p.createdAt) : '—';

    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:.6rem;">
          <img class="product-thumb" src="${escapeHtml(p.imageUrl || 'https://placehold.co/80x80?text=N/A')}" alt="${escapeHtml(p.title)}" />
          <div>
            <div class="product-name">${escapeHtml(p.title)}${imgBadge}</div>
            <div class="product-cat">${escapeHtml(p.category || '—')}</div>
          </div>
        </div>
      </td>
      <td>
        <strong>₹${(p.price || 0).toFixed(2)}</strong>
        ${p.mrp && p.mrp > p.price ? `<br/><small style="color:var(--slate-400);text-decoration:line-through;">₹${(p.mrp).toFixed(2)}</small>` : ''}
      </td>
      <td>
        <div class="stock-ctrl">
          <button onclick="window.updateStock('${p.id}', -1)" aria-label="Decrease stock">−</button>
          <span class="stock-num">${p.stock ?? 0}</span>
          <button onclick="window.updateStock('${p.id}', 1)" aria-label="Increase stock">+</button>
        </div>
      </td>
      <td>
        <span class="status-pill ${statusClass}" onclick="window.toggleProductStockState('${p.id}', ${nextInStock})" title="Click to toggle">
          ${statusLabel}
        </span>
      </td>
      <td style="font-size:.8rem;color:var(--slate-500);">${age}</td>
      <td style="font-weight:700;color:var(--azure-700);">${p.salesCount || 0}</td>
      <td>
        <button class="btn-danger" onclick="window.deleteProductItem('${p.id}')">🗑️ Delete</button>
      </td>
    </tr>`;
  }).join('');
}

// ─── Stock Update ─────────────────────────────────────────────────────────────
window.updateStock = async function(prodId, delta) {
  const idx = sellerProducts.findIndex(p => p.id === prodId);
  if (idx === -1) return;
  const newStock = Math.max(0, (sellerProducts[idx].stock || 0) + delta);
  sellerProducts[idx].stock  = newStock;
  sellerProducts[idx].inStock = newStock > 0;
  renderSellerProducts();

  if (db && !isConfigPlaceholder) {
    try {
      await updateDoc(doc(db, 'products', prodId), {
        stock: newStock,
        inStock: newStock > 0,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error('[Seller] updateStock error:', err);
      showToast('Could not update stock', 'error');
    }
  } else {
    // Demo: persist
    const demoProds = JSON.parse(localStorage.getItem('zulora_demo_products') || '[]');
    const di = demoProds.findIndex(p => p.id === prodId);
    if (di !== -1) { demoProds[di].stock = newStock; demoProds[di].inStock = newStock > 0; }
    localStorage.setItem('zulora_demo_products', JSON.stringify(demoProds));
  }
};

// ─── Toggle Product In/Out of Stock ──────────────────────────────────────────
window.toggleProductStockState = async function(prodId, targetInStock) {
  const idx = sellerProducts.findIndex(p => p.id === prodId);
  if (idx !== -1) {
    sellerProducts[idx].inStock = targetInStock;
    renderSellerProducts();
  }
  if (!db || isConfigPlaceholder) return;
  try {
    await updateDoc(doc(db, 'products', prodId), {
      inStock: targetInStock,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.error('[Seller] toggleProductStockState error:', err);
    showToast('Could not update status', 'error');
  }
};

// ─── Delete Product ───────────────────────────────────────────────────────────
window.deleteProductItem = async function(prodId) {
  if (!confirm('Delete this product? This action cannot be undone.')) return;
  if (db && !isConfigPlaceholder) {
    try {
      await deleteDoc(doc(db, 'products', prodId));
    } catch (err) {
      console.error('[Seller] deleteProductItem error:', err);
      showToast('Could not delete product', 'error');
      return;
    }
  } else {
    let demoProds = JSON.parse(localStorage.getItem('zulora_demo_products') || '[]');
    demoProds = demoProds.filter(p => p.id !== prodId);
    localStorage.setItem('zulora_demo_products', JSON.stringify(demoProds));
    sellerProducts = sellerProducts.filter(p => p.id !== prodId);
    renderSellerProducts();
    updateDashboardStats();
  }
  showToast('Product deleted.', 'info');
};

// ─── Render Orders ─────────────────────────────────────────────────────────────
function renderSellerOrders() {
  const container = document.getElementById('liveOrdersContainer');
  if (!container) return;

  if (liveOrders.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🛵</div>
      <p>No orders yet. When buyers place orders from your shop, they'll appear here in real time.</p>
    </div>`;
    return;
  }

  const shopName = currentShop?.shopName || 'our shop';

  container.innerHTML = liveOrders.map(order => {
    const phone    = escapeHtml(order.buyerPhone || '');
    const buyer    = escapeHtml(order.buyerName  || 'Buyer');
    const address  = escapeHtml(order.deliveryAddress || order.address || 'No address provided');
    const total    = (order.grandTotal || order.total || 0).toFixed(2);
    const status   = order.orderStatus || 'Placed';
    const orderId  = order.id.slice(-6).toUpperCase();
    const mapLat   = order.buyerLat || '';
    const mapLng   = order.buyerLng || '';
    const mapHref  = (mapLat && mapLng)
      ? `https://www.google.com/maps/dir/?api=1&destination=${mapLat},${mapLng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    const waMsg = encodeURIComponent(
      `Thank you for your order #${orderId} from ${shopName}! Your order is now ${status}. We appreciate your support!`
    );

    const statusSteps = ['Placed', 'Accepted & Packing', 'Out for Delivery', 'Delivered'];
    const statusBtns = statusSteps.map(s => {
      const isActive = s === status;
      return `<button class="order-status-btn${isActive ? ' active' : ''}"
        onclick="window.updateOrderStatus('${order.id}', '${escapeHtml(s)}')">${s}</button>`;
    }).join('');

    const itemsHtml = Array.isArray(order.items)
      ? order.items.map(it =>
          `<div class="order-item-row">• ${escapeHtml(it.title || 'Item')} × ${it.qty || 1} — ₹${((it.price || 0) * (it.qty || 1)).toFixed(2)}</div>`
        ).join('')
      : '<div class="order-item-row">Order details not available</div>';

    const timeStr = order.createdAt?.toDate
      ? order.createdAt.toDate().toLocaleString('en-IN')
      : (order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN') : 'Unknown time');

    return `<div class="order-card" id="order-card-${order.id}">
      <div class="order-header">
        <div>
          <span class="order-id">Order #${orderId}</span>
          <span style="margin-left:.6rem;padding:2px 10px;border-radius:9999px;font-size:.75rem;font-weight:700;
            background:${statusColorBg(status)};color:${statusColorText(status)};">${status}</span>
        </div>
        <span class="order-time">${timeStr}</span>
      </div>

      <div class="order-buyer">👤 ${buyer}</div>
      <div class="order-address">📍 ${address}</div>

      <div class="order-contact-btns">
        ${phone ? `<a href="tel:+91${phone}" class="btn-call">📞 Call Buyer</a>` : ''}
        ${phone ? `<a href="https://wa.me/91${phone}?text=${waMsg}" target="_blank" rel="noopener" class="btn-whatsapp">💬 WhatsApp</a>` : ''}
        <a href="${mapHref}" target="_blank" rel="noopener" class="btn-maps">🗺️ Open Map</a>
      </div>

      <div class="order-items-list">${itemsHtml}</div>
      <div class="order-total">Grand Total: ₹${total}
        ${order.paymentMethod ? `<span style="font-size:.8rem;color:var(--slate-500);margin-left:.5rem;">(${escapeHtml(order.paymentMethod)})</span>` : ''}
      </div>

      <div class="order-actions">${statusBtns}</div>
    </div>`;
  }).join('');
}

function statusColorBg(status) {
  const m = {
    'Placed':              '#FEF3C7',
    'Accepted & Packing':  '#E0F2FE',
    'Out for Delivery':    '#D1FAE5',
    'Delivered':           '#D1FAE5'
  };
  return m[status] || '#F1F5F9';
}
function statusColorText(status) {
  const m = {
    'Placed':              '#B45309',
    'Accepted & Packing':  '#0369A1',
    'Out for Delivery':    '#059669',
    'Delivered':           '#059669'
  };
  return m[status] || '#475569';
}

// ─── Update Order Status ───────────────────────────────────────────────────────
window.updateOrderStatus = async function(orderDocId, newStatus) {
  // Update local state immediately for responsiveness
  const idx = liveOrders.findIndex(o => o.id === orderDocId);
  if (idx !== -1) {
    liveOrders[idx].orderStatus = newStatus;
    renderSellerOrders();
  }

  const shortId = orderDocId.slice(-6).toUpperCase();
  addNotification(`Order #${shortId} → ${newStatus}`, 'info');

  if (!db || isConfigPlaceholder) return;
  try {
    await updateDoc(doc(db, 'orders', orderDocId), {
      orderStatus: newStatus,
      updatedAt:   serverTimestamp()
    });
  } catch (err) {
    console.error('[Seller] updateOrderStatus error:', err);
    showToast('Could not update order status', 'error');
  }
};

// ─── KPI Stats ─────────────────────────────────────────────────────────────────
function updateDashboardStats() {
  const deliveredOrders = liveOrders.filter(o => o.orderStatus === 'Delivered');
  const gmv = deliveredOrders.reduce((sum, o) => sum + (o.grandTotal || o.total || 0), 0);
  const commission = gmv * PLATFORM_CONSTANTS.PLATFORM_COMMISSION_RATE;
  const activeProducts = sellerProducts.filter(p => p.inStock).length;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('statTotalSales',     `₹${gmv.toFixed(2)}`);
  set('statTotalOrders',    liveOrders.length);
  set('statActiveProducts', activeProducts);
  set('statCommissionOwed', `₹${commission.toFixed(2)}`);

  // Commission ledger
  set('ledgerDeliveredCount', deliveredOrders.length);
  set('ledgerGmv',            `₹${gmv.toFixed(2)}`);
  set('ledgerCommission',     `₹${commission.toFixed(2)}`);
}

// ─── Product Age Helper ────────────────────────────────────────────────────────
function calculateProductAge(timestamp) {
  let createdDate;
  if (timestamp?.toDate) {
    createdDate = timestamp.toDate();
  } else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    createdDate = new Date(timestamp);
  } else {
    return '—';
  }

  const now     = new Date();
  const diffMs  = now - createdDate;
  const diffH   = Math.floor(diffMs / (1000 * 60 * 60));
  const diffD   = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffM   = Math.floor(diffD / 30);

  if (diffH < 24) return `Listed today (${diffH}h ago)`;
  if (diffD < 30) return `Listed ${diffD} day${diffD > 1 ? 's' : ''} ago`;
  return `Listed ${diffM} month${diffM > 1 ? 's' : ''} ago`;
}

// ─── Demo Mode ────────────────────────────────────────────────────────────────
function loadDemoShop() {
  currentSeller = {
    uid:         'demo_seller_uid',
    displayName: 'Demo Seller',
    email:       'demo@zulora.local',
    photoURL:    'https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg'
  };
  currentShop = {
    id:              'demo_shop',
    ownerUid:        'demo_seller_uid',
    shopName:        "Demo Fresh Mart",
    handle:          'demo_fresh_mart',
    category:        'Grocery',
    phone:           '9876543210',
    upiId:           'demoseller@upi',
    deliveryRadiusKm: 5,
    description:     'Your friendly neighbourhood demo store.',
    lat:             PLATFORM_CONSTANTS.DEFAULT_LAT,
    lng:             PLATFORM_CONSTANTS.DEFAULT_LNG,
    isOpen:          true,
    isVerified:      true,
    customCategories: []
  };

  showDashboard(currentSeller);
  populateShopForm(currentShop);
  loadDemoSellerData();
  showToast('🔧 Demo mode — no Firebase configured. Using sample data.', 'info', 6000);
}

function loadDemoSellerData() {
  const now = new Date().toISOString();

  sellerProducts = [
    {
      id:        'demo_prod_1',
      shopId:    'demo_shop',
      sellerUid: 'demo_seller_uid',
      title:     'Organic Basmati Rice 5kg',
      category:  'Grocery',
      price:     450,
      mrp:       520,
      unit:      '5kg bag',
      weightKg:  5,
      stock:     30,
      inStock:   true,
      imageUrl:  'https://placehold.co/400x300?text=Basmati+Rice',
      images:    ['https://placehold.co/400x300?text=Basmati+Rice', 'https://placehold.co/400x300?text=Rice+Bag'],
      salesCount: 12,
      createdAt: now
    },
    {
      id:        'demo_prod_2',
      shopId:    'demo_shop',
      sellerUid: 'demo_seller_uid',
      title:     'Fresh Alphonso Mangoes 1kg',
      category:  'Food',
      price:     149,
      mrp:       199,
      unit:      '1kg',
      weightKg:  1,
      stock:     0,
      inStock:   false,
      imageUrl:  'https://placehold.co/400x300?text=Alphonso+Mango',
      images:    ['https://placehold.co/400x300?text=Alphonso+Mango'],
      salesCount: 8,
      createdAt: now
    }
  ];

  liveOrders = [
    {
      id:              'demo_order_abcdef',
      sellerUid:       'demo_seller_uid',
      shopId:          'demo_shop',
      buyerName:       'Priya Sharma',
      buyerPhone:      '9123456780',
      deliveryAddress: '12A, MG Road, Koramangala, Bengaluru - 560034',
      buyerLat:        12.9378,
      buyerLng:        77.6264,
      items: [
        { title: 'Organic Basmati Rice 5kg', qty: 2, price: 450 },
        { title: 'Fresh Alphonso Mangoes 1kg', qty: 1, price: 149 }
      ],
      grandTotal:    1049,
      paymentMethod: 'UPI',
      orderStatus:   'Placed',
      createdAt:     now
    }
  ];

  renderSellerProducts();
  renderSellerOrders();
  updateDashboardStats();
}

// ─── XSS Helper ───────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
