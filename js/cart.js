/**
 * Zulora Local — Modular Smart Cart & Delivery Pricing Engine v2
 * Multi-shop order splitting, distance & weight pricing, localStorage persistence
 */

import { calculateHaversineDistance, calculateDeliveryFeeAndMinOrder } from './geo-pricing.js';
import { startCartReminder, clearCartReminder, showToast } from './notifications.js';

let cart = {};

export function getCart() {
  return cart;
}

export function loadCartFromStorage(allProducts = []) {
  try {
    const raw = JSON.parse(localStorage.getItem('zulora_cart') || '{}');
    cart = {};
    Object.entries(raw).forEach(([id, item]) => {
      const product = allProducts.find(p => p.id === id);
      if (product) {
        cart[id] = { product, qty: item.qty };
      }
    });
  } catch (e) {
    cart = {};
  }
  updateCartReminderState();
  return cart;
}

export function saveCartToStorage() {
  try {
    const simplified = {};
    Object.entries(cart).forEach(([id, item]) => {
      simplified[id] = { qty: item.qty, productId: item.product.id };
    });
    localStorage.setItem('zulora_cart', JSON.stringify(simplified));
  } catch (e) {}
  updateCartReminderState();
}

export function addToCart(product) {
  if (!product || !product.id) return;
  if (product.stock <= 0) {
    showToast('This product is currently out of stock.', 'warning');
    return;
  }

  if (cart[product.id]) {
    cart[product.id].qty += 1;
  } else {
    cart[product.id] = { product, qty: 1 };
  }

  saveCartToStorage();
  showToast(`"${product.title}" added to cart!`, 'success');
  return cart;
}

export function changeCartQty(productId, delta) {
  if (!cart[productId]) return;

  cart[productId].qty += delta;
  if (cart[productId].qty <= 0) {
    delete cart[productId];
  }

  saveCartToStorage();
  return cart;
}

export function clearCart() {
  cart = {};
  saveCartToStorage();
  clearCartReminder();
}

export function getCartTotals() {
  const items = Object.values(cart);
  const totalCount = items.reduce((sum, item) => sum + item.qty, 0);
  const totalPrice = items.reduce((sum, item) => sum + item.product.price * item.qty, 0);
  return { totalCount, totalPrice };
}

function updateCartReminderState() {
  const { totalCount } = getCartTotals();
  if (totalCount > 0) {
    startCartReminder(totalCount);
  } else {
    clearCartReminder();
  }
}

/**
 * Smart Multi-Shop Splitting & Independent Delivery Rules
 * Groups items by shop, applies independent distance + weight pricing rules
 */
export function groupCartByShop(allShops = new Map(), userLocation = null) {
  const groups = {};

  Object.values(cart).forEach(item => {
    const shopId = item.product.shopId || 'shop_direct';
    if (!groups[shopId]) {
      const shop = allShops.get(shopId) || {
        id: shopId,
        name: item.product.shopName || 'Local Seller',
        lat: null,
        lng: null
      };
      groups[shopId] = {
        shop,
        items: [],
        shopTotal: 0,
        totalWeightKg: 0
      };
    }

    groups[shopId].items.push(item);
    groups[shopId].shopTotal += (item.product.price * item.qty);
    const weightPerUnit = Number(item.product.weightKg || item.product.weight || 0.5);
    groups[shopId].totalWeightKg += (weightPerUnit * item.qty);
  });

  // Calculate delivery fee and minimum order per shop group
  Object.values(groups).forEach(g => {
    const distKm = (userLocation?.lat != null && g.shop.lat != null)
      ? calculateHaversineDistance(userLocation.lat, userLocation.lng, g.shop.lat, g.shop.lng)
      : null;

    const deliveryRules = calculateDeliveryFeeAndMinOrder(distKm, g.totalWeightKg);
    g.distKm = distKm;
    g.deliveryFee = deliveryRules.deliveryFee;
    g.minOrder = deliveryRules.minOrder;
    g.deliveryTime = deliveryRules.deliveryTime;
    g.isBelowMinOrder = g.shopTotal < g.minOrder;
  });

  return groups;
}
