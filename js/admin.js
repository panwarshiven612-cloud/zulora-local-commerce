/**
 * Zulora Local — Supreme Admin Master Panel v2 (Clean & Production-Ready)
 * Strictly restricted to zulora.help@gmail.com
 * Real Firestore data only — Zero fake/demo products or shops.
 */

import {
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, getDocs, updateDoc, isConfigPlaceholder
} from './firebase-init.js';
import { PLATFORM_CONSTANTS } from './config.js';
import { showToast } from './notifications.js';

// ─── State ─────────────────────────────────────────────────────────────────
let allShops = [];
let allProducts = [];
let allOrders = [];
let currentAdmin = null;

// ─── DOM Elements ───────────────────────────────────────────────────────────
const adminAuthGate    = document.getElementById('adminAuthGate');
const adminDashboard   = document.getElementById('adminDashboard');
const btnAdminLogin    = document.getElementById('btnAdminGoogleLogin');
const btnAdminLogout   = document.getElementById('btnAdminLogout');
const adminEmailDisp   = document.getElementById('adminEmailDisplay');
const adminSearchInput = document.getElementById('adminSearchInput');
const kpiTotalShops    = document.getElementById('kpiTotalShops');
const kpiTotalProducts = document.getElementById('kpiTotalProducts');
const kpiTotalOrders   = document.getElementById('kpiTotalOrders');
const kpiTotalGmv      = document.getElementById('kpiTotalGmv');
const kpiTotalCommission = document.getElementById('kpiTotalCommission');
const shopsTableBody   = document.getElementById('shopsTableBody');
const ordersTableBody  = document.getElementById('ordersTableBody');
const topProductsCont  = document.getElementById('topProductsContainer');
const verifiedTableBody= document.getElementById('verifiedTableBody');

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
      loadLiveAdminData();
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
    if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Sign-in error: ' + e.message, 'error');
    }
  }
}

function handleAdminLogout() {
  if (auth && !isConfigPlaceholder) {
    signOut(auth).then(() => window.location.href = './index.html');
  } else {
    window.location.href = './index.html';
  }
}

// ─── Real Live Data Load ──────────────────────────────────────────────────────
async function loadLiveAdminData() {
  showToast('Loading platform data…', 'info');
  if (!db || isConfigPlaceholder) {
    calculateAndRenderMetrics();
    return;
  }

  try {
    const [shopsSnap, prodsSnap, ordersSnap] = await Promise.all([
      getDocs(collection(db, 'shops')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'orders'))
    ]);

    allShops = [];
    shopsSnap.forEach(d => allShops.push({ id: d.id, ...d.data() }));

    allProducts = [];
    prodsSnap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));

    allOrders = [];
    ordersSnap.forEach(d => allOrders.push({ id: d.id, ...d.data() }));

    calculateAndRenderMetrics();
  } catch(err) {
    console.error('[Admin] Live data error:', err);
    showToast('Firestore load error: ' + err.message, 'error');
    allShops = [];
    allProducts = [];
    allOrders = [];
    calculateAndRenderMetrics();
  }
}

// ─── Metrics & Rendering ─────────────────────────────────────────────────────
function calculateAndRenderMetrics() {
  const gmv = allOrders.reduce((s, o) => s + (o.totalAmount || o.grandTotal || 0), 0);
  const commission = Math.round(gmv * PLATFORM_CONSTANTS.PLATFORM_COMMISSION_RATE);

  if (kpiTotalShops)      kpiTotalShops.textContent      = allShops.length;
  if (kpiTotalProducts)   kpiTotalProducts.textContent   = allProducts.length;
  if (kpiTotalOrders)     kpiTotalOrders.textContent     = allOrders.length;
  if (kpiTotalGmv)        kpiTotalGmv.textContent        = `₹${gmv.toLocaleString('en-IN')}`;
  if (kpiTotalCommission) kpiTotalCommission.textContent = `₹${commission.toLocaleString('en-IN')} (3%)`;

  renderVerifiedTable(allShops);
  renderShopsTable(allShops);
  renderOrdersTable(allOrders);
  renderTopProducts(allProducts);
}

// ─── Verified Badge Management ────────────────────────────────────────────────
function renderVerifiedTable(shops) {
  if (!verifiedTableBody) return;
  if (!shops.length) {
    verifiedTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--slate-500);">No registered shops found in Firestore yet.</td></tr>`;
    return;
  }
  verifiedTableBody.innerHTML = shops.map(shop => `
    <tr>
      <td>
        <div style="font-weight:800;color:var(--slate-900);">${escapeHtml(shop.name)}</div>
        <div style="font-size:0.75rem;color:var(--azure-700);">${escapeHtml(shop.handle || '')}</div>
      </td>
      <td style="font-size:0.82rem;">${escapeHtml(shop.phone || '—')} <br/><span style="color:var(--slate-500);">${escapeHtml(shop.ownerEmail || shop.email || '')}</span></td>
      <td>
        ${shop.isVerified
          ? `<span style="display:inline-flex;align-items:center;gap:0.35rem;">
               <img src="${PLATFORM_CONSTANTS.VERIFIED_BADGE_URL}" alt="Verified" class="verified-badge-sm" />
               <span style="font-size:0.8rem;font-weight:700;color:var(--azure-600);">Verified</span>
             </span>`
          : `<span style="font-size:0.8rem;font-weight:600;color:var(--slate-400);">Not Verified</span>`
        }
      </td>
      <td>
        <button class="btn btn-sm ${shop.isVerified ? 'btn-danger' : 'btn-primary'}"
          onclick="window.toggleVerifiedStatus('${shop.id}', ${Boolean(shop.isVerified)})">
          ${shop.isVerified ? '✕ Revoke Verified' : '✓ Grant Verified'}
        </button>
      </td>
    </tr>
  `).join('');
}

