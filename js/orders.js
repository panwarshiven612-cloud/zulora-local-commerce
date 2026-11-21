/**
 * Zulora Local — Buyer Orders & Live Tracker v2 (Clean & Production-Ready)
 * Real-time Firestore onSnapshot, 4-step Blinkit stepper, notifications, Buy Again
 * Zero fake/demo orders.
 */

import {
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, updateDoc, serverTimestamp, query, where, orderBy, onSnapshot, isConfigPlaceholder
} from './firebase-init.js';
import { PLATFORM_CONSTANTS } from './config.js';
import { addNotification, loadSavedNotifications, notifyOrderStatus, showToast } from './notifications.js';

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
    authPrompt?.classList.remove('hidden');
    renderOrders();
    return;
  }

  onAuthStateChanged(auth, user => {
    if (user) {
      currentUser = user;
      authPrompt?.classList.add('hidden');
      listenToLiveOrders(user.uid);
    } else {
      currentUser = null;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      userOrders = [];
      authPrompt?.classList.remove('hidden');
      renderOrders();
    }
  });
}

async function handleBuyerLogin() {
  if (!auth || isConfigPlaceholder) {
    showToast('Firebase authentication is offline or initializing.', 'warning');
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
    showToast('Signed in to view your orders!', 'success');
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Login failed: ' + e.message, 'error');
    }
  }
}

// ─── Live Orders Stream ───────────────────────────────────────────────────────
function listenToLiveOrders(buyerUid) {
  if (!db || isConfigPlaceholder) return;
  if (unsubscribe) unsubscribe();

  const q = query(
    collection(db, 'orders'),
    where('buyerUid', '==', buyerUid),
    orderBy('createdAt', 'desc')
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
    userOrders = [];
    renderOrders();
  });
}

