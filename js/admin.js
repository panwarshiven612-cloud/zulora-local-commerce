/**
 * Zulora Local — Supreme Admin Master Panel v2
 * Strictly restricted to zulora.help@gmail.com
 * Features: verified badge toggle, cross-town GMV, commission ledger, all shops/products/orders
 */

import {
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, getDocs, updateDoc, isConfigPlaceholder
} from './firebase-init.js';
import { PLATFORM_CONSTANTS } from './config.js';

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

// ─── Toast ──────────────────────────────────────────────────────────────────
window.showToast = function(msg, type = 'info') {
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
  const icons = { success:'✓', error:'✕', info:'ℹ', warning:'⚠' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ'}</span><span class="toast-msg">${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 400); }, 3800);
};

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
    const isDemoAdmin = localStorage.getItem('zulora_demo_admin') === 'true';
    if (isDemoAdmin) { grantAdminAccess(PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL); loadMockAdminData(); }
    else showGate();
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
    const entered = prompt(`Firebase Demo Mode\nEnter admin email to unlock (must be ${PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL}):`,'');
    if (entered === PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL) {
      localStorage.setItem('zulora_demo_admin','true');
      grantAdminAccess(PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL);
      loadMockAdminData();
      window.showToast('Supreme Admin access granted (Demo)!', 'success');
    } else {
      window.showToast('Unauthorized email.', 'error');
    }
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch(e) {
    window.showToast('Sign-in error: ' + e.message, 'error');
  }
}

function handleAdminLogout() {
  localStorage.removeItem('zulora_demo_admin');
  if (auth && !isConfigPlaceholder) {
    signOut(auth).then(() => window.location.href = './index.html');
  } else {
    window.location.href = './index.html';
  }
}

// ─── Live Data Load ───────────────────────────────────────────────────────────
async function loadLiveAdminData() {
  window.showToast('Loading platform data…', 'info');
  try {
    const [shopsSnap, prodsSnap, ordersSnap] = await Promise.all([
      getDocs(collection(db,'shops')),
      getDocs(collection(db,'products')),
      getDocs(collection(db,'orders'))
    ]);
    allShops   = []; shopsSnap.forEach(d => allShops.push({ id: d.id, ...d.data() }));
    allProducts= []; prodsSnap.forEach(d => allProducts.push({ id: d.id, ...d.data() }));
    allOrders  = []; ordersSnap.forEach(d => allOrders.push({ id: d.id, ...d.data() }));
    calculateAndRenderMetrics();
  } catch(err) {
    console.error('[Admin] Live data error:', err);
    window.showToast('Firestore load error — using demo data.', 'warning');
    loadMockAdminData();
  }
}

// ─── Mock Data ───────────────────────────────────────────────────────────────
function loadMockAdminData() {
  allShops = [
    { id:'shop_1', name:'Fresh Farm Organics', handle:'@freshfarm', category:'Food', phone:'9876543210', email:'freshfarm@example.com', upiId:'freshfarm@okhdfcbank', lat:12.9340, lng:77.6220, isOpen:true,  isVerified:true },
    { id:'shop_2', name:'Royal Bakery & Treats', handle:'@royalbakery', category:'Food', phone:'9876543211', email:'royalbakery@example.com', upiId:'royalbakes@okaxis', lat:12.9420, lng:77.6290, isOpen:true,  isVerified:false },
    { id:'shop_3', name:'Green Leaf Dairy', handle:'@greenleaf', category:'Food', phone:'9876543212', email:'greenleaf@example.com', upiId:'greenleaf@paytm', lat:12.9280, lng:77.6180, isOpen:true,  isVerified:false }
  ];
  allProducts = [
    { id:'p1', shopId:'shop_1', title:'Hydroponic Tomatoes', price:45, salesCount:38, stock:8, inStock:true },
    { id:'p2', shopId:'shop_1', title:'Tri-Color Bell Peppers', price:85, salesCount:24, stock:4, inStock:true },
    { id:'p3', shopId:'shop_2', title:'Sourdough Garlic Bread', price:120, salesCount:19, stock:6, inStock:true },
    { id:'p4', shopId:'shop_2', title:'Chocolate Croissant', price:90, salesCount:42, stock:3, inStock:true },
    { id:'p5', shopId:'shop_3', title:'A2 Organic Cow Milk', price:75, salesCount:56, stock:12, inStock:true },
    { id:'p6', shopId:'shop_3', title:'Mango Pulp Shake', price:60, salesCount:31, stock:7, inStock:true }
  ];
  allOrders = [
    { id:'o1', orderId:'ZUL-938210', shopId:'shop_1', shopName:'Fresh Farm Organics', sellerPhone:'9876543210', buyerName:'Rohan Mehra', buyerPhone:'9999999991', grandTotal:340, paymentMode:'UPI', orderStatus:'Delivered', createdAt: { seconds: Math.floor(Date.now()/1000) - 7200 } },
    { id:'o2', orderId:'ZUL-849201', shopId:'shop_2', shopName:'Royal Bakery & Treats', sellerPhone:'9876543211', buyerName:'Priya Sharma', buyerPhone:'9999999992', grandTotal:210, paymentMode:'UPI', orderStatus:'Accepted & Packing', createdAt: { seconds: Math.floor(Date.now()/1000) - 14400 } },
    { id:'o3', orderId:'ZUL-748192', shopId:'shop_3', shopName:'Green Leaf Dairy', sellerPhone:'9876543212', buyerName:'Karthik Raja', buyerPhone:'9999999993', grandTotal:150, paymentMode:'COD', orderStatus:'Delivered', createdAt: { seconds: Math.floor(Date.now()/1000) - 28800 } }
  ];
  calculateAndRenderMetrics();
}

