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

import { uploadMultipleImages, uploadSingleImage } from './cloudinary.js';
import { getCurrentGpsPosition } from './geo-pricing.js';
import { PLATFORM_CONSTANTS } from './config.js';
import { showToast, triggerBrowserNotification, requestNotificationPermission } from './notifications.js';
import { showUnauthorizedDomainDialog } from './auth.js';

// ─── State ────────────────────────────────────────────────────────────────────
let currentSeller = null;
let currentShop = null;
let sellerProducts = [];
let liveOrders = [];
let unsubscribeOrders = null;
let unsubscribeProducts = null;
let unsubscribeOwnerProds = null;
let unsubscribeSellerUid = null;
let selectedFiles = []; // Array of files from multi-image input
let activeOrderFilter = 'all';

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

  // Browser notifications test / request
  document.getElementById('btnSellerTestNotif')?.addEventListener('click', async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      playOrderNotificationChime();
      triggerBrowserNotification('🔔 Zulora Local Alerts Enabled!', 'You will receive real-time notifications whenever a customer places an order.', './seller.html');
      showToast('Push alerts enabled! Sound & notification test sent.', 'success');
    } else {
      showToast('Notification permission was blocked or dismissed in browser settings.', 'warning');
    }
  });

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

  // Order status filter pills
  const filterPills = document.querySelectorAll('.order-filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeOrderFilter = pill.getAttribute('data-filter') || 'all';
      renderSellerOrders();
    });
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function initAuth() {
  if (isConfigPlaceholder || !auth) {
    showAuthGate();
    return;
  }

  // Safety timeout: if Firebase onAuthStateChanged doesn't fire within 6s, show auth gate
  let authResolved = false;
  const authTimeout = setTimeout(() => {
    if (!authResolved) {
      console.warn('[Seller] Auth state timeout — showing login gate');
      showAuthGate();
    }
  }, 6000);

  onAuthStateChanged(auth, (user) => {
    authResolved = true;
    clearTimeout(authTimeout);
    if (user) {
      currentSeller = user;
      showDashboard(user);
      loadOrCreateShop(user);
    } else {
      currentSeller = null;
      currentShop = null;
      showAuthGate();
    }
  }, (err) => {
    authResolved = true;
    clearTimeout(authTimeout);
    console.error('[Seller] onAuthStateChanged error:', err);
    showAuthGate();
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
    if (err.code === 'auth/unauthorized-domain') {
      showUnauthorizedDomainDialog();
    } else if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Sign-in failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }
}

async function handleSellerLogout() {
  const step1 = confirm('Are you sure you want to log out of Seller Mode?');
  if (!step1) return;
  const step2 = confirm('Final check: Log out now? Your shop will stay saved on Zulora.');
  if (!step2) return;
  try {
    if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }
    if (unsubscribeSellerUid) { unsubscribeSellerUid(); unsubscribeSellerUid = null; }
    if (unsubscribeProducts) { unsubscribeProducts(); unsubscribeProducts = null; }
    if (unsubscribeOwnerProds) { unsubscribeOwnerProds(); unsubscribeOwnerProds = null; }
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
  const loading = document.getElementById('authConnectingState');
  if (loading) { loading.classList.add('hidden'); loading.style.display = 'none'; }
  const authSec = document.getElementById('authSection');
  if (authSec) { authSec.classList.add('hidden'); authSec.style.display = 'none'; }
  const dash = document.getElementById('dashboardSection');
  if (dash) { dash.classList.remove('hidden'); dash.style.display = 'block'; }
  document.getElementById('btnSellerLogout')?.classList.remove('hidden');
  const nameEl = document.getElementById('sellerNameDisplay');
  if (nameEl) nameEl.textContent = user.displayName || user.email || 'Seller';
  requestNotificationPermission().catch(() => {});
}

function showAuthGate() {
  const loading = document.getElementById('authConnectingState');
  if (loading) { loading.classList.add('hidden'); loading.style.display = 'none'; }
  const authSec = document.getElementById('authSection');
  if (authSec) { authSec.classList.remove('hidden'); authSec.style.display = 'flex'; }
  const dash = document.getElementById('dashboardSection');
  if (dash) { dash.classList.add('hidden'); dash.style.display = 'none'; }
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
        sellerUid: user.uid,
        ownerEmail: user.email || '',
        name: user.displayName ? `${user.displayName}'s Shop` : 'Local Shop',
        handle: `@${rawHandle}`,
        phone: '',
        upiId: '',
        whatsapp: '',
        category: 'Food',
        deliveryRadiusKm: 5,
        perKmRate: 15,
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
    if (!currentShop) {
      currentShop = { id: user.uid, ownerUid: user.uid, sellerUid: user.uid, name: user.displayName || 'Local Shop' };
    }
    listenToSellerProducts(user.uid);
    listenToSellerOrders(user.uid, user.uid);
  } finally {
    const loading = document.getElementById('authConnectingState');
    if (loading) { loading.classList.add('hidden'); loading.style.display = 'none'; }
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
  setVal('shopCity', shop.city || shop.town || '');
  setVal('shopPhone', shop.phone || '');
  setVal('productSellerPhone', shop.phone || currentSeller?.phoneNumber || '');
  setVal('shopUpiId', shop.upiId || '');
  setVal('shopWhatsapp', shop.whatsapp || '');
  setVal('shopDescription', shop.description || '');
  setVal('shopDeliveryRadius', shop.deliveryRadiusKm || 5);
  setVal('shopPerKmRate', shop.perKmRate || 15);
  setVal('shopLat', shop.lat != null ? shop.lat : '');
  setVal('shopLng', shop.lng != null ? shop.lng : '');

  if (shop.upiQrImageUrl) {
    const qrEl = document.getElementById('shopQrPreview');
    if (qrEl) {
      qrEl.src = shop.upiQrImageUrl;
      qrEl.classList.remove('hidden');
    }
  }

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

  checkSellerEligibility();
}

function checkSellerEligibility() {
  const banner = document.getElementById('sellerEligibilityBanner');
  const isProfileConfigured = Boolean(currentShop && currentShop.name && (currentShop.phone || currentShop.agreementsAccepted));
  if (banner) {
    if (isProfileConfigured) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  }
  return isProfileConfigured;
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
  const latInput = document.getElementById('shopLat');
  const lngInput = document.getElementById('shopLng');
  const cityInput = document.getElementById('shopCity');
  if (btn) btn.textContent = '⏳ Capturing GPS…';

  try {
    const pos = await getCurrentGpsPosition();
    if (latInput) latInput.value = pos.lat;
    if (lngInput) lngInput.value = pos.lng;
    if (cityInput && (!cityInput.value || cityInput.value === 'Local Market') && pos.town) {
      cityInput.value = pos.town;
    }
    const locName = pos.town ? (pos.region ? `${pos.town}, ${pos.region}` : pos.town) : '';
    if (disp) {
      disp.textContent = `📍 ${locName ? locName + ' ' : ''}(${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} ±${Math.round(pos.accuracy || 0)}m)`;
      disp.style.color = 'var(--emerald-600)';
    }
    if (currentShop) {
      currentShop.lat = pos.lat;
      currentShop.lng = pos.lng;
      if (pos.town) currentShop.city = pos.town;
      if (pos.region) currentShop.region = pos.region;
    }
    showToast('Shop GPS & City captured! Click "Save Shop Profile" to apply.', 'success');
  } catch (err) {
    showToast(err.message || 'Could not capture GPS location.', 'error');
  } finally {
    if (btn) btn.textContent = '🛰️ Capture My GPS';
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
  const city = document.getElementById('shopCity')?.value.trim();
  const phone = document.getElementById('shopPhone')?.value.trim();
  const upiId = document.getElementById('shopUpiId')?.value.trim();
  const whatsapp = document.getElementById('shopWhatsapp')?.value.trim();
  const category = document.getElementById('shopCategory')?.value;
  const description = document.getElementById('shopDescription')?.value.trim();
  const radius = parseFloat(document.getElementById('shopDeliveryRadius')?.value || '5');
  const perKmRate = parseFloat(document.getElementById('shopPerKmRate')?.value || '15') || 15;

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
    city: city || 'Local Market',
    town: city || 'Local Market',
    phone,
    upiId,
    whatsapp,
    category,
    description,
    deliveryRadiusKm: radius,
    perKmRate: perKmRate,
    agreementsAccepted: true,
    agreementsTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  // Upload UPI QR Code Image if new file selected
  const qrInput = document.getElementById('shopUpiQrImage');
  if (qrInput && qrInput.files && qrInput.files[0]) {
    try {
      showToast('Uploading UPI QR Code image to Cloudinary…', 'info');
      const uploadRes = await uploadSingleImage(qrInput.files[0]);
      payload.upiQrImageUrl = uploadRes.url;
    } catch (err) {
      console.warn('[Seller] QR upload notice:', err);
    }
  } else if (currentShop.upiQrImageUrl) {
    payload.upiQrImageUrl = currentShop.upiQrImageUrl;
  }

  const manualLat = parseFloat(document.getElementById('shopLat')?.value);
  const manualLng = parseFloat(document.getElementById('shopLng')?.value);
  if (!isNaN(manualLat) && !isNaN(manualLng)) {
    payload.lat = manualLat;
    payload.lng = manualLng;
  } else {
    if (currentShop.lat != null) payload.lat = currentShop.lat;
    if (currentShop.lng != null) payload.lng = currentShop.lng;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  try {
    await updateDoc(doc(db, 'shops', currentShop.id), payload);
    Object.assign(currentShop, payload);
    checkSellerEligibility();
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
  const rawSellerPhone = document.getElementById('productSellerPhone')?.value.trim();
  const price = parseFloat(document.getElementById('productPrice')?.value);
  const mrp = parseFloat(document.getElementById('productMrp')?.value) || null;
  const unit = document.getElementById('productUnit')?.value.trim();
  const weight = parseFloat(document.getElementById('productWeightKg')?.value || document.getElementById('productWeight')?.value) || 0.5;
  const rawStock = parseInt(document.getElementById('productStock')?.value, 10);
  const stockCount = (!isNaN(rawStock) && rawStock >= 0) ? rawStock : 0;
  const inStock = stockCount > 0;

  if (!title) { showToast('Please enter a product title.', 'warning'); return; }
  if (isNaN(price) || price <= 0) { showToast('Please enter a valid selling price.', 'warning'); return; }

  // Mandatory seller mobile phone validation
  const cleanSellerPhone = (rawSellerPhone || '').replace(/[^0-9]/g, '');
  if (!cleanSellerPhone || cleanSellerPhone.length < 10) {
    showToast('Please enter a valid 10-digit seller mobile contact number so buyers can reach you.', 'warning');
    document.getElementById('productSellerPhone')?.focus();
    return;
  }

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
      ownerUid: currentSeller.uid,
      sellerUid: currentSeller.uid,
      shopId: currentShop?.id || currentSeller.uid,
      sellerPhone: cleanSellerPhone,
      sellerName: currentShop?.name || currentSeller.displayName || 'Merchant',
      shopName: currentShop?.name || 'Local Seller',
      title,
      category,
      price,
      mrp,
      unit: unit || '1 unit',
      weightKg: weight,
      stockCount: stockCount,
      stock: stockCount,
      inStock: inStock,
      imageUrl: coverUrl,
      images: imageUrls,
      salesCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (db && !isConfigPlaceholder) {
      await addDoc(collection(db, 'products'), productPayload);
      // Auto-sync seller phone to shop document if not saved yet
      if (currentShop && (!currentShop.phone || currentShop.phone !== cleanSellerPhone)) {
        currentShop.phone = cleanSellerPhone;
        updateDoc(doc(db, 'shops', currentShop.id), { phone: cleanSellerPhone, updatedAt: serverTimestamp() }).catch(() => {});
      }
    }

    showToast(`✓ "${title}" uploaded to Cloudinary & saved!`, 'success');

    // Reset upload form
    document.getElementById('productUploadForm')?.reset();
    selectedFiles = [];
    const grid = document.getElementById('imagePreviewGrid');
    if (grid) grid.innerHTML = '';
    const customGroup = document.getElementById('customCategoryGroup');
    if (customGroup) customGroup.classList.add('hidden');
    // Re-fill seller phone
    const phoneInput = document.getElementById('productSellerPhone');
    if (phoneInput) phoneInput.value = cleanSellerPhone;
  } catch (err) {
    console.error('[Seller] Upload error:', err);
    showToast('Upload failed: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '➕ Upload Product to Store'; }
  }
}

// ─── Real Products Listener (Dual Parallel Streams: sellerUid + ownerUid) ───────
function listenToSellerProducts(sellerUid) {
  if (unsubscribeProducts) { unsubscribeProducts(); unsubscribeProducts = null; }
  if (unsubscribeOwnerProds) { unsubscribeOwnerProds(); unsubscribeOwnerProds = null; }
  if (!db || isConfigPlaceholder || !sellerUid) return;

  const prodsMap = new Map();

  const handleProdsUpdate = () => {
    const prods = Array.from(prodsMap.values());
    prods.sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a));
    sellerProducts = prods;
    renderSellerProducts();
    updateDashboardStats();
  };

  // Stream 1: Query products where sellerUid == sellerUid
  const qSeller = query(collection(db, 'products'), where('sellerUid', '==', sellerUid));
  unsubscribeProducts = onSnapshot(qSeller, (snapshot) => {
    snapshot.forEach((d) => {
      prodsMap.set(d.id, { id: d.id, ...d.data() });
    });
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'removed') prodsMap.delete(change.doc.id);
    });
    handleProdsUpdate();
  }, (err) => {
    console.warn('[Seller] Products (sellerUid) stream notice:', err);
  });

  // Stream 2: Query products where ownerUid == sellerUid (ensures 100% of owner's products are surfaced)
  const qOwner = query(collection(db, 'products'), where('ownerUid', '==', sellerUid));
  unsubscribeOwnerProds = onSnapshot(qOwner, (snapshot) => {
    snapshot.forEach((d) => {
      prodsMap.set(d.id, { id: d.id, ...d.data() });
    });
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'removed') prodsMap.delete(change.doc.id);
    });
    handleProdsUpdate();
  }, (err) => {
    console.warn('[Seller] Products (ownerUid) stream notice:', err);
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
  if (!auth?.currentUser) {
    showToast('Please sign in with Google to delete products.', 'warning');
    return;
  }
  if (!prodId) {
    showToast('Cannot delete product: Invalid product ID.', 'error');
    return;
  }

  const prod = sellerProducts.find(p => p.id === prodId);
  const title = prod?.title ? `"${prod.title}"` : 'this product';

  if (!confirm(`Are you sure you want to permanently delete ${title}?\nThis action cannot be undone and will immediately remove it from the storefront.`)) return;
  if (!db || isConfigPlaceholder) return;

  try {
    await deleteDoc(doc(db, 'products', prodId));
    // Immediately remove from local array for instant UI response
    sellerProducts = sellerProducts.filter(p => p.id !== prodId);
    renderSellerProducts();
    updateDashboardStats();
    showToast(`✓ Deleted ${title} successfully.`, 'success');
  } catch (err) {
    console.error('[Seller] Delete product failed:', err);
    const errCode = err.code || 'unknown';
    const errMsg = err.message || 'Permission denied or network failure.';
    if (errCode === 'permission-denied') {
      showToast(`Delete failed: Missing or insufficient permissions (${errCode}). Logged in as: ${auth.currentUser.email || auth.currentUser.uid}. Ensure Firestore rules allow product owners to delete products.`, 'error');
    } else {
      showToast(`Delete failed: ${errMsg} (${errCode})`, 'error');
    }
  }
};

