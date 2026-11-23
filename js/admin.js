/**
 * Zulora Local — Supreme Admin Master Panel v3 (Production-Grade)
 * Strictly restricted to zulora.help@gmail.com
 * Real-time Firestore onSnapshot for Shops, Products, Orders, Users.
 * Working Delete Product, Delete Shop, Delete Order, and Shop-Level Blue Tick.
 */

import {
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, getDocs, updateDoc, deleteDoc, onSnapshot, isConfigPlaceholder
} from './firebase-init.js';
import { PLATFORM_CONSTANTS } from './config.js';
import { showToast } from './notifications.js';
import { showUnauthorizedDomainDialog } from './auth.js';

// ─── State ─────────────────────────────────────────────────────────────────
let allShops = [];
let allProducts = [];
let allOrders = [];
let allUsers = [];
let currentAdmin = null;

let unsubShops = null;
let unsubProducts = null;
let unsubOrders = null;
let unsubUsers = null;

// ─── DOM Elements ───────────────────────────────────────────────────────────
const adminAuthGate      = document.getElementById('adminAuthGate');
const adminDashboard     = document.getElementById('adminDashboard');
const btnAdminLogin      = document.getElementById('btnAdminGoogleLogin');
const btnAdminLogout     = document.getElementById('btnAdminLogout');
const adminEmailDisp     = document.getElementById('adminEmailDisplay');
const adminSearchInput   = document.getElementById('adminSearchInput');
const kpiTotalShops      = document.getElementById('kpiTotalShops');
const kpiTotalProducts   = document.getElementById('kpiTotalProducts');
const kpiTotalOrders     = document.getElementById('kpiTotalOrders');
const kpiTotalUsers      = document.getElementById('kpiTotalUsers');
const kpiTotalGmv        = document.getElementById('kpiTotalGmv');
const kpiTotalCommission = document.getElementById('kpiTotalCommission');

const verifiedTableBody  = document.getElementById('verifiedTableBody');
const productsTableBody  = document.getElementById('productsTableBody');
const shopsTableBody     = document.getElementById('shopsTableBody');
const ordersTableBody    = document.getElementById('ordersTableBody');
const usersTableBody     = document.getElementById('usersTableBody');

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initAdminAuth();
});

function setupEventListeners() {
  btnAdminLogin?.addEventListener('click', handleAdminLogin);
  btnAdminLogout?.addEventListener('click', handleAdminLogout);
  adminSearchInput?.addEventListener('input', e => filterAdminView(e.target.value.trim().toLowerCase()));
}

// ─── Auth ────────────────────────────────────────────────────────────────────
function initAdminAuth() {
  if (!auth || isConfigPlaceholder) {
    showGate();
    return;
  }

  onAuthStateChanged(auth, user => {
    if (user && user.email === PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL) {
      currentAdmin = user;
      grantAdminAccess(user.email);
      listenLiveAdminData();
    } else if (user) {
      alert(`⛔ Access Denied!\nYou are signed in as ${user.email}.\nOnly ${PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL} has Supreme Admin access.`);
      window.location.href = './index.html';
    } else {
      showGate();
    }
  });
}

function showGate() {
  adminAuthGate?.classList.remove('hidden');
  adminDashboard?.classList.add('hidden');
}

function grantAdminAccess(email) {
  adminAuthGate?.classList.add('hidden');
  adminDashboard?.classList.remove('hidden');
  if (adminEmailDisp) adminEmailDisp.textContent = email;
}

async function handleAdminLogin() {
  if (!auth || isConfigPlaceholder) {
    showToast('Firebase authentication is initializing or offline.', 'warning');
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch(e) {
    if (e.code === 'auth/unauthorized-domain') {
      showUnauthorizedDomainDialog();
    } else if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Sign-in error: ' + e.message, 'error');
    }
  }
}

function handleAdminLogout() {
  detachLiveListeners();
  if (auth && !isConfigPlaceholder) {
    signOut(auth).then(() => window.location.href = './index.html');
  } else {
    window.location.href = './index.html';
  }
}

function detachLiveListeners() {
  if (unsubShops) { unsubShops(); unsubShops = null; }
  if (unsubProducts) { unsubProducts(); unsubProducts = null; }
  if (unsubOrders) { unsubOrders(); unsubOrders = null; }
  if (unsubUsers) { unsubUsers(); unsubUsers = null; }
}