// ─── Metrics & Rendering ─────────────────────────────────────────────────────
function calculateAndRenderMetrics() {
  const gmv = allOrders.reduce((s,o) => s + (o.grandTotal||0), 0);
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
    verifiedTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--slate-500);">No shops registered yet.</td></tr>`;
    return;
  }
  verifiedTableBody.innerHTML = shops.map(shop => `
    <tr>
      <td>
        <div style="font-weight:800;color:var(--slate-900);">${escapeHtml(shop.name)}</div>
        <div style="font-size:.75rem;color:var(--azure-700);">${escapeHtml(shop.handle||'')}</div>
      </td>
      <td style="font-size:.82rem;">${escapeHtml(shop.phone||'')} <br/><span style="color:var(--slate-500);">${escapeHtml(shop.email||'')}</span></td>
      <td>
        ${shop.isVerified
          ? `<span style="display:flex;align-items:center;gap:.35rem;">
               <img src="${PLATFORM_CONSTANTS.VERIFIED_BADGE_URL}" alt="Verified" style="width:20px;height:20px;" />
               <span style="font-size:.8rem;font-weight:700;color:var(--azure-600);">Verified</span>
             </span>`
          : `<span style="font-size:.8rem;font-weight:600;color:var(--slate-400);">Not Verified</span>`
        }
      </td>
      <td>
        <button class="btn btn-sm ${shop.isVerified ? 'btn-danger' : 'btn-primary'}"
          onclick="window.toggleVerifiedStatus('${shop.id}', ${!!shop.isVerified})">
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
      window.showToast(`${shop.name} is now ${newState ? '✓ Verified' : 'Unverified'}.`, newState ? 'success' : 'info');
      // Refresh data
      await loadLiveAdminData();
    } catch(e) {
      window.showToast('Could not update verified status: ' + e.message, 'error');
    }
  } else {
    // Demo mode — update in-memory
    shop.isVerified = newState;
    renderVerifiedTable(allShops);
    renderShopsTable(allShops);
    window.showToast(`Demo: ${shop.name} is now ${newState ? '✓ Verified' : 'Unverified'}.`, newState ? 'success' : 'info');
  }
};

// ─── Shops Commission Table ───────────────────────────────────────────────────
function renderShopsTable(shops) {
  if (!shopsTableBody) return;
  if (!shops.length) {
    shopsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--slate-500);">No shops found.</td></tr>`;
    return;
  }
  shopsTableBody.innerHTML = shops.map(shop => {
    const shopOrders  = allOrders.filter(o => o.shopId === shop.id || o.sellerUid === shop.id);
    const shopGmv     = shopOrders.reduce((s,o) => s + (o.grandTotal||0), 0);
    const commission  = Math.round(shopGmv * PLATFORM_CONSTANTS.PLATFORM_COMMISSION_RATE);
    const cleanPhone  = (shop.phone||'').replace(/[^0-9]/g,'');
    const callUrl     = `tel:+91${cleanPhone}`;
    const waMsg       = encodeURIComponent(`Hello ${shop.name}, this is Zulora Admin (zulora.help@gmail.com). Your store generated ₹${shopGmv} GMV. Platform commission owed: ₹${commission}. Please arrange settlement at your earliest. Thank you!`);
    const waUrl       = `https://wa.me/91${cleanPhone}?text=${waMsg}`;

    return `
      <tr>
        <td>
          <div style="font-weight:800;">${escapeHtml(shop.name)}</div>
          <div style="font-size:.75rem;color:var(--azure-700);">${escapeHtml(shop.handle||'')}</div>
        </td>
        <td>
          <div style="font-size:.8rem;">${escapeHtml(shop.phone||'')}</div>
          <div style="font-size:.72rem;color:var(--slate-500);">${escapeHtml(shop.email||'')}</div>
        </td>
        <td>
          <span class="status-badge ${shop.isOpen!==false ? 'badge-open' : 'badge-closed'}">
            ● ${shop.isOpen!==false ? 'Open' : 'Closed'}
          </span>
        </td>
        <td>
          ${shop.isVerified
            ? `<img src="${PLATFORM_CONSTANTS.VERIFIED_BADGE_URL}" alt="Verified" style="width:22px;height:22px;" title="Verified Seller"/>`
            : `<span style="font-size:.75rem;color:var(--slate-400);">—</span>`}
        </td>
        <td style="font-weight:700;">₹${shopGmv.toLocaleString('en-IN')}</td>
        <td style="font-weight:800;color:var(--rose-600);">₹${commission.toLocaleString('en-IN')}</td>
        <td>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap;">
            <a href="${callUrl}" class="btn btn-secondary btn-sm" title="Call to collect commission">
              📞 Call
            </a>
            <a href="${waUrl}" target="_blank" class="btn btn-whatsapp btn-sm">
              💬 WhatsApp
            </a>
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
    ordersTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--slate-500);">No orders found.</td></tr>`;
    return;
  }
  ordersTableBody.innerHTML = orders.map(o => `
    <tr>
      <td style="font-weight:800;font-family:monospace;color:var(--azure-800);">#${escapeHtml(o.orderId||o.id)}</td>
      <td>${escapeHtml(o.shopName||'—')}</td>
      <td>
        <div style="font-weight:600;">${escapeHtml(o.buyerName||'—')}</div>
        <div style="font-size:.72rem;color:var(--slate-500);">${escapeHtml(o.buyerPhone||'')}</div>
      </td>
      <td style="font-weight:800;">₹${o.grandTotal||0} <span style="font-size:.72rem;color:var(--slate-500);">(${o.paymentMode||'—'})</span></td>
      <td>
        <span class="status-badge badge-open" style="font-size:.72rem;">${escapeHtml(o.orderStatus||'Placed')}</span>
      </td>
      <td style="font-size:.75rem;color:var(--slate-500);">${formatDate(o.createdAt)}</td>
    </tr>
  `).join('');
}

