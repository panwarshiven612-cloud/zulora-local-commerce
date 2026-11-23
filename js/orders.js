/**
 * Zulora Local — Buyer Orders & Live Tracker v3 (Production-Grade)
 * Real-time Firestore onSnapshot without composite index blocks,
 * 4-step Blinkit-style stepper, detailed per-km distance/weight breakdown,
 * post-order seller contact & live delivery receipt verification.
 * Zero fake/demo orders.
 */

import {
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, getDoc, updateDoc, serverTimestamp, query, where, onSnapshot, isConfigPlaceholder
} from './firebase-init.js';
import { PLATFORM_CONSTANTS } from './config.js';
import { showUnauthorizedDomainDialog } from './auth.js';
import { addNotification, loadSavedNotifications, notifyOrderStatus, showToast, triggerBrowserNotification } from './notifications.js';

// ─── State ───────────────────────────────────────────────────────────────────
let currentUser  = null;
let userOrders   = [];
let unsubscribe  = null;
let unsubscribeFallback = null;
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

  // Show smooth loading state while Firebase restores session from IndexedDB on refresh
  if (ordersListContainer) {
    ordersListContainer.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;color:var(--slate-500);">
        <div style="font-size:2rem;margin-bottom:0.5rem;display:inline-block;animation:spin 1s linear infinite;">⌛</div>
        <p style="font-size:0.9rem;font-weight:600;">Connecting to Zulora Live Order Tracker…</p>
      </div>
    `;
  }

  let authResolved = false;
  const authTimeout = setTimeout(() => {
    if (!authResolved) {
      console.warn('[Orders] Auth state timeout — showing login prompt');
      authPrompt?.classList.remove('hidden');
      renderOrders();
    }
  }, 6000);

  onAuthStateChanged(auth, user => {
    authResolved = true;
    clearTimeout(authTimeout);
    if (user) {
      currentUser = user;
      authPrompt?.classList.add('hidden');
      listenToLiveOrders(user.uid, user.email);
    } else {
      currentUser = null;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      if (unsubscribeFallback) { unsubscribeFallback(); unsubscribeFallback = null; }
      userOrders = [];
      authPrompt?.classList.remove('hidden');
      renderOrders();
    }
  }, (err) => {
    authResolved = true;
    clearTimeout(authTimeout);
    console.error('[Orders] onAuthStateChanged error:', err);
    authPrompt?.classList.remove('hidden');
    renderOrders();
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
    if (e.code === 'auth/unauthorized-domain') {
      showUnauthorizedDomainDialog();
    } else if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Login failed: ' + e.message, 'error');
    }
  }
}

// ─── Live Orders Stream (Dual parallel queries: buyerUid + buyerEmail) ─────────
function listenToLiveOrders(buyerUid, buyerEmail = '') {
  if (!db || isConfigPlaceholder || !buyerUid) return;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (unsubscribeFallback) { unsubscribeFallback(); unsubscribeFallback = null; }

  const ordersMap = new Map();

  // Query 1: strictly on buyerUid WITHOUT orderBy to eliminate compound index requirements
  const q = query(
    collection(db, 'orders'),
    where('buyerUid', '==', buyerUid)
  );

  unsubscribe = onSnapshot(q, snapshot => {
    snapshot.forEach(d => {
      ordersMap.set(d.id, { docId: d.id, ...d.data() });
    });
    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed') ordersMap.delete(change.doc.id);
    });
    processAndRenderOrders(Array.from(ordersMap.values()));
  }, err => {
    console.warn('[Orders] BuyerUid onSnapshot notice:', err);
    processAndRenderOrders(Array.from(ordersMap.values()));
  });

  // Query 2: parallel stream on buyerEmail (for guest orders or multi-session continuity)
  if (buyerEmail) {
    const qEmail = query(
      collection(db, 'orders'),
      where('buyerEmail', '==', buyerEmail)
    );
    unsubscribeFallback = onSnapshot(qEmail, snap => {
      snap.forEach(d => {
        ordersMap.set(d.id, { docId: d.id, ...d.data() });
      });
      snap.docChanges().forEach(change => {
        if (change.type === 'removed') ordersMap.delete(change.doc.id);
      });
      processAndRenderOrders(Array.from(ordersMap.values()));
    }, err => {
      console.warn('[Orders] Email fallback notice:', err);
      processAndRenderOrders(Array.from(ordersMap.values()));
    });
  }
}

function processAndRenderOrders(ordersList) {
  // Sort in memory by createdAt descending
  ordersList.sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a));

  // Fire notifications for newly changed statuses
  ordersList.forEach(order => {
    const id = order.docId;
    const currentStatus = order.orderStatus || order.status || 'Placed';
    const prev = prevStatuses[id];

    if (prev && prev !== currentStatus) {
      notifyOrderStatus(order.orderCode || order.orderId || id, currentStatus);
      const statusMsgs = {
        'Confirmed by Merchant': `✅ Your order #${order.orderCode || order.orderId || id} has been confirmed by merchant!`,
        'Approved / Confirmed': `✅ Your order #${order.orderCode || order.orderId || id} has been accepted by merchant!`,
        'Accepted & Packing': `📦 Merchant is packing your order #${order.orderCode || order.orderId || id}!`,
        'Packed / Out for Delivery': `🛵 Order #${order.orderCode || order.orderId || id} is out for delivery!`,
        'Out for Delivery': `🛵 Order #${order.orderCode || order.orderId || id} is out for delivery!`,
        'Delivered': `🎉 Order #${order.orderCode || order.orderId || id} delivered! Please confirm delivery on Zulora.`,
        'Verified Delivered': `✓ Delivery verified for order #${order.orderCode || order.orderId || id}!`,
        'Cancelled': `✕ Order #${order.orderCode || order.orderId || id} was cancelled.`
      };
      const pushMsg = statusMsgs[currentStatus];
      if (pushMsg) {
        triggerBrowserNotification('Zulora Local — Live Order Update', pushMsg, './orders.html');
      }
    }
    prevStatuses[id] = currentStatus;
  });

  userOrders = ordersList;
  renderOrders();
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
        <a href="./index.html" class="btn btn-primary btn-lg" style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.75rem 1.5rem;border-radius:var(--radius-full);font-weight:700;background:var(--azure-600);border-color:var(--azure-600);">
          Explore Real Products
        </a>
      </div>`;
    return;
  }

  ordersListContainer.innerHTML = userOrders.map(order => {
    const rawStatus    = order.orderStatus || order.status || 'Placed';
    const status       = normalizeStatus(rawStatus);
    const stepIdx      = getStatusStepIndex(status);
    const progressPct  = getProgressPercentage(stepIdx);
    const cleanPhone   = (order.shopPhone || order.sellerPhone || '').replace(/[^0-9]/g, '');
    const callUrl      = cleanPhone ? `tel:+91${cleanPhone}` : `tel:${PLATFORM_CONSTANTS.HELPLINE_PHONE}`;
    const waPhone      = cleanPhone ? (cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone) : PLATFORM_CONSTANTS.HELPLINE_WHATSAPP;
    const waMsg        = encodeURIComponent(`Hi ${order.shopName || 'Seller'}, I have a query about my Zulora order #${order.orderCode || order.orderId || order.docId}`);
    const waUrl        = `https://wa.me/${waPhone}?text=${waMsg}`;

    const distDisplay  = (order.distanceKm != null || order.distKm != null) ? `${order.distanceKm ?? order.distKm} km` : 'Local';
    const delFeeDisplay= order.deliveryCharge || order.baseDeliveryFee || 15;
    const weightFeeDisplay = (order.extraWeightCharge || order.weightFee || 0);

    const cancelUntil  = order.cancelableUntil || (order.createdAt?.seconds ? order.createdAt.seconds * 1000 + 5*60*1000 : 0);
    const isCancelable = (status === 'Placed') && Date.now() < cancelUntil;

    return `
      <div class="glass-card" style="padding:1.5rem;margin-bottom:1.5rem;border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);border:1px solid var(--border-subtle);">

        <!-- Header row -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;border-bottom:1px solid var(--slate-200);padding-bottom:1rem;margin-bottom:1rem;">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <span style="font-size:1.15rem;font-weight:800;color:var(--slate-900);">Order #${escapeHtml(order.orderCode || order.orderId || order.docId)}</span>
              <span class="badge" style="background:${getStatusBadgeColor(status)};color:#fff;font-size:0.75rem;font-weight:700;padding:0.25rem 0.6rem;border-radius:var(--radius-full);">
                ${escapeHtml(status)}
              </span>
            </div>
            <div style="font-size:0.82rem;color:var(--slate-600);margin-top:0.35rem;">
              🏪 Merchant: <strong>${escapeHtml(order.shopName || 'Local Seller')}</strong> • ${formatOrderDate(order.createdAt || order.createdAtIso)}
            </div>
            <div style="font-size:0.78rem;color:var(--slate-500);margin-top:0.2rem;">
              📍 Deliver to: ${escapeHtml(order.buyerAddress || 'Address on file')}${order.buyerCityTown ? `, ${escapeHtml(order.buyerCityTown)}` : ''}${order.buyerState ? `, ${escapeHtml(order.buyerState)}` : ''}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.35rem;font-weight:900;color:var(--azure-800);">₹${order.totalAmount || order.grandTotal || 0}</div>
            <div style="font-size:0.75rem;color:var(--slate-500);font-weight:600;">${escapeHtml(order.paymentMethod || order.paymentMode || 'COD')}</div>
          </div>
        </div>

        <!-- 4-Step Blinkit-style Stepper -->
        <div style="margin:1.5rem 0 1.25rem;">
          <div style="font-size:0.84rem;font-weight:700;color:var(--slate-700);margin-bottom:0.75rem;display:flex;align-items:center;gap:0.35rem;">
            ⚡ Live Delivery Status: <span style="color:var(--azure-600);font-weight:800;">${escapeHtml(status)}</span>
          </div>
          <div class="stepper-container" style="display:flex;justify-content:space-between;position:relative;margin:1rem 0;">
            <div class="stepper-bar-fill" style="position:absolute;top:14px;left:0;height:4px;background:var(--azure-500);z-index:1;width:${progressPct}%;transition:width 0.4s;"></div>
            ${['Placed','Confirmed by Merchant','Packed / Out for Delivery','Delivered'].map((label, i) => {
              const nodeIdx = i + 1;
              const isCompleted = stepIdx > nodeIdx;
              const isActive = stepIdx === nodeIdx;
              return `
                <div class="step-node ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}" style="display:flex;flex-direction:column;align-items:center;z-index:2;position:relative;">
                  <div class="step-circle" style="width:28px;height:28px;border-radius:50%;background:${isCompleted || isActive ? 'var(--azure-600)' : 'var(--slate-200)'};color:${isCompleted || isActive ? '#fff' : 'var(--slate-600)'};display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;margin-bottom:0.35rem;">
                    ${isCompleted ? '✓' : nodeIdx}
                  </div>
                  <div class="step-label" style="font-size:0.7rem;font-weight:600;color:${isActive ? 'var(--azure-800)' : 'var(--slate-500)'};text-align:center;max-width:75px;">
                    ${label}
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>

        <!-- Per-KM Pricing & Bill Breakdown Bar -->
        <div style="background:var(--slate-50);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:0.75rem 0.9rem;margin-bottom:1rem;font-size:0.8rem;color:var(--slate-700);display:flex;flex-wrap:wrap;justify-content:space-between;gap:0.5rem;">
          <div>
            <span>Items: <strong>₹${order.subtotal || order.itemsSubtotal || 0}</strong></span> • 
            <span>Distance (${distDisplay}): <strong>₹${delFeeDisplay}</strong></span> • 
            <span>Weight Surcharge: <strong>${weightFeeDisplay > 0 ? '₹' + weightFeeDisplay : 'FREE (≤2kg)'}</strong></span>
          </div>
          <div style="font-weight:800;color:var(--azure-800);">
            Total: ₹${order.totalAmount || order.grandTotal || 0}
          </div>
        </div>

        <!-- Post-Order Seller Contact & Actions Bar -->
        <div style="background:var(--azure-50);border:1px solid var(--azure-200);border-radius:var(--radius-md);padding:0.85rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
          <div>
            <div style="font-size:0.85rem;font-weight:700;color:var(--azure-900);">Merchant Direct Contact</div>
            <div style="font-size:0.78rem;color:var(--slate-600);">
              ${order.shopPhone || order.sellerPhone ? `📞 +91 ${escapeHtml(order.shopPhone || order.sellerPhone)}` : ''}
              ${order.shopEmail || order.sellerEmail ? ` • 📧 ${escapeHtml(order.shopEmail || order.sellerEmail)}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
            <a href="${callUrl}" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:0.3rem;">
              📞 Call Seller
            </a>
            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" style="display:inline-flex;align-items:center;gap:0.3rem;">
              💬 WhatsApp
            </a>
            ${isCancelable
              ? `<button class="btn btn-sm" style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;border-radius:var(--radius-full);font-weight:700;" onclick="window.cancelOrder('${order.docId}')">✕ Cancel Order (5m)</button>`
              : ''}
            <button class="btn btn-primary btn-sm" onclick='window.handleBuyAgain(${JSON.stringify(order.items || [])})'>
              🔁 Buy Again
            </button>
            ${(order.buyerDeliveredConfirmed || status === 'Verified Delivered')
              ? `<span style="background:var(--emerald-50,#ecfdf5);color:var(--emerald-700,#047857);border:1px solid var(--emerald-300,#a7f3d0);padding:0.3rem 0.65rem;border-radius:var(--radius-full);font-size:0.75rem;font-weight:700;display:inline-flex;align-items:center;gap:0.25rem;">✓ Delivery Confirmed</span>`
              : (status === 'Out for Delivery' || status === 'Delivered' || status === 'Packed / Out for Delivery')
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
      orderStatus: 'Verified Delivered',
      status: 'verified delivered',
      buyerDeliveredConfirmed: true,
      deliveredAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    showToast('🎉 Delivery verified! Thank you for shopping on Zulora Local.', 'success');
  } catch (err) {
    showToast('Could not verify delivery: ' + err.message, 'error');
  }
};