// ─── Real-Time Live Admin Data Streams ───────────────────────────────────────
function listenLiveAdminData() {
  if (!db || isConfigPlaceholder) return;
  detachLiveListeners();

  // 1. Live Shops
  unsubShops = onSnapshot(collection(db, 'shops'), snapshot => {
    allShops = [];
    snapshot.forEach(d => allShops.push({ id: d.id, ...d.data() }));
    updateAllViews();
  }, err => console.warn('[Admin] Shops stream:', err));

  // 2. Live Products
  unsubProducts = onSnapshot(collection(db, 'products'), snapshot => {
    allProducts = [];
    snapshot.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
    // Sort products by salesCount or createdAt
    allProducts.sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0));
    updateAllViews();
  }, err => console.warn('[Admin] Products stream:', err));

  // 3. Live Orders
  unsubOrders = onSnapshot(collection(db, 'orders'), snapshot => {
    allOrders = [];
    snapshot.forEach(d => allOrders.push({ id: d.id, docId: d.id, ...d.data() }));
    // Sort in memory by createdAt descending
    allOrders.sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a));
    updateAllViews();
  }, err => console.warn('[Admin] Orders stream:', err));

  // 4. Live Users
  unsubUsers = onSnapshot(collection(db, 'users'), snapshot => {
    allUsers = [];
    snapshot.forEach(d => allUsers.push({ id: d.id, ...d.data() }));
    updateAllViews();
  }, err => console.warn('[Admin] Users stream:', err));
}

function updateAllViews() {
  calculateAndRenderKPIs();
  const searchVal = adminSearchInput?.value.trim().toLowerCase() || '';
  if (searchVal) {
    filterAdminView(searchVal);
  } else {
    renderVerifiedTable(allShops);
    renderProductsTable(allProducts);
    renderShopsTable(allShops);
    renderOrdersTable(allOrders);
    renderUsersTable(allUsers);
  }
}

// ─── KPI Calculations ────────────────────────────────────────────────────────
function calculateAndRenderKPIs() {
  const gmv = allOrders.reduce((s, o) => s + (o.totalAmount || o.grandTotal || 0), 0);
  const commission = Math.round(gmv * PLATFORM_CONSTANTS.PLATFORM_COMMISSION_RATE);

  if (kpiTotalShops)      kpiTotalShops.textContent      = allShops.length;
  if (kpiTotalProducts)   kpiTotalProducts.textContent   = allProducts.length;
  if (kpiTotalOrders)     kpiTotalOrders.textContent     = allOrders.length;
  if (kpiTotalUsers)      kpiTotalUsers.textContent      = allUsers.length;
  if (kpiTotalGmv)        kpiTotalGmv.textContent        = `₹${gmv.toLocaleString('en-IN')}`;
  if (kpiTotalCommission) kpiTotalCommission.textContent = `₹${commission.toLocaleString('en-IN')} (3%)`;
}

