/**
 * Zulora Local — Seller / Merchant Dashboard v2 (Clean & Production-Ready)
 * Real Firestore & Cloudinary data only — Zero fake/demo products or shops.
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
import { showToast } from './notifications.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentSeller = null;
let currentShop = null;
let sellerProducts = [];
let liveOrders = [];
let unsubscribeOrders = null;
let unsubscribeProducts = null;
let selectedFiles = []; // Array of files from multi-image input

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

  // Shop status toggle (Open / Closed)
  document.getElementById('shopStatusToggle')?.addEventListener('change', handleToggleShopStatus);

  // GPS capture for shop
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

  // Category select: custom category option
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
    showAuthGate();
    return;
  }
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentSeller = user;
      showDashboard(user);
      loadOrCreateShop(user);
    } else {
      currentSeller = null;
      currentShop = null;
      showAuthGate();
    }
  });
}

async function handleSellerLogin() {
  if (isConfigPlaceholder || !auth) {
    showToast('Firebase authentication is initializing or offline.', 'warning');
    return;
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    currentSeller = result.user;
    showToast('Signed in to Seller Mode!', 'success');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Sign-in failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }
}

async function handleSellerLogout() {
  try {
    if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }
    if (unsubscribeProducts) { unsubscribeProducts(); unsubscribeProducts = null; }
    if (auth && !isConfigPlaceholder) await signOut(auth);
    currentSeller = null;
    currentShop = null;
    sellerProducts = [];
    liveOrders = [];
    showAuthGate();
    showToast('Logged out from Seller Mode.', 'info');
  } catch (err) {
    console.error('[Seller] logout error:', err);
  }
}

function showDashboard(user) {
  document.getElementById('authSection')?.classList.add('hidden');
  const dash = document.getElementById('dashboardSection');
  if (dash) { dash.style.display = 'block'; }
  document.getElementById('btnSellerLogout')?.classList.remove('hidden');
  const nameEl = document.getElementById('sellerNameDisplay');
  if (nameEl) nameEl.textContent = user.displayName || user.email || 'Seller';
}

function showAuthGate() {
  document.getElementById('authSection')?.classList.remove('hidden');
  const dash = document.getElementById('dashboardSection');
  if (dash) { dash.style.display = 'none'; }
  document.getElementById('btnSellerLogout')?.classList.add('hidden');
}

// ─── Shop Profile ─────────────────────────────────────────────────────────────
async function loadOrCreateShop(user) {
  if (!db || isConfigPlaceholder) return;
  try {
    const shopRef = doc(db, 'shops', user.uid);
    const snap = await getDoc(shopRef);

    if (snap.exists()) {
      currentShop = { id: snap.id, ...snap.data() };
      populateShopForm(currentShop);
    } else {
      // Create new initial shop document for this user
      const rawHandle = (user.displayName || user.email.split('@')[0])
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 20);

      const initial = {
        ownerUid: user.uid,
        ownerEmail: user.email || '',
        name: user.displayName ? `${user.displayName}'s Shop` : 'Local Shop',
        handle: `@${rawHandle}`,
        phone: '',
        upiId: '',
        whatsapp: '',
        category: 'Food',
        deliveryRadiusKm: 5,
        description: 'Quality local products delivered quickly.',
        lat: null,
        lng: null,
        isOpen: true,
        isVerified: false,
        customCategories: [],
        createdAt: serverTimestamp()
      };
      await setDoc(shopRef, initial);
      currentShop = { id: user.uid, ...initial };
      populateShopForm(currentShop);
    }

    // Listen to real products and live orders
    listenToSellerProducts(user.uid);
    listenToSellerOrders(currentShop.id, user.uid);
  } catch (err) {
    console.error('[Seller] loadOrCreateShop error:', err);
    showToast('Error loading shop profile from Firestore: ' + err.message, 'error');
  }
}

function populateShopForm(shop) {
  if (!shop) return;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val != null) el.value = val;
  };

  setVal('shopName', shop.name || '');
  setVal('shopHandle', shop.handle ? shop.handle.replace(/^@/, '') : '');
  setVal('shopPhone', shop.phone || '');
  setVal('shopUpiId', shop.upiId || '');
  setVal('shopWhatsapp', shop.whatsapp || '');
  setVal('shopDescription', shop.description || '');
  setVal('shopDeliveryRadius', shop.deliveryRadiusKm || 5);

  const radiusVal = document.getElementById('shopRadiusVal');
  if (radiusVal) radiusVal.textContent = shop.deliveryRadiusKm || 5;

  if (shop.category) {
    const catEl = document.getElementById('shopCategory');
    if (catEl) catEl.value = shop.category;
  }

  // GPS coords display
  const coordsDisp = document.getElementById('shopCoordsDisplay');
  if (coordsDisp) {
    if (shop.lat != null && shop.lng != null) {
      coordsDisp.textContent = `📍 Lat: ${shop.lat.toFixed(5)}, Lng: ${shop.lng.toFixed(5)}`;
      coordsDisp.style.color = 'var(--emerald-600)';
    } else {
      coordsDisp.textContent = 'GPS not set yet. Click "Capture Shop GPS" below.';
      coordsDisp.style.color = 'var(--slate-500)';
    }
  }

  // Open/Closed Toggle
  const toggle = document.getElementById('shopStatusToggle');
  const label = document.getElementById('shopStatusLabel');
  const isOpen = shop.isOpen !== false;
  if (toggle) toggle.checked = isOpen;
  if (label) {
    label.textContent = isOpen ? '🟢 Shop Open' : '🔴 Shop Closed';
    label.className = `shop-status-text ${isOpen ? 'status-open' : 'status-closed'}`;
  }

  // Mandatory Agreements
  const isAgreed = shop.agreementsAccepted === true;
  ['agreePricingStock', 'agreeDeliveryHandling', 'agreePlatformCommission', 'agreeProhibitedItems'].forEach(id => {
    const cb = document.getElementById(id);
    if (cb) cb.checked = isAgreed;
  });
}

async function handleToggleShopStatus(e) {
  const isOpen = e.target.checked;
  const label = document.getElementById('shopStatusLabel');
  if (label) {
    label.textContent = isOpen ? '🟢 Shop Open' : '🔴 Shop Closed';
    label.className = `shop-status-text ${isOpen ? 'status-open' : 'status-closed'}`;
  }
  if (!currentShop || !db || isConfigPlaceholder) return;

  try {
    await updateDoc(doc(db, 'shops', currentShop.id), { isOpen, updatedAt: serverTimestamp() });
    currentShop.isOpen = isOpen;
    showToast(isOpen ? 'Shop is now OPEN for orders!' : 'Shop marked as CLOSED.', isOpen ? 'success' : 'info');
  } catch (err) {
    showToast('Failed to update shop status: ' + err.message, 'error');
  }
}

async function handleCaptureShopGps() {
  const btn = document.getElementById('btnCaptureShopGps');
  const disp = document.getElementById('shopCoordsDisplay');
  if (btn) btn.textContent = '⏳ Capturing GPS…';

  try {
    const pos = await getCurrentGpsPosition();
    if (disp) {
      disp.textContent = `📍 Lat: ${pos.lat.toFixed(5)}, Lng: ${pos.lng.toFixed(5)} (±${Math.round(pos.accuracy || 0)}m)`;
      disp.style.color = 'var(--emerald-600)';
    }
    if (currentShop) {
      currentShop.lat = pos.lat;
      currentShop.lng = pos.lng;
    }
    showToast('Shop GPS coordinates captured! Save your profile to apply.', 'success');
  } catch (err) {
    showToast(err.message || 'Could not capture GPS location.', 'error');
  } finally {
    if (btn) btn.textContent = '🛰️ Capture Shop GPS';
  }
}

async function handleSaveShopProfile(e) {
  e.preventDefault();
  if (!currentShop || !db || isConfigPlaceholder) {
    showToast('Please sign in first.', 'warning');
    return;
  }

  const name = document.getElementById('shopName')?.value.trim();
  const rawHandle = document.getElementById('shopHandle')?.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const phone = document.getElementById('shopPhone')?.value.trim();
  const upiId = document.getElementById('shopUpiId')?.value.trim();
  const whatsapp = document.getElementById('shopWhatsapp')?.value.trim();
  const category = document.getElementById('shopCategory')?.value;
  const description = document.getElementById('shopDescription')?.value.trim();
  const radius = parseFloat(document.getElementById('shopDeliveryRadius')?.value || '5');

  if (!name) { showToast('Please enter a shop name.', 'warning'); return; }
  if (!rawHandle) { showToast('Please enter a unique shop handle.', 'warning'); return; }

  // Verify all 4 mandatory seller agreements
  const agree1 = document.getElementById('agreePricingStock')?.checked;
  const agree2 = document.getElementById('agreeDeliveryHandling')?.checked;
  const agree3 = document.getElementById('agreePlatformCommission')?.checked;
  const agree4 = document.getElementById('agreeProhibitedItems')?.checked;
  if (!agree1 || !agree2 || !agree3 || !agree4) {
    showToast('Please check and accept all 4 mandatory seller agreements to activate/save your store.', 'warning');
    return;
  }

  const handle = `@${rawHandle}`;
  const payload = {
    name,
    handle,
    phone,
    upiId,
    whatsapp,
    category,
    description,
    deliveryRadiusKm: radius,
    agreementsAccepted: true,
    agreementsTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (currentShop.lat != null) payload.lat = currentShop.lat;
  if (currentShop.lng != null) payload.lng = currentShop.lng;

  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  try {
    await updateDoc(doc(db, 'shops', currentShop.id), payload);
    Object.assign(currentShop, payload);
    showToast('Shop profile saved successfully!', 'success');
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save Shop Profile'; }
  }
}

// ─── Multi-Image Select & Preview ─────────────────────────────────────────────
function handleMultiImageSelect(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  if (files.length > 6) {
    showToast('Maximum 6 images allowed per product.', 'warning');
    selectedFiles = files.slice(0, 6);
  } else {
    selectedFiles = files;
  }

  const grid = document.getElementById('imagePreviewGrid');
  if (!grid) return;
  grid.innerHTML = '';

  selectedFiles.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const item = document.createElement('div');
      item.className = 'img-preview-item';
      item.style.position = 'relative';
      item.style.aspectRatio = '4/3';
      item.style.borderRadius = 'var(--radius-md)';
      item.style.overflow = 'hidden';
      item.style.border = '1px solid var(--slate-200)';
      item.innerHTML = `
        <img src="${ev.target.result}" alt="Preview ${idx + 1}" style="width:100%;height:100%;object-fit:cover;" />
        <span style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;">
          ${idx === 0 ? 'Cover' : `#${idx + 1}`}
        </span>
        <div id="prog-${idx}" style="position:absolute;bottom:0;left:0;right:0;height:4px;background:var(--emerald-500);width:0%;transition:width 0.2s;"></div>
      `;
      grid.appendChild(item);
    };
    reader.readAsDataURL(file);
  });
}

// ─── Product Upload ───────────────────────────────────────────────────────────
async function handleUploadProduct(e) {
  e.preventDefault();
  if (!currentSeller) {
    showToast('Please sign in to upload products.', 'warning');
    return;
  }

  const title = document.getElementById('productTitle')?.value.trim();
  let category = document.getElementById('productCategory')?.value;
  const customCat = document.getElementById('customCategoryInput')?.value.trim();
  const price = parseFloat(document.getElementById('productPrice')?.value);
  const mrp = parseFloat(document.getElementById('productMrp')?.value) || null;
  const unit = document.getElementById('productUnit')?.value.trim();
  const weight = parseFloat(document.getElementById('productWeight')?.value) || 0.5;
  const stock = parseInt(document.getElementById('productStock')?.value, 10) || 0;
  const inStock = document.getElementById('productInStock')?.checked ?? true;

  if (!title) { showToast('Please enter a product title.', 'warning'); return; }
  if (isNaN(price) || price <= 0) { showToast('Please enter a valid selling price.', 'warning'); return; }

  // Custom category handling
  if (category === 'add_custom') {
    if (!customCat) { showToast('Please type your custom category name.', 'warning'); return; }
    category = customCat;
    if (db && currentShop && !isConfigPlaceholder) {
      try {
        await updateDoc(doc(db, 'shops', currentShop.id), {
          customCategories: arrayUnion(customCat)
        });
      } catch (err) {}
    }
  }

  if (selectedFiles.length === 0) {
    showToast('Please select at least 1 image for the product.', 'warning');
    return;
  }

  const submitBtn = document.getElementById('btnSubmitProduct');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Uploading to Cloudinary…'; }

  try {
    // Upload all selected images simultaneously to Cloudinary
    const uploadResults = await uploadMultipleImages(selectedFiles, (fileIdx, pct) => {
      const bar = document.getElementById(`prog-${fileIdx}`);
      if (bar) bar.style.width = `${pct}%`;
    });

    const imageUrls = uploadResults.map(r => r.url);
    const coverUrl = imageUrls[0];

    const productPayload = {
      shopId: currentShop?.id || currentSeller.uid,
      sellerUid: currentSeller.uid,
      shopName: currentShop?.name || 'Local Seller',
      title,
      category,
      price,
      mrp,
      unit,
      weightKg: weight,
      stock: inStock ? stock : 0,
      inStock: inStock && stock > 0,
      imageUrl: coverUrl,
      images: imageUrls,
      salesCount: 0,
      createdAt: serverTimestamp()
    };

    if (db && !isConfigPlaceholder) {
      await addDoc(collection(db, 'products'), productPayload);
    }

    showToast(`✓ "${title}" uploaded to Cloudinary & saved!`, 'success');

    // Reset upload form
    document.getElementById('productUploadForm')?.reset();
    selectedFiles = [];
    const grid = document.getElementById('imagePreviewGrid');
    if (grid) grid.innerHTML = '';
    const customGroup = document.getElementById('customCategoryGroup');
    if (customGroup) customGroup.classList.add('hidden');
  } catch (err) {
    console.error('[Seller] Upload error:', err);
    showToast('Upload failed: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '🚀 Publish Product'; }
  }
}

// ─── Real Products Listener ───────────────────────────────────────────────────
function listenToSellerProducts(sellerUid) {
  if (unsubscribeProducts) unsubscribeProducts();
  if (!db || isConfigPlaceholder) return;

  const q = query(
    collection(db, 'products'),
    where('sellerUid', '==', sellerUid),
    orderBy('createdAt', 'desc')
  );

  unsubscribeProducts = onSnapshot(q, (snapshot) => {
    sellerProducts = [];
    snapshot.forEach((d) => {
      sellerProducts.push({ id: d.id, ...d.data() });
    });
    renderSellerProducts();
    updateDashboardStats();
  }, (err) => {
    console.error('[Seller] Products onSnapshot error:', err);
  });
}

function renderSellerProducts() {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;

  if (sellerProducts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:2.5rem 1rem;color:var(--slate-500);">
          <div style="font-size:2rem;margin-bottom:0.5rem;">📦</div>
          <p style="font-weight:600;font-size:0.95rem;margin-bottom:0.25rem;">No products uploaded yet.</p>
          <p style="font-size:0.8rem;">Use the form above to upload your first product with images to Cloudinary!</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sellerProducts.map(p => {
    const cover = (p.images && p.images[0]) || p.imageUrl || 'https://via.placeholder.com/80x60?text=No+Img';
    const age = calculateProductAge(p.createdAt);
    const inStock = Boolean(p.inStock && p.stock > 0);

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <img src="${escapeHtml(cover)}" alt="${escapeHtml(p.title)}" style="width:48px;height:36px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--slate-200);flex-shrink:0;" />
            <div>
              <div style="font-weight:700;color:var(--slate-900);font-size:0.85rem;">${escapeHtml(p.title)}</div>
              <div style="font-size:0.72rem;color:var(--slate-400);">${age}</div>
            </div>
          </div>
        </td>
        <td><span class="badge" style="background:var(--slate-100);font-size:0.75rem;">${escapeHtml(p.category)}</span></td>
        <td><strong>₹${p.price}</strong> ${p.mrp ? `<span style="font-size:0.72rem;color:var(--slate-400);text-decoration:line-through;">₹${p.mrp}</span>` : ''}</td>
        <td>
          <span style="font-weight:700;color:${p.stock <= 5 ? 'var(--rose-600)' : 'var(--slate-800)'};">${p.stock}</span>
          <span style="font-size:0.72rem;color:var(--slate-400);">(${escapeHtml(p.unit || 'pcs')})</span>
        </td>
        <td>
          <button class="btn btn-sm ${inStock ? 'btn-success' : 'btn-ghost'}" onclick="window.toggleProductStockState('${escapeHtml(p.id)}', ${inStock})" style="font-size:0.72rem;padding:0.25rem 0.5rem;">
            ${inStock ? '🟢 In Stock' : '🔴 Out of Stock'}
          </button>
        </td>
        <td style="font-size:0.82rem;font-weight:600;">${p.salesCount || 0} sold</td>
        <td>
          <div style="display:flex;gap:0.35rem;">
            <button class="btn btn-icon btn-sm" onclick="window.updateStock('${escapeHtml(p.id)}', ${p.stock})" title="Edit Stock">✏️</button>
            <button class="btn btn-icon btn-sm btn-danger" onclick="window.deleteProductItem('${escapeHtml(p.id)}')" title="Delete Product">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.toggleProductStockState = async function(prodId, currentInStock) {
  if (!db || isConfigPlaceholder) return;
  const newInStock = !currentInStock;
  try {
    await updateDoc(doc(db, 'products', prodId), {
      inStock: newInStock,
      stock: newInStock ? 10 : 0
    });
    showToast(`Product is now ${newInStock ? 'In Stock' : 'Out of Stock'}.`, 'info');
  } catch (err) {
    showToast('Failed to update stock: ' + err.message, 'error');
  }
};

window.updateStock = async function(prodId, currentStock) {
  const entered = prompt('Enter new stock count:', currentStock);
  if (entered == null) return;
  const num = parseInt(entered, 10);
  if (isNaN(num) || num < 0) { showToast('Invalid stock number.', 'warning'); return; }

  if (!db || isConfigPlaceholder) return;
  try {
    await updateDoc(doc(db, 'products', prodId), {
      stock: num,
      inStock: num > 0
    });
    showToast(`Stock updated to ${num}`, 'success');
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
};

window.deleteProductItem = async function(prodId) {
  if (!confirm('Are you sure you want to delete this product?')) return;
  if (!db || isConfigPlaceholder) return;
  try {
    await deleteDoc(doc(db, 'products', prodId));
    showToast('Product deleted.', 'info');
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
};

// ─── Real Live Orders Listener ────────────────────────────────────────────────
function listenToSellerOrders(shopId, sellerUid) {
  if (unsubscribeOrders) unsubscribeOrders();
  if (!db || isConfigPlaceholder) return;

  const q = query(
    collection(db, 'orders'),
    where('shopId', '==', shopId),
    orderBy('createdAt', 'desc')
  );

  unsubscribeOrders = onSnapshot(q, (snapshot) => {
    liveOrders = [];
    snapshot.forEach(d => {
      liveOrders.push({ id: d.id, ...d.data() });
    });
    renderSellerOrders();
    updateDashboardStats();
  }, (err) => {
    console.error('[Seller] Orders onSnapshot error:', err);
  });
}

function renderSellerOrders() {
  const container = document.getElementById('sellerOrdersContainer');
  if (!container) return;

  if (liveOrders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;background:var(--glass-bg);border-radius:var(--radius-lg);border:1px dashed var(--slate-300);">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">📦</div>
        <h4 style="font-size:1.05rem;color:var(--slate-800);margin-bottom:0.25rem;">No Incoming Orders Yet</h4>
        <p style="font-size:0.85rem;color:var(--slate-500);">New customer orders will appear here in real-time with 1-tap call & WhatsApp confirmation buttons.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = liveOrders.map(order => {
    const status = order.orderStatus || 'Placed';
    const cleanPhone = (order.buyerPhone || '').replace(/[^0-9]/g, '');
    const callUrl = `tel:+91${cleanPhone}`;
    const waUrl = `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(`Hi ${order.buyerName}, your Zulora order #${order.orderId || order.id} is confirmed!`)}`;

    return `
      <div class="glass-card" style="padding:1.25rem;margin-bottom:1rem;border-left:4px solid var(--azure-600);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;">
          <div>
            <div style="font-size:1.1rem;font-weight:800;color:var(--slate-900);">Order #${escapeHtml(order.orderId || order.id)}</div>
            <div style="font-size:0.8rem;color:var(--slate-500);">Buyer: <strong>${escapeHtml(order.buyerName)}</strong> (${escapeHtml(order.buyerPhone)})</div>
            <div style="font-size:0.8rem;color:var(--slate-500);">📍 ${escapeHtml(order.buyerAddress)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.25rem;font-weight:800;color:var(--emerald-600);">₹${order.totalAmount || order.grandTotal || 0}</div>
            <span class="badge" style="background:var(--azure-100);color:var(--azure-800);font-size:0.75rem;">${escapeHtml(status)}</span>
          </div>
        </div>

        <!-- Ordered Items list -->
        <div style="background:var(--slate-50);padding:0.6rem 0.85rem;border-radius:var(--radius-md);margin-bottom:0.75rem;font-size:0.82rem;">
          ${(order.items || []).map(i => `<div>• ${escapeHtml(i.title)} × ${i.qty || i.quantity} (₹${(i.price || 0) * (i.qty || i.quantity)})</div>`).join('')}
        </div>

        <!-- 4-step status updater -->
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;margin-bottom:0.75rem;">
          <span style="font-size:0.78rem;font-weight:700;color:var(--slate-600);">Update Status:</span>
          ${['Placed', 'Accepted & Packing', 'Out for Delivery', 'Delivered'].map(s => `
            <button class="btn btn-sm ${status === s ? 'btn-primary' : 'btn-ghost'}" onclick="window.updateOrderStatus('${escapeHtml(order.id)}', '${s}')" style="font-size:0.72rem;padding:0.25rem 0.5rem;">
              ${s}
            </button>
          `).join('')}
        </div>

        <!-- Action buttons -->
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <a href="${callUrl}" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:0.3rem;">
            📞 Call Buyer
          </a>
          <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" style="display:inline-flex;align-items:center;gap:0.3rem;">
            💬 WhatsApp Confirmation
          </a>
        </div>
      </div>
    `;
  }).join('');
}

window.updateOrderStatus = async function(orderDocId, newStatus) {
  if (!db || isConfigPlaceholder) return;
  try {
    await updateDoc(doc(db, 'orders', orderDocId), {
      orderStatus: newStatus,
      statusUpdatedAt: serverTimestamp()
    });
    showToast(`Order status updated to: ${newStatus}`, 'success');
  } catch (err) {
    showToast('Failed to update status: ' + err.message, 'error');
  }
};

// ─── Dashboard Stats & Commission ─────────────────────────────────────────────
function updateDashboardStats() {
  const totalSales = liveOrders.reduce((sum, o) => sum + (o.totalAmount || o.grandTotal || 0), 0);
  const totalOrders = liveOrders.length;
  const activeProducts = sellerProducts.filter(p => p.inStock && p.stock > 0).length;
  const commission = Math.round(totalSales * PLATFORM_CONSTANTS.PLATFORM_COMMISSION_RATE);

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('statTotalSales', `₹${totalSales.toLocaleString('en-IN')}`);
  setEl('statTotalOrders', totalOrders);
  setEl('statActiveProducts', activeProducts);
  setEl('statCommissionOwed', `₹${commission.toLocaleString('en-IN')}`);
}

// ─── Product Age Helper ───────────────────────────────────────────────────────
function calculateProductAge(createdAt) {
  if (!createdAt) return 'Recently';
  let date;
  if (createdAt.toDate) date = createdAt.toDate();
  else if (createdAt.seconds) date = new Date(createdAt.seconds * 1000);
  else date = new Date(createdAt);

  const diffMs = Date.now() - date.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffD = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffH < 24) return `Listed today (${diffH}h ago)`;
  if (diffD < 30) return `Listed ${diffD}d ago`;
  return `Listed ${Math.floor(diffD / 30)}mo ago`;
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