// ─── Real Live Orders Listener (Dual parallel queries: shopId + sellerUid) ──
let _prevOrderCount = -1; // track new order arrivals for browser notification

function listenToSellerOrders(shopId, sellerUid) {
  if (unsubscribeOrders) { unsubscribeOrders(); unsubscribeOrders = null; }
  if (unsubscribeSellerUid) { unsubscribeSellerUid(); unsubscribeSellerUid = null; }
  if (!db || isConfigPlaceholder) return;

  const ordersMap = new Map();

  // Always run BOTH queries simultaneously and merge results for full coverage:
  // Query 1: by shopId (orders placed at the seller's shop document)
  const qShop = query(collection(db, 'orders'), where('shopId', '==', shopId));
  unsubscribeOrders = onSnapshot(qShop, (snapshot) => {
    snapshot.forEach(d => {
      ordersMap.set(d.id, { id: d.id, docId: d.id, ...d.data() });
    });
    // Handle deletions from this query's scope
    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed') ordersMap.delete(change.doc.id);
    });
    processSellerOrders(Array.from(ordersMap.values()));
  }, (err) => {
    console.warn('[Seller] ShopId orders stream notice:', err);
    processSellerOrders(Array.from(ordersMap.values()));
  });

  // Query 2: by sellerUid (unconditional parallel query so all orders matching sellerUid are captured)
  if (sellerUid) {
    const qUid = query(collection(db, 'orders'), where('sellerUid', '==', sellerUid));
    unsubscribeSellerUid = onSnapshot(qUid, (snap) => {
      snap.forEach(d => {
        ordersMap.set(d.id, { id: d.id, docId: d.id, ...d.data() });
      });
      snap.docChanges().forEach(change => {
        if (change.type === 'removed') ordersMap.delete(change.doc.id);
      });
      processSellerOrders(Array.from(ordersMap.values()));
    }, (err) => {
      console.warn('[Seller] SellerUid orders stream notice:', err);
      processSellerOrders(Array.from(ordersMap.values()));
    });
  }
}

function playOrderNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

function processSellerOrders(newOrders) {
  // Sort in memory by createdAt descending
  newOrders.sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a));

  // Trigger browser notification and sound chime when a NEW order arrives (count increased)
  if (_prevOrderCount >= 0 && newOrders.length > _prevOrderCount) {
    const newest = newOrders[0];
    playOrderNotificationChime();
    showToast(`🛒 New Order #${newest.orderCode || newest.orderId || newest.id} from ${newest.buyerName || 'a customer'}!`, 'success');
    triggerBrowserNotification(
      '🛒 New Order on Zulora Local!',
      `Order #${newest.orderCode || newest.orderId || newest.id} from ${newest.buyerName || 'a customer'} — ₹${newest.totalAmount || newest.grandTotal || 0}`,
      './seller.html'
    );
  }
  _prevOrderCount = newOrders.length;

  liveOrders = newOrders;
  renderSellerOrders();
  updateDashboardStats();
}

function getOrderTimestamp(order) {
  if (!order) return 0;
  if (order.createdAt?.toMillis) return order.createdAt.toMillis();
  if (order.createdAt?.seconds) return order.createdAt.seconds * 1000;
  if (order.createdAtIso) return new Date(order.createdAtIso).getTime();
  if (typeof order.createdAt === 'number') return order.createdAt;
  if (typeof order.createdAt === 'string') return new Date(order.createdAt).getTime();
  return 0;
}