window.toggleVerifiedStatus = async function(shopId, currentState) {
  const newState = !currentState;
  const shop = allShops.find(s => s.id === shopId);
  if (!shop) return;

  if (db && !isConfigPlaceholder) {
    try {
      await updateDoc(doc(db, 'shops', shopId), { isVerified: newState });
      showToast(`${shop.name} is now ${newState ? '✓ Verified' : 'Unverified'}.`, newState ? 'success' : 'info');
      await loadLiveAdminData();
    } catch(e) {
      showToast('Could not update verified status: ' + e.message, 'error');
    }
  }
};

// ─── Shops Commission Table ───────────────────────────────────────────────────
function renderShopsTable(shops) {
  if (!shopsTableBody) return;
  if (!shops.length) {
    shopsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--slate-500);">No registered shops found in Firestore yet.</td></tr>`;
    return;
  }
  shopsTableBody.innerHTML = shops.map(shop => {
    const shopOrders = allOrders.filter(o => o.shopId === shop.id);
    const shopGmv = shopOrders.reduce((s, o) => s + (o.totalAmount || o.grandTotal || 0), 0);
    const commOwed = Math.round(shopGmv * PLATFORM_CONSTANTS.PLATFORM_COMMISSION_RATE);
    const cleanPhone = (shop.phone || '').replace(/[^0-9]/g, '');
    const callUrl = cleanPhone ? `tel:+91${cleanPhone}` : `tel:${PLATFORM_CONSTANTS.HELPLINE_PHONE}`;
    const waUrl = cleanPhone ? `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(`Hi ${shop.name}, Zulora Admin inquiry regarding your shop performance and commission settlement.`)}` : '#';

    return `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--slate-900);">${escapeHtml(shop.name)}</div>
          <div style="font-size:0.75rem;color:var(--azure-600);">${escapeHtml(shop.handle || '')}</div>
        </td>
        <td style="font-size:0.8rem;">
          ${escapeHtml(shop.phone || '—')}<br/>
          <span style="color:var(--slate-400);">${escapeHtml(shop.ownerEmail || shop.email || '')}</span>
        </td>
        <td>
          <span class="badge ${shop.isOpen !== false ? 'badge-open' : 'badge-closed'}" style="font-size:0.72rem;">
            ${shop.isOpen !== false ? '🟢 Open' : '🔴 Closed'}
          </span>
        </td>
        <td><strong>₹${shopGmv.toLocaleString('en-IN')}</strong> (${shopOrders.length} orders)</td>
        <td><strong style="color:var(--rose-600);">₹${commOwed.toLocaleString('en-IN')}</strong> (3%)</td>
        <td>
          <div style="display:flex;gap:0.35rem;">
            <a href="${callUrl}" class="btn btn-sm btn-secondary" style="font-size:0.72rem;padding:0.25rem 0.5rem;">📞 Call</a>
            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-whatsapp" style="font-size:0.72rem;padding:0.25rem 0.5rem;">💬 WA</a>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── Orders Table ─────────────────────────────────────────────────────────────
function renderOrdersTable(orders) {
  if (!ordersTableBody) return;
  if (!orders.length) {
    ordersTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--slate-500);">No orders placed yet.</td></tr>`;
    return;
  }
  ordersTableBody.innerHTML = orders.slice(0, 25).map(o => `
    <tr>
      <td style="font-weight:800;font-size:0.82rem;">${escapeHtml(o.orderId || o.id)}</td>
      <td style="font-size:0.82rem;">${escapeHtml(o.shopName || '—')}</td>
      <td style="font-size:0.82rem;">${escapeHtml(o.buyerName || '—')}<br/><span style="color:var(--slate-400);">${escapeHtml(o.buyerPhone || '')}</span></td>
      <td style="font-weight:700;">₹${o.totalAmount || o.grandTotal || 0} <span style="font-size:0.72rem;color:var(--slate-500);">(${escapeHtml(o.paymentMode || o.paymentMethod || 'COD')})</span></td>
      <td><span class="badge" style="background:var(--azure-100);color:var(--azure-800);font-size:0.72rem;">${escapeHtml(o.orderStatus || 'Placed')}</span></td>
      <td style="font-size:0.75rem;color:var(--slate-400);">${formatDate(o.createdAt)}</td>
    </tr>
  `).join('');
}

// ─── Top Products ─────────────────────────────────────────────────────────────
function renderTopProducts(products) {
  if (!topProductsCont) return;
  if (!products.length) {
    topProductsCont.innerHTML = `<p style="color:var(--slate-500);font-size:0.85rem;padding:0.5rem;">No products uploaded yet.</p>`;
    return;
  }
  const sorted = [...products].sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0)).slice(0, 5);
  topProductsCont.innerHTML = sorted.map((p, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px dashed var(--slate-200);font-size:0.82rem;">
      <span><strong>#${i + 1}</strong> ${escapeHtml(p.title)}</span>
      <span style="font-weight:700;color:var(--azure-700);">${p.salesCount || 0} sold (₹${p.price})</span>
    </div>
  `).join('');
}

// ─── Search / Filter ──────────────────────────────────────────────────────────
function filterAdminView(query) {
  if (!query) {
    calculateAndRenderMetrics();
    return;
  }
  const fShops = allShops.filter(s => (s.name + ' ' + (s.handle || '') + ' ' + (s.phone || '')).toLowerCase().includes(query));
  const fOrders = allOrders.filter(o => ((o.orderId || '') + ' ' + (o.shopName || '') + ' ' + (o.buyerName || '')).toLowerCase().includes(query));
  renderVerifiedTable(fShops);
  renderShopsTable(fShops);
  renderOrdersTable(fOrders);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