// ─── Render Orders ────────────────────────────────────────────────────────────
function renderOrders() {
  if (!ordersListContainer) return;

  if (!currentUser) {
    ordersListContainer.innerHTML = '';
    return;
  }

  if (userOrders.length === 0) {
    ordersListContainer.innerHTML = `
      <div class="glass-card" style="text-align:center;padding:3.5rem 1.5rem;border-radius:var(--radius-lg);border:1px dashed var(--slate-300);max-width:600px;margin:1rem auto;">
        <div style="font-size:3.5rem;margin-bottom:0.75rem;">🛍️</div>
        <h3 style="font-size:1.25rem;color:var(--slate-800);font-weight:700;margin-bottom:0.5rem;">No Orders Placed Yet</h3>
        <p style="font-size:0.9rem;color:var(--slate-500);margin-bottom:1.5rem;line-height:1.5;">
          You haven't placed any orders yet. Discover fresh food, crops, and local products from neighbourhood sellers!
        </p>
        <a href="./index.html" class="btn btn-primary btn-lg" style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.5rem;border-radius:var(--radius-full);font-weight:700;">
          Explore Real Products
        </a>
      </div>`;
    return;
  }

  ordersListContainer.innerHTML = userOrders.map(order => {
    const status       = order.orderStatus || 'Placed';
    const stepIdx      = getStatusStepIndex(status);
    const progressPct  = getProgressPercentage(stepIdx);
    const cleanPhone   = (order.sellerPhone || '').replace(/[^0-9]/g, '');
    const callUrl      = cleanPhone ? `tel:+91${cleanPhone}` : `tel:${PLATFORM_CONSTANTS.HELPLINE_PHONE}`;
    const waPhone      = cleanPhone ? (cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone) : PLATFORM_CONSTANTS.HELPLINE_WHATSAPP;
    const waMsg        = encodeURIComponent(`Hi ${order.shopName || 'Seller'}, I have a query about my Zulora order #${order.orderId || order.docId}`);
    const waUrl        = `https://wa.me/${waPhone}?text=${waMsg}`;

    return `
      <div class="glass-card" style="padding:1.5rem;margin-bottom:1.5rem;border-radius:var(--radius-lg);">

        <!-- Header row -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;border-bottom:1px solid var(--slate-200);padding-bottom:1rem;margin-bottom:1rem;">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <span style="font-size:1.15rem;font-weight:800;color:var(--slate-900);">Order #${escapeHtml(order.orderId || order.docId)}</span>
              <span class="badge" style="background:var(--azure-100);color:var(--azure-800);font-size:0.75rem;font-weight:700;padding:0.25rem 0.6rem;border-radius:var(--radius-full);">
                ${escapeHtml(status)}
              </span>
            </div>
            <div style="font-size:0.8rem;color:var(--slate-500);margin-top:0.25rem;">
              Shop: <strong>${escapeHtml(order.shopName || 'Local Seller')}</strong> • ${formatOrderDate(order.createdAt)}
            </div>
            <div style="font-size:0.78rem;color:var(--slate-500);margin-top:0.2rem;">
              📍 Deliver to: ${escapeHtml(order.buyerAddress || 'Address on file')}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.3rem;font-weight:800;color:var(--azure-800);">₹${order.totalAmount || order.grandTotal || 0}</div>
            <div style="font-size:0.75rem;color:var(--slate-500);">${escapeHtml(order.paymentMode || order.paymentMethod || 'COD')}</div>
          </div>
        </div>

        <!-- 4-Step Blinkit-style Stepper -->
        <div style="margin:1.5rem 0 1rem;">
          <div style="font-size:0.82rem;font-weight:700;color:var(--slate-700);margin-bottom:0.75rem;display:flex;align-items:center;gap:0.35rem;">
            ⚡ Live Delivery Status: <span style="color:var(--azure-600);font-weight:800;">${escapeHtml(status)}</span>
          </div>
          <div class="stepper-container" style="display:flex;justify-content:space-between;position:relative;margin:1rem 0;">
            <div class="stepper-bar-fill" style="position:absolute;top:14px;left:0;height:4px;background:var(--azure-500);z-index:1;width:${progressPct}%;transition:width 0.4s;"></div>
            ${['Placed','Accepted & Packing','Out for Delivery','Delivered'].map((label, i) => {
              const nodeIdx = i + 1;
              const isCompleted = stepIdx > nodeIdx;
              const isActive = stepIdx === nodeIdx;
              return `
                <div class="step-node ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}" style="display:flex;flex-direction:column;align-items:center;z-index:2;position:relative;">
                  <div class="step-circle" style="width:28px;height:28px;border-radius:50%;background:${isCompleted || isActive ? 'var(--azure-600)' : 'var(--slate-200)'};color:${isCompleted || isActive ? '#fff' : 'var(--slate-600)'};display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;margin-bottom:0.35rem;">
                    ${isCompleted ? '✓' : nodeIdx}
                  </div>
                  <div class="step-label" style="font-size:0.7rem;font-weight:600;color:${isActive ? 'var(--azure-800)' : 'var(--slate-500)'};text-align:center;max-width:70px;">
                    ${label}
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>

        <!-- Seller Contact Bar -->
        <div style="background:var(--azure-50);border:1px solid var(--azure-200);border-radius:var(--radius-md);padding:0.85rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
          <div>
            <div style="font-size:0.85rem;font-weight:700;color:var(--azure-900);">Merchant: ${escapeHtml(order.shopName || 'Local Seller')}</div>
            <div style="font-size:0.78rem;color:var(--slate-600);">
              ${order.sellerPhone ? `📞 +91 ${escapeHtml(order.sellerPhone)}` : ''}
              ${order.sellerEmail ? ` • 📧 ${escapeHtml(order.sellerEmail)}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
            <a href="${callUrl}" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:0.3rem;">
              📞 Call Seller
            </a>
            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" style="display:inline-flex;align-items:center;gap:0.3rem;">
              💬 WhatsApp
            </a>
            <button class="btn btn-primary btn-sm" onclick='window.handleBuyAgain(${JSON.stringify(order.items || [])})'>
              🔁 Buy Again
            </button>
            ${order.buyerDeliveredConfirmed
              ? `<span style="background:var(--emerald-50,#ecfdf5);color:var(--emerald-700,#047857);border:1px solid var(--emerald-300,#a7f3d0);padding:0.3rem 0.65rem;border-radius:var(--radius-full);font-size:0.75rem;font-weight:700;display:inline-flex;align-items:center;gap:0.25rem;">✓ Delivery Confirmed</span>`
              : (order.orderStatus === 'Out for Delivery' || order.orderStatus === 'Delivered')
                ? `<button class="btn btn-sm" style="background:var(--emerald-600,#059669);color:#fff;border-radius:var(--radius-full);font-weight:700;" onclick="window.confirmOrderDelivery('${order.docId}')">✅ Confirm / Verify Delivered</button>`
                : ''
            }
          </div>
        </div>

        <!-- Items collapsible -->
        <details style="font-size:0.85rem;">
          <summary style="cursor:pointer;color:var(--azure-700);font-weight:700;padding:0.4rem 0;">
            View ${(order.items || []).length} Ordered Items
          </summary>
          <div style="padding-top:0.5rem;">
            ${(order.items || []).map(item => `
              <div style="display:flex;justify-content:space-between;padding:0.35rem 0;border-bottom:1px dashed var(--slate-200);font-size:0.82rem;">
                <span>• ${escapeHtml(item.title)} ${item.unit ? `(${escapeHtml(item.unit)})` : ''} × ${item.qty || item.quantity}</span>
                <span style="font-weight:700;">₹${(item.price || 0) * (item.qty || item.quantity)}</span>
              </div>`).join('')}
            <div style="display:flex;justify-content:space-between;font-size:0.88rem;font-weight:800;padding-top:0.5rem;">
              <span>Total Amount</span><span>₹${order.totalAmount || order.grandTotal || 0}</span>
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
    const rawCart = JSON.parse(localStorage.getItem('zulora_cart') || '{}');
    items.forEach(item => {
      const id = item.productId || 'p_' + Math.random().toString(36).slice(2);
      if (rawCart[id]) {
        rawCart[id].qty += (item.qty || item.quantity || 1);
      } else {
        rawCart[id] = {
          qty: (item.qty || item.quantity || 1),
          productId: id
        };
      }
    });
    localStorage.setItem('zulora_cart', JSON.stringify(rawCart));
    showToast('Items added to your cart!', 'success');
    setTimeout(() => window.location.href = './index.html', 500);
  } catch(e) {
    window.location.href = './index.html';
  }
};

// ─── Customer Delivery Verification ──────────────────────────────────────────
window.confirmOrderDelivery = async function(docId) {
  if (!db || isConfigPlaceholder || !docId) return;
  try {
    await updateDoc(doc(db, 'orders', docId), {
      orderStatus: 'Delivered',
      buyerDeliveredConfirmed: true,
      deliveredAt: serverTimestamp()
    });
    showToast('🎉 Delivery verified! Thank you for shopping on Zulora Local.', 'success');
  } catch (err) {
    showToast('Could not verify delivery: ' + err.message, 'error');
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
  return [0, 15, 48, 80, 100][idx] || 15;
}

function formatOrderDate(ts) {
  if (!ts) return 'Recently';
  let d;
  if (ts.toDate) d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
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