// ─── 5-Minute Order Cancellation ─────────────────────────────────────────────
window.cancelOrder = async function(docId) {
  if (!db || isConfigPlaceholder || !docId) return;
  if (!confirm('Are you sure you want to cancel this order?')) return;
  try {
    const orderRef = doc(db, 'orders', docId);
    const snap = await getDoc(orderRef);
    if (!snap.exists()) { showToast('Order not found.', 'error'); return; }
    const data = snap.data();
    const cancelableUntil = data.cancelableUntil || (data.createdAt?.seconds ? data.createdAt.seconds * 1000 + 5*60*1000 : 0);
    if (Date.now() > cancelableUntil) {
      showToast('The 5-minute cancellation window has passed. Contact the seller directly.', 'warning');
      return;
    }
    const curStatus = (data.orderStatus || data.status || '').toLowerCase();
    if (curStatus !== 'placed') {
      showToast('Order cannot be cancelled — it has already been accepted by the seller.', 'warning');
      return;
    }
    await updateDoc(orderRef, {
      orderStatus: 'Cancelled',
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    showToast('Order cancelled successfully.', 'success');
  } catch(err) {
    showToast('Could not cancel order: ' + err.message, 'error');
  }
};

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

function getStatusStepIndex(status) {
  switch(status) {
    case 'Placed':
      return 1;
    case 'Confirmed by Merchant':
      return 2;
    case 'Packed / Out for Delivery':
      return 3;
    case 'Delivered':
    case 'Verified Delivered':
      return 4;
    default:
      return 1;
  }
}

function getProgressPercentage(idx) {
  return [0, 15, 48, 80, 100][idx] || 15;
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