// ─── Top Products ─────────────────────────────────────────────────────────────
function renderTopProducts(products) {
  if (!topProductsCont) return;
  const sorted = [...products].sort((a,b)=>(b.salesCount||0)-(a.salesCount||0)).slice(0,5);
  if (!sorted.length) { topProductsCont.innerHTML = '<p style="color:var(--slate-500);font-size:.85rem;">No products yet.</p>'; return; }
  topProductsCont.innerHTML = sorted.map((p,i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid var(--slate-100);">
      <div style="display:flex;align-items:center;gap:.6rem;">
        <span style="font-size:.9rem;font-weight:800;color:var(--azure-600);width:20px;">#${i+1}</span>
        <div>
          <div style="font-size:.85rem;font-weight:700;color:var(--slate-900);">${escapeHtml(p.title)}</div>
          <div style="font-size:.72rem;color:var(--slate-500);">₹${p.price}</div>
        </div>
      </div>
      <span style="font-size:.8rem;font-weight:800;color:var(--emerald-600);">${p.salesCount||0} sold</span>
    </div>
  `).join('');
}

// ─── Search Filter ────────────────────────────────────────────────────────────
function filterAdminView(q) {
  if (!q) { calculateAndRenderMetrics(); return; }
  const fs = allShops.filter(s =>
    (s.name||'').toLowerCase().includes(q) ||
    (s.handle||'').toLowerCase().includes(q) ||
    (s.phone||'').includes(q)
  );
  const fo = allOrders.filter(o =>
    (o.orderId||'').toLowerCase().includes(q) ||
    (o.shopName||'').toLowerCase().includes(q) ||
    (o.buyerName||'').toLowerCase().includes(q)
  );
  renderVerifiedTable(fs);
  renderShopsTable(fs);
  renderOrdersTable(fo);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(ts) {
  if (!ts) return '—';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  return d.toLocaleDateString('en-IN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
