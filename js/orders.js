/**
 * Zulora Local — Buyer Orders & Live Tracker v2
 * Real-time Firestore onSnapshot, 4-step Blinkit stepper, notifications, Buy Again
 */

import {
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, query, where, orderBy, onSnapshot, isConfigPlaceholder
} from './firebase-init.js';
import { PLATFORM_CONSTANTS } from './config.js';
import { addNotification, loadSavedNotifications, notifyOrderStatus } from './notifications.js';

// ─── State ───────────────────────────────────────────────────────────────────
let currentUser  = null;
let userOrders   = [];
let unsubscribe  = null;
let prevStatuses = {}; // track status changes for notifications

// ─── DOM ─────────────────────────────────────────────────────────────────────
const ordersListContainer = document.getElementById('ordersListContainer');
const authPrompt          = document.getElementById('authPrompt');
const btnLoginToViewOrders= document.getElementById('btnLoginToViewOrders');

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initAuth();
  loadSavedNotifications();
});

function setupEventListeners() {
  btnLoginToViewOrders?.addEventListener('click', handleBuyerLogin);
}

function initAuth() {
  if (!auth || isConfigPlaceholder) {
    const localOrders = JSON.parse(localStorage.getItem('zulora_local_orders') || '[]');
    if (localOrders.length > 0 || localStorage.getItem('zulora_buyer_phone')) {
      authPrompt?.classList.add('hidden');
      loadDemoOrLocalOrders(localOrders);
    } else {
      authPrompt?.classList.remove('hidden');
      loadDemoOrLocalOrders([]);
    }
    return;
  }
  onAuthStateChanged(auth, user => {
    if (user) {
      currentUser = user;
      authPrompt?.classList.add('hidden');
      listenToLiveOrders(user.uid);
    } else {
      currentUser = null;
      authPrompt?.classList.remove('hidden');
      if (ordersListContainer) ordersListContainer.innerHTML = '';
    }
  });
}

async function handleBuyerLogin() {
  if (!auth || isConfigPlaceholder) {
    const phone = prompt('Enter your phone number to view demo orders:', '9876543210');
    if (phone) {
      localStorage.setItem('zulora_buyer_phone', phone);
      authPrompt?.classList.add('hidden');
      loadDemoOrLocalOrders([]);
      window.showToast?.('Demo orders loaded for phone: ' + phone, 'success');
    }
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
    window.showToast?.('Signed in to view your orders!', 'success');
  } catch(e) {
    window.showToast?.('Login failed: ' + e.message, 'error');
  }
}

// ─── Live Orders Stream ───────────────────────────────────────────────────────
function listenToLiveOrders(buyerUid) {
  if (!db || isConfigPlaceholder) return;
  const q = query(
    collection(db,'orders'),
    where('buyerUid','==',buyerUid),
    orderBy('createdAt','desc')
  );
  unsubscribe = onSnapshot(q, snapshot => {
    userOrders = [];
    snapshot.forEach(d => {
      const order = { docId: d.id, ...d.data() };
      // Fire notification on status change
      const prev = prevStatuses[d.id];
      if (prev && prev !== order.orderStatus) {
        notifyOrderStatus(order.orderId || d.id, order.orderStatus);
      }
      prevStatuses[d.id] = order.orderStatus;
      userOrders.push(order);
    });
    renderOrders();
  }, err => {
    console.warn('[Orders] onSnapshot error:', err);
    loadDemoOrLocalOrders([]);
  });
}

// ─── Demo / Local Orders ──────────────────────────────────────────────────────
function loadDemoOrLocalOrders(localOrders) {
  if (localOrders && localOrders.length > 0) {
    userOrders = localOrders;
  } else {
    userOrders = [{
      orderId: 'ZUL-582914',
      shopId: 'shop_1',
      shopName: 'Fresh Farm Organics',
      sellerPhone: '9876543210',
      sellerEmail: 'freshfarm@example.com',
      buyerName: 'Demo Customer',
      buyerAddress: 'Flat 402, Sunshine Residency, Koramangala, Bengaluru',
      items: [
        { title:'Hydroponic Tomatoes', unit:'500g', price:45, quantity:2 },
        { title:'Tri-Color Bell Peppers', unit:'3 pcs', price:85, quantity:1 }
      ],
      itemsSubtotal: 175,
      deliveryFee: 15,
      grandTotal: 190,
      paymentMode: 'UPI',
      orderStatus: 'Accepted & Packing',
      createdAt: new Date().toISOString()
    }];
  }
  renderOrders();
}