function renderSellerOrders() {
  const container = document.getElementById('liveOrdersContainer') || document.getElementById('sellerOrdersContainer');
  if (!container) return;

  const isEligible = checkSellerEligibility();
  if (!isEligible) {
    container.innerHTML = `
      <div style="text-align:center;padding:2.5rem 1rem;background:var(--slate-50);border-radius:var(--radius-lg);border:1px dashed var(--amber-300);">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">🏪</div>
        <h4 style="font-size:1.05rem;color:var(--slate-800);margin-bottom:0.35rem;">Complete Shop Profile to Unlock Orders</h4>
        <p style="font-size:0.85rem;color:var(--slate-600);max-width:480px;margin:0 auto 1rem;">
          To receive live customer orders and use Merchant Confirmation, fill out and save your Shop Profile &amp; Agreements below.
        </p>
        <a href="#shopProfileForm" class="btn btn-primary" style="font-size:0.82rem;padding:0.4rem 0.9rem;">
          Complete Shop Profile ↓
        </a>
      </div>
    `;
    return;
  }

  // Filter orders by active filter pill
  let filtered = liveOrders;
  if (activeOrderFilter === 'placed') {
    filtered = liveOrders.filter(o => normalizeStatus(o.orderStatus || o.status) === 'Placed');
  } else if (activeOrderFilter === 'confirmed') {
    filtered = liveOrders.filter(o => normalizeStatus(o.orderStatus || o.status) === 'Confirmed by Merchant');
  } else if (activeOrderFilter === 'out_for_delivery') {
    filtered = liveOrders.filter(o => normalizeStatus(o.orderStatus || o.status) === 'Packed / Out for Delivery');
  } else if (activeOrderFilter === 'delivered') {
    filtered = liveOrders.filter(o => {
      const s = normalizeStatus(o.orderStatus || o.status);
      return s === 'Delivered' || s === 'Verified Delivered';
    });
  } else if (activeOrderFilter === 'cancelled') {
    filtered = liveOrders.filter(o => normalizeStatus(o.orderStatus || o.status) === 'Cancelled');
  }

  if (filtered.length === 0) {
    const filterLabels = {
      all: 'No incoming orders yet. When buyers place orders from your shop, they will appear here in real time.',
      placed: 'No newly placed orders pending merchant confirmation.',
      confirmed: 'No orders currently in Confirmed status.',
      out_for_delivery: 'No orders currently out for delivery.',
      delivered: 'No orders marked as Delivered yet.',
      cancelled: 'No cancelled orders.'
    };
    container.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;background:var(--glass-bg);border-radius:var(--radius-lg);border:1px dashed var(--slate-300);">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">📦</div>
        <h4 style="font-size:1.05rem;color:var(--slate-800);margin-bottom:0.25rem;">No Orders in this View</h4>
        <p style="font-size:0.85rem;color:var(--slate-500);">${filterLabels[activeOrderFilter] || 'No orders found.'}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(order => {
    const rawStatus = order.orderStatus || order.status || 'Placed';
    const status = normalizeStatus(rawStatus);
    const cleanPhone = (order.buyerPhone || '').replace(/[^0-9]/g, '');
    const callUrl = cleanPhone ? `tel:+91${cleanPhone}` : '#';
    const waUrl = cleanPhone ? `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(`Hi ${order.buyerName}, your Zulora Local order #${order.orderCode || order.orderId || order.id} is confirmed!`)}` : '#';
    const dist = (order.distanceKm != null || order.distKm != null) ? `${order.distanceKm ?? order.distKm} km` : 'Local';

    return `
      <div class="glass-card" style="padding:1.25rem;margin-bottom:1rem;border-left:4px solid var(--azure-600);box-shadow:var(--shadow-sm);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;">
          <div>
            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
              <span style="font-size:1.1rem;font-weight:800;color:var(--slate-900);">Order #${escapeHtml(order.orderCode || order.orderId || order.id)}</span>
              <span class="badge" style="background:${getStatusBadgeColor(status)};color:#fff;font-size:0.75rem;">${escapeHtml(status)}</span>
            </div>
            <div style="font-size:0.82rem;color:var(--slate-700);margin-top:0.25rem;">
              Buyer: <strong>${escapeHtml(order.buyerName || 'Customer')}</strong> ${cleanPhone ? `(<a href="${callUrl}" style="color:var(--azure-700);font-weight:700;">+91 ${escapeHtml(cleanPhone)}</a>)` : ''}
            </div>
            <div style="font-size:0.8rem;color:var(--slate-600);margin-top:0.2rem;">
              📍 Address: ${escapeHtml(order.buyerAddress || 'Address on file')}${order.buyerCityTown ? `, ${escapeHtml(order.buyerCityTown)}` : ''}${order.buyerState ? `, ${escapeHtml(order.buyerState)}` : ''}
            </div>
            <div style="font-size:0.78rem;color:var(--azure-800);margin-top:0.2rem;font-weight:600;">
              📍 Distance: ${dist} • Mode: ${escapeHtml(order.paymentMethod || order.paymentMode || 'COD')}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.3rem;font-weight:900;color:var(--emerald-600);">₹${order.totalAmount || order.grandTotal || 0}</div>
            <div style="font-size:0.72rem;color:var(--slate-400);">${formatOrderDate(order.createdAt || order.createdAtIso)}</div>
          </div>
        </div>

        <!-- Ordered Items list -->
        <div style="background:var(--slate-50);border:1px solid var(--slate-200);padding:0.65rem 0.85rem;border-radius:var(--radius-md);margin-bottom:0.75rem;font-size:0.82rem;">
          <div style="font-weight:700;color:var(--slate-700);margin-bottom:0.35rem;">Ordered Items:</div>
          ${(order.items || []).map(i => `<div style="display:flex;justify-content:space-between;padding:0.2rem 0;border-bottom:1px dashed var(--slate-200);">
            <span>• ${escapeHtml(i.title)} ${i.unit ? `(${escapeHtml(i.unit)})` : ''} × ${i.qty || i.quantity}</span>
            <span style="font-weight:700;">₹${(i.price || 0) * (i.qty || i.quantity)}</span>
          </div>`).join('')}
          <div style="display:flex;justify-content:space-between;padding-top:0.35rem;font-size:0.82rem;font-weight:700;">
            <span>Subtotal: ₹${order.subtotal || order.itemsSubtotal || 0} + Delivery: ₹${order.deliveryCharge || order.baseDeliveryFee || 15}</span>
            <span style="color:var(--azure-800);">Total: ₹${order.totalAmount || order.grandTotal || 0}</span>
          </div>
        </div>

        <!-- 4 Action Buttons: Confirm, Out for Delivery, Delivered, Cancel -->
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;margin-bottom:0.75rem;background:#f8fafc;padding:0.5rem;border-radius:var(--radius-md);">
          <span style="font-size:0.78rem;font-weight:800;color:var(--slate-700);margin-right:0.25rem;">Live Action:</span>
          
          <button class="btn btn-sm ${status === 'Confirmed by Merchant' ? 'btn-primary' : 'btn-ghost'}" 
            onclick="window.updateOrderStatus('${escapeHtml(order.id || order.docId)}', 'Confirmed by Merchant')" 
            style="font-size:0.75rem;padding:0.3rem 0.65rem;font-weight:700;">
            ✅ Confirm Order
          </button>

          <button class="btn btn-sm ${status === 'Packed / Out for Delivery' ? 'btn-primary' : 'btn-ghost'}" 
            onclick="window.updateOrderStatus('${escapeHtml(order.id || order.docId)}', 'Packed / Out for Delivery')" 
            style="font-size:0.75rem;padding:0.3rem 0.65rem;font-weight:700;">
            🛵 Out for Delivery
          </button>

          <button class="btn btn-sm ${status === 'Delivered' || status === 'Verified Delivered' ? 'btn-primary' : 'btn-ghost'}" 
            onclick="window.updateOrderStatus('${escapeHtml(order.id || order.docId)}', 'Delivered')" 
            style="font-size:0.75rem;padding:0.3rem 0.65rem;font-weight:700;${status === 'Delivered' || status === 'Verified Delivered' ? 'background:var(--emerald-600);border-color:var(--emerald-600);' : ''}">
            🎉 Mark Delivered
          </button>

          <button class="btn btn-sm btn-ghost" 
            onclick="window.sellerCancelOrder('${escapeHtml(order.id || order.docId)}')" 
            style="font-size:0.75rem;padding:0.3rem 0.65rem;color:var(--rose-600);border-color:var(--rose-200);">
            ✕ Cancel Order
          </button>
        </div>

        <!-- Customer Communication links -->
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          ${cleanPhone ? `
            <a href="${callUrl}" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:0.3rem;">
              📞 Call Buyer
            </a>
            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" style="display:inline-flex;align-items:center;gap:0.3rem;">
              💬 WhatsApp Confirmation
            </a>
          ` : `
            <span style="font-size:0.75rem;color:var(--slate-400);">No buyer phone recorded</span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

window.updateOrderStatus = async function(orderDocId, newStatus) {
  if (!db || isConfigPlaceholder) return;
  const updates = {
    orderStatus: newStatus,
    statusUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const norm = normalizeStatus(newStatus);
  if (norm === 'Confirmed by Merchant') {
    updates.status = 'confirmed';
    updates.confirmedAt = serverTimestamp();
  } else if (norm === 'Packed / Out for Delivery') {
    updates.status = 'out_for_delivery';
    updates.outForDeliveryAt = serverTimestamp();
  } else if (norm === 'Delivered') {
    updates.status = 'delivered';
    updates.deliveredAt = serverTimestamp();
  } else if (norm === 'Cancelled') {
    updates.status = 'cancelled';
    updates.cancelledAt = serverTimestamp();
    updates.cancelledBy = 'merchant';
  } else {
    updates.status = newStatus.toLowerCase();
  }

  try {
    await updateDoc(doc(db, 'orders', orderDocId), updates);
    // Optimistic local update
    const o = liveOrders.find(ord => (ord.id === orderDocId || ord.docId === orderDocId));
    if (o) {
      o.orderStatus = newStatus;
      o.status = updates.status;
      renderSellerOrders();
      updateDashboardStats();
    }
    showToast(`✓ Order status updated to: ${newStatus}`, 'success');
  } catch (err) {
    console.error('[Seller] updateOrderStatus failed:', err);
    showToast('Failed to update status: ' + (err.message || err.code || 'Permission error'), 'error');
  }
};

window.sellerCancelOrder = async function(orderDocId) {
  if (!confirm('Are you sure you want to cancel this order? This will update the customer status immediately.')) return;
  if (!db || isConfigPlaceholder) return;
  try {
    await updateDoc(doc(db, 'orders', orderDocId), {
      orderStatus: 'Cancelled',
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      cancelledBy: 'merchant',
      statusUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    // Optimistic local update
    const o = liveOrders.find(ord => (ord.id === orderDocId || ord.docId === orderDocId));
    if (o) {
      o.orderStatus = 'Cancelled';
      o.status = 'cancelled';
      renderSellerOrders();
      updateDashboardStats();
    }
    showToast('Order cancelled.', 'info');
  } catch (err) {
    showToast('Failed to cancel order: ' + err.message, 'error');
  }
};

function normalizeStatus(st) {
  if (!st) return 'Placed';
  const lower = st.toLowerCase().trim();
  if (lower === 'placed') return 'Placed';
  if (lower.includes('confirm') || lower.includes('approved') || lower.includes('accepted')) return 'Confirmed by Merchant';
  if (lower.includes('pack') || lower.includes('out for delivery')) return 'Packed / Out for Delivery';
  if (lower.includes('verified')) return 'Verified Delivered';
  if (lower.includes('deliver')) return 'Delivered';
  if (lower.includes('cancel')) return 'Cancelled';
  return st;
}

function getStatusBadgeColor(status) {
  switch(status) {
    case 'Placed': return 'var(--azure-600)';
    case 'Confirmed by Merchant': return 'var(--emerald-600)';
    case 'Packed / Out for Delivery': return '#d97706';
    case 'Delivered':
    case 'Verified Delivered': return 'var(--emerald-700)';
    case 'Cancelled': return 'var(--rose-600)';
    default: return 'var(--slate-600)';
  }
}

// ─── Dashboard Stats & Analytical Breakdown ──────────────────────────────────
function updateDashboardStats() {
  const totalSales = liveOrders.reduce((sum, o) => sum + (o.totalAmount || o.grandTotal || 0), 0);
  const deliveredRevenue = liveOrders
    .filter(o => {
      const s = normalizeStatus(o.orderStatus || o.status);
      return s === 'Delivered' || s === 'Verified Delivered';
    })
    .reduce((sum, o) => sum + (o.totalAmount || o.grandTotal || 0), 0);

  const totalOrders = liveOrders.length;
  let pendingOrders = 0;
  let confirmedOrders = 0;
  let outForDeliveryOrders = 0;
  let deliveredOrders = 0;
  let cancelledOrders = 0;

  liveOrders.forEach(o => {
    const s = normalizeStatus(o.orderStatus || o.status);
    if (s === 'Placed') pendingOrders++;
    else if (s === 'Confirmed by Merchant') confirmedOrders++;
    else if (s === 'Packed / Out for Delivery') outForDeliveryOrders++;
    else if (s === 'Delivered' || s === 'Verified Delivered') deliveredOrders++;
    else if (s === 'Cancelled') cancelledOrders++;
  });

  const activeProducts = sellerProducts.filter(p => p.inStock && p.stock > 0).length;
  const lowStockCount = sellerProducts.filter(p => (p.stock <= 5 || !p.inStock)).length;
  const commission = Math.round(totalSales * PLATFORM_CONSTANTS.PLATFORM_COMMISSION_RATE);

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('statTotalSales', `₹${totalSales.toLocaleString('en-IN')}`);
  setEl('statDeliveredRevenue', `₹${deliveredRevenue.toLocaleString('en-IN')}`);
  setEl('statTotalOrders', totalOrders);
  setEl('statPendingOrders', pendingOrders);
  setEl('statConfirmedOrders', confirmedOrders);
  setEl('statOutForDeliveryOrders', outForDeliveryOrders);
  setEl('statDeliveredOrders', deliveredOrders);
  setEl('statCancelledOrders', cancelledOrders);
  setEl('statActiveProducts', activeProducts);
  setEl('statLowStockCount', lowStockCount);
  setEl('statCommissionOwed', `₹${commission.toLocaleString('en-IN')}`);

  // Update order filter pill counts
  setEl('countFilterAll', totalOrders);
  setEl('countFilterPlaced', pendingOrders);
  setEl('countFilterConfirmed', confirmedOrders);
  setEl('countFilterOut', outForDeliveryOrders);
  setEl('countFilterDelivered', deliveredOrders);
  setEl('countFilterCancelled', cancelledOrders);

  // Update commission ledger card
  setEl('ledgerDeliveredCount', deliveredOrders);
  setEl('ledgerGmv', `₹${deliveredRevenue.toLocaleString('en-IN')}`);
  setEl('ledgerCommission', `₹${Math.round(deliveredRevenue * PLATFORM_CONSTANTS.PLATFORM_COMMISSION_RATE).toLocaleString('en-IN')}`);

  // Render product performance breakdown and recent activity
  renderAnalyticsProductBreakdown();
  renderRecentActivityFeed();
}

// ─── Product Performance Breakdown Table ──────────────────────────────────────
function renderAnalyticsProductBreakdown() {
  const tbody = document.getElementById('analyticsProductTableBody');
  if (!tbody) return;

  if (sellerProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:1.5rem;color:var(--slate-400);">No products uploaded yet. Upload products above to track performance.</td></tr>`;
    return;
  }

  tbody.innerHTML = sellerProducts.map(p => {
    const cover = (p.images && p.images[0]) || p.imageUrl || 'https://via.placeholder.com/80x60?text=No+Img';
    const age = calculateProductAge(p.createdAt);
    const sold = p.salesCount || 0;
    const estRev = sold * (p.price || 0);
    const inStock = Boolean(p.inStock && p.stock > 0);
    const stockStatus = inStock 
      ? (p.stock <= 5 ? '<span style="color:var(--amber-600);font-weight:700;">⚠️ Low Stock</span>' : '<span style="color:var(--emerald-600);font-weight:700;">🟢 In Stock</span>')
      : '<span style="color:var(--rose-600);font-weight:700;">🔴 Out of Stock</span>';

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:0.6rem;">
            <img src="${escapeHtml(cover)}" alt="" style="width:36px;height:36px;border-radius:4px;object-fit:cover;border:1px solid var(--slate-200);flex-shrink:0;" />
            <span style="font-weight:700;color:var(--slate-900);font-size:0.82rem;">${escapeHtml(p.title)}</span>
          </div>
        </td>
        <td><span class="badge" style="background:var(--slate-100);font-size:0.72rem;">${escapeHtml(p.category)}</span></td>
        <td><strong>₹${p.price}</strong></td>
        <td style="font-weight:700;color:var(--azure-800);">${sold} units</td>
        <td style="font-weight:800;color:var(--emerald-600);">₹${estRev.toLocaleString('en-IN')}</td>
        <td style="font-weight:700;">${p.stock} <span style="font-size:0.72rem;color:var(--slate-400);">(${escapeHtml(p.unit || 'pcs')})</span></td>
        <td>${stockStatus}</td>
        <td style="font-size:0.75rem;color:var(--slate-400);">${age}</td>
      </tr>
    `;
  }).join('');
}

// ─── Recent Order Activity Feed ───────────────────────────────────────────────
function renderRecentActivityFeed() {
  const container = document.getElementById('recentActivityFeed');
  if (!container) return;

  if (liveOrders.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:1rem;color:var(--slate-400);font-size:0.85rem;">No recent order activity recorded.</div>`;
    return;
  }

  const recent = liveOrders.slice(0, 6);
  container.innerHTML = recent.map(o => {
    const rawStatus = o.orderStatus || o.status || 'Placed';
    const status = normalizeStatus(rawStatus);
    const dateStr = formatOrderDate(o.createdAt || o.createdAtIso);
    let icon = '🛒';
    if (status === 'Delivered' || status === 'Verified Delivered') icon = '🎉';
    else if (status === 'Cancelled') icon = '✕';
    else if (status === 'Packed / Out for Delivery') icon = '🛵';
    else if (status === 'Confirmed by Merchant') icon = '✅';

    return `
      <div class="activity-feed-item">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span style="font-size:1.1rem;">${icon}</span>
          <div>
            <div style="font-weight:700;color:var(--slate-800);">Order #${escapeHtml(o.orderCode || o.orderId || o.id)} — ₹${o.totalAmount || o.grandTotal || 0}</div>
            <div style="font-size:0.7rem;color:var(--slate-500);">${escapeHtml(o.buyerName || 'Customer')} • ${escapeHtml(status)}</div>
          </div>
        </div>
        <div style="font-size:0.7rem;color:var(--slate-400);">${dateStr}</div>
      </div>
    `;
  }).join('');
}

// ─── Date Formatter Helper ────────────────────────────────────────────────────
function formatOrderDate(ts) {
  if (!ts) return 'Just now';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  if (isNaN(d.getTime())) return 'Recently';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
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