// ─── 1. Verified Blue-Tick Management (Shop-Level Only) ──────────────────────
function renderVerifiedTable(shops) {
  if (!verifiedTableBody) return;
  if (!shops.length) {
    verifiedTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--slate-500);">No registered shops found in Firestore yet.</td></tr>`;
    return;
  }
  verifiedTableBody.innerHTML = shops.map(shop => {
    const isVer = Boolean(shop.isVerified);
    return `
      <tr>
        <td>
          <div style="font-weight:800;color:var(--slate-900);display:flex;align-items:center;gap:0.35rem;">
            ${escapeHtml(shop.name)}
            ${isVer ? `<img src="${PLATFORM_CONSTANTS.VERIFIED_BADGE_URL}" alt="Verified" class="verified-badge-sm" title="Verified Seller" />` : ''}
          </div>
          <div style="font-size:0.75rem;color:var(--azure-700);">${escapeHtml(shop.handle || '')}</div>
        </td>
        <td style="font-size:0.82rem;">
          ${escapeHtml(shop.phone || '—')}<br/>
          <span style="color:var(--slate-500);">${escapeHtml(shop.ownerEmail || shop.email || '')}</span>
        </td>
        <td>
          ${isVer
            ? `<span style="display:inline-flex;align-items:center;gap:0.3rem;">
                 <img src="${PLATFORM_CONSTANTS.VERIFIED_BADGE_URL}" alt="✓" class="verified-badge-sm" />
                 <span style="font-size:0.8rem;font-weight:700;color:var(--azure-600);">Verified Shop</span>
               </span>`
            : `<span style="font-size:0.8rem;font-weight:600;color:var(--slate-400);">Unverified</span>`
          }
        </td>
        <td>
          <button class="btn btn-sm ${isVer ? 'btn-danger' : 'btn-primary'}"
            onclick="window.toggleVerifiedStatus('${escapeHtml(shop.id)}', ${isVer})">
            ${isVer ? '✕ Revoke Verified' : '✓ Grant Blue Tick'}
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.toggleVerifiedStatus = async function(shopId, currentState) {
  const newState = !currentState;
  const shop = allShops.find(s => s.id === shopId);
  if (!shop || !db || isConfigPlaceholder) return;

  try {
    await updateDoc(doc(db, 'shops', shopId), { isVerified: newState });
    showToast(`${shop.name} is now ${newState ? '✓ Verified (Blue Tick Granted)' : 'Unverified'}.`, newState ? 'success' : 'info');
  } catch(e) {
    showToast('Could not update verified status: ' + e.message, 'error');
  }
};

// ─── 2. All Products Table & Delete Product Action ────────────────────────────
function renderProductsTable(products) {
  if (!productsTableBody) return;
  if (!products.length) {
    productsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--slate-500);">No products uploaded yet.</td></tr>`;
    return;
  }
  productsTableBody.innerHTML = products.map(p => {
    const shop = allShops.find(s => s.id === p.shopId);
    const cover = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : (p.imageUrl || 'https://via.placeholder.com/80x80?text=Product');

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:0.6rem;">
            <img src="${escapeHtml(cover)}" alt="" style="width:40px;height:40px;border-radius:6px;object-fit:cover;border:1px solid var(--slate-200);flex-shrink:0;" />
            <div>
              <div style="font-weight:800;color:var(--slate-900);font-size:0.85rem;">${escapeHtml(p.title)}</div>
              <div style="font-size:0.72rem;color:var(--slate-400);">ID: ${escapeHtml(p.id)}</div>
            </div>
          </div>
        </td>
        <td><span class="badge" style="background:var(--slate-100);font-size:0.75rem;">${escapeHtml(p.category || 'General')}</span></td>
        <td style="font-size:0.82rem;font-weight:600;color:var(--azure-800);">${escapeHtml(shop?.name || p.shopId || 'Local Store')}</td>
        <td style="font-size:0.85rem;">
          <strong>₹${p.price}</strong> 
          <span style="font-size:0.72rem;color:${(p.stock || 0) <= 0 ? 'var(--rose-600)' : 'var(--slate-500)'};">
            (${p.stock || 0} in stock)
          </span>
        </td>
        <td style="font-size:0.82rem;font-weight:700;color:var(--slate-700);">${p.salesCount || 0} sold</td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="window.adminDeleteProduct('${escapeHtml(p.id)}', '${escapeHtml(p.title)}')" style="font-size:0.75rem;padding:0.25rem 0.55rem;">
            🗑️ Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.adminDeleteProduct = async function(productId, title = 'this product') {
  if (!confirm(`Are you sure you want to PERMANENTLY DELETE "${title}" from the platform?\nIt will be removed immediately from storefront and search results.`)) return;
  if (!db || isConfigPlaceholder) return;

  try {
    await deleteDoc(doc(db, 'products', productId));
    showToast(`Deleted "${title}" successfully.`, 'success');
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
};

// ─── 3. Registered Shops, Commission Ledger & Controls ────────────────────────
function renderShopsTable(shops) {
  if (!shopsTableBody) return;
  if (!shops.length) {
    shopsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--slate-500);">No registered shops found in Firestore yet.</td></tr>`;
    return;
  }
  shopsTableBody.innerHTML = shops.map(shop => {
    const shopOrders = allOrders.filter(o => o.shopId === shop.id);
    const shopGmv = shopOrders.reduce((s, o) => s + (o.totalAmount || o.grandTotal || 0), 0);
    const commOwed = Math.round(shopGmv * PLATFORM_CONSTANTS.PLATFORM_COMMISSION_RATE);
    const cleanPhone = (shop.phone || '').replace(/[^0-9]/g, '');
    const callUrl = cleanPhone ? `tel:+91${cleanPhone}` : `tel:${PLATFORM_CONSTANTS.HELPLINE_PHONE}`;
    const waUrl = cleanPhone ? `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(`Hi ${shop.name}, Zulora Admin inquiry regarding your store performance and commission settlement.`)}` : '#';
    const isOpen = shop.isOpen !== false;

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--slate-900);display:flex;align-items:center;gap:0.3rem;">
            ${escapeHtml(shop.name)}
            ${shop.isVerified ? `<img src="${PLATFORM_CONSTANTS.VERIFIED_BADGE_URL}" alt="✓" class="verified-badge-sm" />` : ''}
          </div>
          <div style="font-size:0.75rem;color:var(--azure-600);">${escapeHtml(shop.handle || '')}</div>
          <div style="font-size:0.72rem;color:var(--slate-400);">📍 ${escapeHtml(shop.city || shop.town || 'Local')}</div>
        </td>
        <td style="font-size:0.8rem;">
          <a href="${callUrl}" style="color:var(--slate-800);font-weight:700;">📞 ${escapeHtml(shop.phone || '—')}</a><br/>
          <span style="color:var(--slate-500);font-size:0.72rem;">${escapeHtml(shop.ownerEmail || shop.email || '')}</span>
        </td>
        <td>
          <button class="btn btn-sm ${isOpen ? 'btn-success' : 'btn-ghost'}" onclick="window.adminToggleShopStatus('${escapeHtml(shop.id)}', ${isOpen})" style="font-size:0.72rem;padding:0.2rem 0.5rem;">
            ${isOpen ? '🟢 Open' : '🔴 Closed'}
          </button>
        </td>
        <td>
          <span style="font-size:0.75rem;font-weight:700;color:${shop.isVerified ? 'var(--azure-600)' : 'var(--slate-400)'};">
            ${shop.isVerified ? '✓ Verified' : '—'}
          </span>
        </td>
        <td><strong>₹${shopGmv.toLocaleString('en-IN')}</strong> (${shopOrders.length} orders)</td>
        <td><strong style="color:var(--rose-600);">₹${commOwed.toLocaleString('en-IN')}</strong></td>
        <td>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
            <a href="${callUrl}" class="btn btn-sm btn-secondary" style="font-size:0.72rem;padding:0.25rem 0.45rem;">📞 Call</a>
            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-whatsapp" style="font-size:0.72rem;padding:0.25rem 0.45rem;">💬 WA</a>
            <button class="btn btn-sm btn-danger" onclick="window.adminDeleteShop('${escapeHtml(shop.id)}', '${escapeHtml(shop.name)}')" style="font-size:0.72rem;padding:0.25rem 0.45rem;">🗑️ Del</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.adminToggleShopStatus = async function(shopId, currentIsOpen) {
  if (!db || isConfigPlaceholder) return;
  const newStatus = !currentIsOpen;
  try {
    await updateDoc(doc(db, 'shops', shopId), { isOpen: newStatus });
    showToast(`Shop marked as ${newStatus ? 'OPEN' : 'CLOSED'}.`, 'info');
  } catch(e) {
    showToast('Failed to update shop status: ' + e.message, 'error');
  }
};

window.adminDeleteShop = async function(shopId, shopName = 'this shop') {
  if (!confirm(`Are you sure you want to PERMANENTLY DELETE shop "${shopName}"?\nThis cannot be undone.`)) return;
  if (!db || isConfigPlaceholder) return;
  try {
    await deleteDoc(doc(db, 'shops', shopId));
    showToast(`Shop "${shopName}" deleted.`, 'info');
  } catch(e) {
    showToast('Failed to delete shop: ' + e.message, 'error');
  }
};

// ─── 4. Orders Table & Delete Order Action ────────────────────────────────────
function renderOrdersTable(orders) {
  if (!ordersTableBody) return;
  if (!orders.length) {
    ordersTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--slate-500);">No orders placed yet.</td></tr>`;
    return;
  }
  ordersTableBody.innerHTML = orders.map(o => {
    const rawStatus = o.orderStatus || o.status || 'Placed';
    const status = normalizeStatus(rawStatus);
    const cleanBuyerPhone = (o.buyerPhone || '').replace(/[^0-9]/g, '');
    const cleanShopPhone = (o.shopPhone || o.sellerPhone || '').replace(/[^0-9]/g, '');
    const buyerCall = cleanBuyerPhone ? `tel:+91${cleanBuyerPhone}` : '#';
    const shopCall = cleanShopPhone ? `tel:+91${cleanShopPhone}` : '#';

    return `
      <tr>
        <td style="font-weight:800;font-size:0.82rem;color:var(--azure-900);">
          #${escapeHtml(o.orderCode || o.orderId || o.id)}
        </td>
        <td style="font-size:0.8rem;">
          <strong>${escapeHtml(o.shopName || '—')}</strong><br/>
          ${cleanShopPhone ? `<a href="${shopCall}" style="color:var(--azure-700);font-weight:700;">📞 +91 ${cleanShopPhone}</a>` : ''}
        </td>
        <td style="font-size:0.8rem;">
          <strong>${escapeHtml(o.buyerName || '—')}</strong> (<a href="${buyerCall}" style="color:var(--azure-700);font-weight:700;">+91 ${cleanBuyerPhone}</a>)<br/>
          <span style="color:var(--slate-500);font-size:0.73rem;">📍 ${escapeHtml(o.buyerAddress || '—')}</span>
        </td>
        <td style="font-size:0.82rem;">
          <strong style="color:var(--slate-900);">₹${o.totalAmount || o.grandTotal || 0}</strong>
          <span style="font-size:0.72rem;color:var(--slate-500);">(${escapeHtml(o.paymentMethod || o.paymentMode || 'COD')})</span><br/>
          <span style="font-size:0.72rem;color:var(--slate-400);">${(o.items || []).length} items</span>
        </td>
        <td>
          <span class="badge" style="background:${getStatusBadgeColor(status)};color:#fff;font-size:0.72rem;">
            ${escapeHtml(status)}
          </span>
        </td>
        <td style="font-size:0.75rem;color:var(--slate-400);white-space:nowrap;">
          ${formatDate(o.createdAt || o.createdAtIso)}
        </td>
        <td>
          <button class="btn btn-sm btn-ghost" onclick="window.adminDeleteOrder('${escapeHtml(o.id || o.docId)}')" style="color:var(--rose-600);border-color:var(--rose-200);font-size:0.72rem;padding:0.25rem 0.45rem;">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.adminDeleteOrder = async function(orderId) {
  if (!confirm('Are you sure you want to delete this order record from Firestore?')) return;
  if (!db || isConfigPlaceholder) return;
  try {
    await deleteDoc(doc(db, 'orders', orderId));
    showToast('Order record deleted.', 'info');
  } catch (e) {
    showToast('Failed to delete order: ' + e.message, 'error');
  }
};

// ─── 5. Registered Users Table ────────────────────────────────────────────────
function renderUsersTable(users) {
  if (!usersTableBody) return;
  if (!users.length) {
    usersTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--slate-500);">No registered user profiles found yet.</td></tr>`;
    return;
  }
  usersTableBody.innerHTML = users.map(u => `
    <tr>
      <td style="font-weight:700;color:var(--slate-900);font-size:0.82rem;">
        ${escapeHtml(u.displayName || 'Shopper')}
      </td>
      <td style="font-size:0.82rem;color:var(--azure-800);">${escapeHtml(u.email || '—')}</td>
      <td style="font-size:0.73rem;color:var(--slate-400);font-family:monospace;">${escapeHtml(u.uid || u.id || '—')}</td>
      <td style="font-size:0.78rem;color:var(--slate-600);">
        ${escapeHtml(u.location?.town || u.location?.address || '—')}
      </td>
    </tr>
  `).join('');
}

// ─── Search / Filter ──────────────────────────────────────────────────────────
function filterAdminView(query) {
  if (!query) {
    updateAllViews();
    return;
  }
  const fShops = allShops.filter(s => (s.name + ' ' + (s.handle || '') + ' ' + (s.phone || '') + ' ' + (s.city || '')).toLowerCase().includes(query));
  const fProds = allProducts.filter(p => (p.title + ' ' + (p.category || '')).toLowerCase().includes(query));
  const fOrders = allOrders.filter(o => ((o.orderCode || o.orderId || '') + ' ' + (o.shopName || '') + ' ' + (o.buyerName || '') + ' ' + (o.buyerPhone || '')).toLowerCase().includes(query));
  const fUsers = allUsers.filter(u => ((u.displayName || '') + ' ' + (u.email || '')).toLowerCase().includes(query));

  renderVerifiedTable(fShops);
  renderShopsTable(fShops);
  renderProductsTable(fProds);
  renderOrdersTable(fOrders);
  renderUsersTable(fUsers);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function getOrderTimestamp(order) {
  if (!order) return 0;
  if (order.createdAt?.toMillis) return order.createdAt.toMillis();
  if (order.createdAt?.seconds) return order.createdAt.seconds * 1000;
  if (order.createdAtIso) return new Date(order.createdAtIso).getTime();
  if (typeof order.createdAt === 'number') return order.createdAt;
  if (typeof order.createdAt === 'string') return new Date(order.createdAt).getTime();
  return 0;
}

function formatDate(ts) {
  if (!ts) return '—';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