// ─── Render Orders ────────────────────────────────────────────────────────────
function renderOrders() {
  if (!ordersListContainer) return;
  if (!userOrders.length) {
    ordersListContainer.innerHTML = `
      <div style="text-align:center;padding:4rem 1rem;background:rgba(255,255,255,.8);border-radius:var(--radius-lg);border:1px dashed var(--slate-300);">
        <div style="font-size:3rem;margin-bottom:.5rem;">🛍️</div>
        <h3 style="font-size:1.2rem;color:var(--slate-900);margin-bottom:.25rem;">No Orders Yet</h3>
        <p style="font-size:.85rem;color:var(--slate-500);margin-bottom:1.5rem;">Order fresh products from neighbourhood shops!</p>
        <a href="./index.html" class="btn btn-primary btn-lg">Explore Nearby Shops & Products</a>
      </div>`;
    return;
  }

  ordersListContainer.innerHTML = userOrders.map(order => {
    const status       = order.orderStatus || 'Placed';
    const stepIdx      = getStatusStepIndex(status);
    const progressPct  = getProgressPercentage(stepIdx);
    const cleanPhone   = (order.sellerPhone||'').replace(/[^0-9]/g,'');
    const callUrl      = `tel:+91${cleanPhone}`;
    const waMsg        = encodeURIComponent(`Hi ${order.shopName}, I have a query about my Zulora order #${order.orderId}`);
    const waUrl        = `https://wa.me/91${cleanPhone}?text=${waMsg}`;
    const mapsLink     = order.buyerLocation?.lat ? `https://maps.google.com/?q=${order.buyerLocation.lat},${order.buyerLocation.lng}` : null;

    return `
      <div class="glass-card" style="padding:1.5rem;margin-bottom:1.5rem;">

        <!-- Header row -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.5rem;border-bottom:1px solid var(--slate-200);padding-bottom:1rem;margin-bottom:1rem;">
          <div>
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
              <span style="font-size:1.15rem;font-weight:800;color:var(--slate-900);">Order #${escapeHtml(order.orderId||'—')}</span>
              <span class="status-badge badge-open" style="font-size:.72rem;">${escapeHtml(status)}</span>
            </div>
            <div style="font-size:.8rem;color:var(--slate-500);margin-top:.2rem;">
              Shop: <strong>${escapeHtml(order.shopName||'—')}</strong> • ${formatOrderDate(order.createdAt)}
            </div>
            ${mapsLink ? `<a href="${mapsLink}" target="_blank" style="font-size:.72rem;color:var(--azure-600);font-weight:700;">📍 Delivery Location Map</a>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.3rem;font-weight:800;color:var(--azure-800);">₹${order.grandTotal||0}</div>
            <div style="font-size:.72rem;color:var(--slate-500);">${escapeHtml(order.paymentMode||'—')}</div>
          </div>
        </div>

        <!-- 4-Step Blinkit-style Stepper -->
        <div style="margin:1.5rem 0 1rem;">
          <div style="font-size:.8rem;font-weight:700;color:var(--slate-700);margin-bottom:.5rem;display:flex;align-items:center;gap:.35rem;">
            ⚡ Live Delivery Status: <span style="color:var(--azure-600);font-weight:800;">${escapeHtml(status)}</span>
          </div>
          <div class="stepper-container">
            <div class="stepper-bar-fill" style="width:${progressPct}%;"></div>
            ${['Placed','Accepted & Packing','Out for Delivery','Delivered'].map((label, i) => {
              const nodeIdx = i + 1;
              const isCompleted = stepIdx > nodeIdx;
              const isActive = stepIdx === nodeIdx;
              return `
                <div class="step-node ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}">
                  <div class="step-circle">${isCompleted ? '✓' : nodeIdx}</div>
                  <div class="step-label">${label}</div>
                </div>`;
            }).join('')}
          </div>
        </div>

        <!-- Seller Contact Bar -->
        <div style="background:var(--azure-50);border:1px solid var(--azure-200);border-radius:var(--radius-md);padding:.9rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem;">
          <div>
            <div style="font-size:.82rem;font-weight:700;color:var(--azure-900);">Merchant: ${escapeHtml(order.shopName||'—')}</div>
            <div style="font-size:.75rem;color:var(--slate-600);">
              📞 +91 ${escapeHtml(order.sellerPhone||'—')}
              ${order.sellerEmail ? ` • 📧 ${escapeHtml(order.sellerEmail)}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap;">
            <a href="${callUrl}" class="btn btn-secondary btn-sm">📞 Call Seller</a>
            <a href="${waUrl}" target="_blank" class="btn btn-whatsapp btn-sm">💬 WhatsApp</a>
            <button class="btn btn-primary btn-sm" onclick='window.handleBuyAgain(${JSON.stringify(order.items||[])})'>
              🔁 Buy Again
            </button>
          </div>
        </div>

        <!-- Items collapsible -->
        <details style="font-size:.85rem;">
          <summary style="cursor:pointer;color:var(--azure-700);font-weight:700;padding:.4rem 0;">
            View ${(order.items||[]).length} Ordered Items &amp; Cost Breakdown
          </summary>
          <div style="padding-top:.5rem;">
            ${(order.items||[]).map(item => `
              <div style="display:flex;justify-content:space-between;padding:.25rem 0;border-bottom:1px dashed var(--slate-200);font-size:.8rem;">
                <span>• ${escapeHtml(item.title)} (${escapeHtml(item.unit||'')}) × ${item.quantity}</span>
                <span style="font-weight:700;">₹${(item.price||0)*item.quantity}</span>
              </div>`).join('')}
            <div style="display:flex;justify-content:space-between;font-size:.8rem;color:var(--slate-600);padding-top:.3rem;">
              <span>Subtotal</span><span>₹${order.itemsSubtotal||0}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.8rem;color:var(--slate-600);">
              <span>Delivery Fee</span><span>₹${order.deliveryFee||0}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:.85rem;font-weight:800;padding-top:.3rem;">
              <span>Total</span><span>₹${order.grandTotal||0}</span>
            </div>
          </div>
        </details>
      </div>`;
  }).join('');
}

// ─── Buy Again ────────────────────────────────────────────────────────────────
window.handleBuyAgain = function(items) {
  if (!items || !items.length) return;
  try {
    const cart = JSON.parse(localStorage.getItem('zulora_cart') || '{}');
    items.forEach(item => {
      const id = item.productId || 'rebuy_' + Math.random().toString(36).slice(2);
      if (cart[id]) { cart[id].quantity += item.quantity||1; }
      else {
        cart[id] = {
          product: { id, title: item.title, price: item.price, unit: item.unit||'', image: item.image||'' },
          quantity: item.quantity||1,
          shopId: item.shopId || 'shop_1'
        };
      }
    });
    localStorage.setItem('zulora_cart', JSON.stringify(cart));
    addNotification('Items added to cart! Ready to reorder.', 'success');
    window.showToast?.('Items added to cart!', 'success');
    setTimeout(() => window.location.href = './index.html', 600);
  } catch(e) {
    console.error('Buy Again error:', e);
    window.location.href = './index.html';
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getStatusStepIndex(status) {
  switch(status) {
    case 'Placed':              return 1;
    case 'Accepted & Packing':  return 2;
    case 'Out for Delivery':    return 3;
    case 'Delivered':           return 4;
    default:                    return 1;
  }
}

function getProgressPercentage(idx) {
  return [0, 12, 45, 78, 100][idx] || 12;
}

function formatOrderDate(ts) {
  if (!ts) return 'Recently';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds*1000);
  else d = new Date(ts);
  return d.toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
