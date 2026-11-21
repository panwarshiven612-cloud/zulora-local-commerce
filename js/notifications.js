/**
 * Zulora Local — Smart Notifications Center v2
 * Bell badge, toast alerts, browser push, and in-app notification drawer
 */
import { PLATFORM_CONSTANTS } from './config.js';

// ─── Toast Notifications ───────────────────────────────────────────────────
export function showToast(message, type = 'info', duration = 3800) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-msg">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}
window.showToast = showToast;

// ─── In-App Notification Store ─────────────────────────────────────────────
let notifications = [];
let unreadCount = 0;

export function addNotification(msg, type = 'info', link = null) {
  const n = { id: Date.now() + Math.random(), msg, type, link, time: new Date(), read: false };
  notifications.unshift(n);
  if (notifications.length > 50) notifications = notifications.slice(0, 50);
  unreadCount++;
  updateBell();
  showToast(msg, type);
  persistNotifications();
  return n;
}

export function markAllRead() {
  notifications.forEach(n => n.read = true);
  unreadCount = 0;
  updateBell();
  persistNotifications();
}

function updateBell() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function persistNotifications() {
  try { localStorage.setItem('zulora_notifs', JSON.stringify(notifications.slice(0, 20))); } catch(e) {}
}

export function loadSavedNotifications() {
  try {
    const raw = JSON.parse(localStorage.getItem('zulora_notifs') || '[]');
    notifications = raw;
    unreadCount = raw.filter(n => !n.read).length;
    updateBell();
  } catch(e) { notifications = []; }
}

export function getNotifications() { return notifications; }

// ─── Cart Reminder Notifications ───────────────────────────────────────────
let cartReminderTimer = null;
export function startCartReminder(cartItemCount) {
  clearTimeout(cartReminderTimer);
  if (cartItemCount <= 0) return;
  cartReminderTimer = setTimeout(() => {
    addNotification(
      `🛒 Your ${cartItemCount} item${cartItemCount > 1 ? 's are' : ' is'} waiting in your cart — complete your order now!`,
      'info'
    );
    triggerBrowserNotification(
      'Your cart is waiting!',
      `${cartItemCount} item${cartItemCount > 1 ? 's' : ''} in cart — complete your order and get it delivered fast!`,
      './index.html'
    );
  }, 15 * 60 * 1000); // 15 minutes
}
export function clearCartReminder() { clearTimeout(cartReminderTimer); }

// ─── New Local Product Notification ────────────────────────────────────────
export function notifyNewProduct(productTitle, shopName) {
  addNotification(`🆕 New deal nearby: "${productTitle}" from ${shopName}!`, 'info');
}

// ─── Order Status Notification ─────────────────────────────────────────────
export function notifyOrderStatus(orderId, status) {
  const msgs = {
    'Placed': `📦 Order #${orderId} placed! Merchant will confirm shortly.`,
    'Accepted & Packing': `✅ Order #${orderId} accepted — merchant is packing your items.`,
    'Out for Delivery': `🛵 Order #${orderId} is out for delivery! Get ready to receive.`,
    'Delivered': `🎉 Order #${orderId} delivered! Thank you for shopping on Zulora Local.`
  };
  const msg = msgs[status] || `Order #${orderId} status: ${status}`;
  addNotification(msg, status === 'Delivered' ? 'success' : 'info');
  triggerBrowserNotification('Zulora Local Order Update', msg, './orders.html');
}

// ─── Browser Push Notifications ────────────────────────────────────────────
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function triggerBrowserNotification(title, body, url = './', imageUrl = null) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'zulora-' + Date.now()
  };
  if (imageUrl) {
    options.image = imageUrl;
  }
  const n = new Notification(title, options);
  n.onclick = () => { window.open(url, '_blank'); n.close(); };
}

export function notifyDeliveryVerificationNeeded(orderId) {
  const msg = `🛵 Order #${orderId} has arrived! Please confirm delivery receipt on Zulora Local.`;
  addNotification(msg, 'info', './orders.html');
  triggerBrowserNotification('Order Arrived!', msg, './orders.html');
}

// ─── Render Notification Drawer ────────────────────────────────────────────
export function renderNotificationDrawer() {
  const container = document.getElementById('notifDrawerList');
  if (!container) return;
  if (notifications.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--slate-500);">
      <div style="font-size:2rem;margin-bottom:.5rem;">🔔</div>
      <p style="font-size:.85rem;font-weight:600;">No notifications yet.</p>
      <p style="font-size:.75rem;">Order updates, local deals, and cart reminders will appear here.</p>
    </div>`;
    return;
  }
  container.innerHTML = notifications.map(n => {
    const timeStr = new Date(n.time).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    return `<div class="notif-item ${n.read ? 'notif-read' : 'notif-unread'}" onclick="window.openNotifLink('${n.link || ''}')">
      <div class="notif-msg">${n.msg}</div>
      <div class="notif-time">${timeStr}</div>
    </div>`;
  }).join('');
}

window.openNotifLink = function(link) {
  if (link && link !== '' && link !== 'null') window.location.href = link;
};
