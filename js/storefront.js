/**
 * Zulora Local — Storefront View Engine (js/storefront.js)
 * High-performance Zomato/Blinkit-grade rendering for product cards,
 * distance-aware area filtering, live search, and instant stepper updates.
 */

import { PLATFORM_CONSTANTS } from './config.js';
import { calculateHaversineDistance, getEstimatedDeliveryTime } from './geo-pricing.js';

/**
 * Render product cards grid with distance & radius awareness
 */
export function renderStorefrontProducts({
  container,
  countElement,
  products = [],
  allShops = new Map(),
  userLocation = null,
  cart = {},
  selectedCategory = 'All',
  searchQuery = '',
  nearbyFilterActive = false,
  onResetFilters = null
} = {}) {
  if (!container) return;

  const userTownLower = (userLocation?.town && userLocation.town !== 'All Locations')
    ? userLocation.town.trim().toLowerCase()
    : '';
  const hasUserGps = Boolean(userLocation && userLocation.lat != null && userLocation.lng != null);

  // 1. Filter products
  let filtered = products.filter(p => {
    if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;

    const shop = allShops.get(p.shopId) || {};

    if (searchQuery) {
      const haystack = [
        p.title || '',
        p.category || '',
        p.description || '',
        shop.name || p.shopName || '',
        shop.handle || '',
        shop.city || shop.town || '',
        shop.state || ''
      ].join(' ').toLowerCase();
      if (!haystack.includes(searchQuery.toLowerCase())) return false;
    }

    if (nearbyFilterActive) {
      if (hasUserGps && shop.lat != null && shop.lng != null) {
        const dist = calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng);
        const radius = shop.deliveryRadiusKm ?? PLATFORM_CONSTANTS.DEFAULT_DELIVERY_RADIUS_KM;
        if (dist == null || dist > radius) return false;
      } else if (userTownLower) {
        const shopTown = (shop.city || shop.town || '').toLowerCase();
        if (!shopTown || (!shopTown.includes(userTownLower) && !userTownLower.includes(shopTown))) {
          return false;
        }
      }
    }

    return true;
  });

  // 2. Sort: prioritize nearby distance (GPS first, then matching town)
  if (hasUserGps || userTownLower) {
    filtered.sort((a, b) => {
      const shopA = allShops.get(a.shopId) || {};
      const shopB = allShops.get(b.shopId) || {};
      const dA = (hasUserGps && shopA.lat != null)
        ? (calculateHaversineDistance(userLocation.lat, userLocation.lng, shopA.lat, shopA.lng) ?? 9999)
        : ((userTownLower && (shopA.city || shopA.town || '').toLowerCase().includes(userTownLower)) ? 100 : 9999);
      const dB = (hasUserGps && shopB.lat != null)
        ? (calculateHaversineDistance(userLocation.lat, userLocation.lng, shopB.lat, shopB.lng) ?? 9999)
        : ((userTownLower && (shopB.city || shopB.town || '').toLowerCase().includes(userTownLower)) ? 100 : 9999);
      return dA - dB;
    });
  }

  // 3. Update count header
  if (countElement) {
    if (products.length === 0) {
      countElement.textContent = '0 products';
    } else if (filtered.length === 0) {
      countElement.textContent = 'No matching products';
    } else {
      const locationLabel = userTownLower ? `near ${userLocation.town}` : 'available';
      countElement.textContent = `${filtered.length} item${filtered.length !== 1 ? 's' : ''} ${locationLabel}`;
    }
  }

  // 4. Clean Empty State: Zero fake products
  if (products.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3.5rem 1.25rem;background:#ffffff;border:1.5px dashed var(--border-strong);border-radius:var(--radius-xl);margin:1rem auto;max-width:540px;box-shadow:var(--shadow-xs);">
        <div style="font-size:3rem;margin-bottom:0.75rem;">🛍️</div>
        <h3 style="color:var(--slate-800);font-size:1.2rem;font-weight:800;margin-bottom:0.5rem;">No products uploaded yet</h3>
        <p style="color:var(--slate-500);font-size:0.88rem;max-width:420px;margin:0 auto 1.5rem;line-height:1.5;">
          No products listed in this area yet. Become an Authorized Seller in Settings or Seller Studio to upload the first live product!
        </p>
        <a href="./seller.html" class="btn btn-success btn-lg" style="display:inline-flex;align-items:center;gap:0.5rem;font-weight:800;">
          🏪 Become an Authorized Seller
        </a>
      </div>
    `;
    return;
  }

  // 5. Filter empty state
  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3rem 1.25rem;background:#ffffff;border-radius:var(--radius-xl);border:1px solid var(--border-subtle);margin:1rem auto;max-width:480px;box-shadow:var(--shadow-xs);">
        <div style="font-size:2.8rem;margin-bottom:0.5rem;">🔍</div>
        <h3 style="color:var(--slate-800);font-size:1.15rem;font-weight:800;margin-bottom:0.4rem;">No matching products found</h3>
        <p style="color:var(--slate-500);font-size:0.85rem;margin-bottom:1.25rem;">
          Try adjusting your search terms, category, or switch off Nearby Only to browse more areas.
        </p>
        <button class="btn btn-secondary btn-sm" id="btnResetSearchFilters" style="padding:0.45rem 1rem;">
          ↺ Reset All Filters
        </button>
      </div>
    `;
    container.querySelector('#btnResetSearchFilters')?.addEventListener('click', () => {
      if (onResetFilters) onResetFilters();
    });
    return;
  }

  // 6. Render product cards
  container.innerHTML = filtered.map(p => {
    const shop = allShops.get(p.shopId) || {};
    const qty = cart[p.id]?.qty || 0;
    return buildProductCardHtml(p, shop, userLocation, qty);
  }).join('');
}

/**
 * Build Single Blinkit/Zomato-Grade Product Card HTML
 */
export function buildProductCardHtml(product, shop = {}, userLocation = null, cartQty = 0) {
  const isVerified = Boolean(shop.isVerified);
  const isOpen = shop.isOpen !== false;
  const stockVal = product.stock != null ? product.stock : product.stockCount;
  const outOfStock = stockVal != null && stockVal <= 0;
  const lowStock = stockVal > 0 && stockVal <= 5;

  const distKm = (userLocation?.lat != null && shop.lat != null)
    ? calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng)
    : null;
  const shopCity = shop.city || shop.town || '';
  const deliveryRadius = shop.deliveryRadiusKm ?? PLATFORM_CONSTANTS.DEFAULT_DELIVERY_RADIUS_KM;

  const distLabel = distKm != null
    ? `📍 ${distKm} km away`
    : (shopCity ? `📍 ${escapeHtml(shopCity)}` : '📍 Set GPS for km');
  const timeLabel = `⚡ ${getEstimatedDeliveryTime(distKm)}`;

  const inRadius = distKm != null ? distKm <= deliveryRadius : true;
  const radiusBadgeHtml = distKm != null
    ? `<span style="display:inline-block;font-size:0.65rem;font-weight:700;color:${inRadius ? '#065f46' : '#991b1b'};background:${inRadius ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'};border:1px solid ${inRadius ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'};border-radius:4px;padding:0.12rem 0.42rem;">${inRadius ? `✓ ${distKm}km (within ${deliveryRadius}km radius)` : `⚠ ${distKm}km away (${deliveryRadius}km std)`}</span>`
    : (shopCity ? `<span style="display:inline-block;font-size:0.65rem;font-weight:700;color:var(--azure-700);background:var(--azure-50);border:1px solid var(--azure-200);border-radius:4px;padding:0.12rem 0.42rem;">Delivers up to ${deliveryRadius} km from ${escapeHtml(shopCity)}</span>` : '');

  const hasDiscount = product.mrp && product.mrp > product.price;
  const discountPct = hasDiscount ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;

  // Verified blue tick badge strictly 15px
  const verifiedBadgeHtml = isVerified
    ? `<img src="${escapeHtml(PLATFORM_CONSTANTS.VERIFIED_BADGE_URL)}" class="verified-badge-sm" title="Verified Authorized Seller" alt="✓" />`
    : '';

  const rawImages = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : (product.imageUrl ? [product.imageUrl] : ['https://via.placeholder.com/300x300?text=Product']);

  let imageHtml;
  if (rawImages.length > 1) {
    const dots = rawImages.map((_, i) =>
      `<span class="carousel-dot ${i === 0 ? 'active' : ''}"></span>`
    ).join('');
    imageHtml = `
      <div class="img-carousel">
        <img class="carousel-img" src="${escapeHtml(rawImages[0])}" alt="${escapeHtml(product.title)}" loading="lazy" />
        <div class="carousel-dots">${dots}</div>
      </div>
    `;
  } else {
    imageHtml = `
      <div class="card-image-wrap">
        <img class="product-img" src="${escapeHtml(rawImages[0])}" alt="${escapeHtml(product.title)}" loading="lazy" />
      </div>
    `;
  }

  const cartButtonHtml = outOfStock
    ? `<button class="btn-add-cart btn-out-of-stock" disabled>Out of Stock</button>`
    : cartQty > 0
      ? `<div class="qty-pill">
           <button class="qty-btn" onclick="event.stopPropagation(); window.handleCartChange('${escapeHtml(product.id)}', -1)">−</button>
           <span class="qty-count">${cartQty}</span>
           <button class="qty-btn" onclick="event.stopPropagation(); window.handleCartChange('${escapeHtml(product.id)}', 1)">+</button>
         </div>`
      : `<button class="btn-add-cart" onclick="event.stopPropagation(); window.handleCartAdd('${escapeHtml(product.id)}')">ADD</button>`;

  return `
    <div class="product-card" role="listitem" onclick="window.openProductDetailModal('${escapeHtml(product.id)}')">
      <div style="position:relative;width:100%;">
        ${imageHtml}
        <span class="badge badge-distance" style="position:absolute;top:7px;left:7px;z-index:2;">${distLabel}</span>
        <span class="badge badge-time" style="position:absolute;top:7px;right:7px;z-index:2;">${timeLabel}</span>
        <span class="badge badge-shop-status ${isOpen ? 'badge-open' : 'badge-closed'}" style="position:absolute;bottom:7px;left:7px;z-index:2;">
          ${isOpen ? '🟢 Open' : '🔴 Closed'}
        </span>
      </div>

      <div style="padding:0.85rem;display:flex;flex-direction:column;flex:1;">
        <div style="display:flex;align-items:center;gap:0.25rem;margin-bottom:0.25rem;">
          <span style="font-size:0.74rem;font-weight:700;color:var(--azure-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${escapeHtml(shop.name || product.shopName || 'Neighbourhood Seller')}
          </span>
          ${verifiedBadgeHtml}
        </div>

        <h3 style="font-size:0.94rem;font-weight:800;color:var(--slate-900);line-height:1.25;margin-bottom:0.25rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;height:2.45em;">
          ${escapeHtml(product.title)}
        </h3>

        <div style="font-size:0.73rem;color:var(--slate-500);margin-bottom:0.35rem;">
          ${escapeHtml(product.unit || '1 unit')} ${product.weightKg ? `• ${product.weightKg} kg` : ''}
        </div>

        ${radiusBadgeHtml ? `<div style="margin-bottom:0.4rem;">${radiusBadgeHtml}</div>` : ''}

        <div style="display:flex;align-items:baseline;gap:0.35rem;margin-top:auto;margin-bottom:0.55rem;flex-wrap:wrap;">
          <span style="font-size:1.12rem;font-weight:900;color:var(--slate-900);">₹${product.price}</span>
          ${hasDiscount ? `<span style="font-size:0.76rem;text-decoration:line-through;color:var(--slate-400);">₹${product.mrp}</span>` : ''}
          ${hasDiscount ? `<span style="font-size:0.7rem;font-weight:800;color:var(--emerald-600);background:var(--emerald-50);padding:0.08rem 0.35rem;border-radius:4px;">${discountPct}% OFF</span>` : ''}
        </div>

        ${lowStock ? `<p style="font-size:0.68rem;color:var(--rose-600);font-weight:700;margin-bottom:0.35rem;">⚠️ Only ${stockVal} left!</p>` : ''}

        <div id="cart_action_${escapeHtml(product.id)}" class="product-cart-action">
          ${cartButtonHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * Micro-DOM Stepper Update: Updates ONLY the clicked product's stepper container
 */
export function updateCardStepperDOM(productId, cartQty = 0, product = null) {
  const container = document.getElementById(`cart_action_${productId}`);
  if (!container) return;

  const stockVal = product ? (product.stock != null ? product.stock : product.stockCount) : null;
  const outOfStock = stockVal != null && stockVal <= 0;

  if (outOfStock) {
    container.innerHTML = `<button class="btn-add-cart btn-out-of-stock" disabled>Out of Stock</button>`;
  } else if (cartQty > 0) {
    container.innerHTML = `
      <div class="qty-pill">
        <button class="qty-btn" onclick="event.stopPropagation(); window.handleCartChange('${escapeHtml(productId)}', -1)">−</button>
        <span class="qty-count">${cartQty}</span>
        <button class="qty-btn" onclick="event.stopPropagation(); window.handleCartChange('${escapeHtml(productId)}', 1)">+</button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button class="btn-add-cart" onclick="event.stopPropagation(); window.handleCartAdd('${escapeHtml(productId)}')">ADD</button>
    `;
  }
}

/**
 * Live Debounced Search Suggestions
 */
export function renderLiveSuggestions(box, query, products = [], onSelect = null) {
  if (!box) return;

  if (!query || query.length < 2) {
    box.innerHTML = '';
    box.classList.remove('show');
    return;
  }

  const q = query.toLowerCase();
  const matches = products
    .filter(p => (p.title || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
    .slice(0, 6);

  if (!matches.length) {
    box.innerHTML = '';
    box.classList.remove('show');
    return;
  }

  box.innerHTML = matches.map(p => `
    <div class="suggestion-item" data-title="${escapeHtml(p.title)}">
      <span>🔍 <strong>${escapeHtml(p.title)}</strong> <small style="color:var(--slate-400);">(${escapeHtml(p.category || 'Item')})</small></span>
      <span style="color:var(--emerald-600);font-weight:800;">₹${p.price}</span>
    </div>
  `).join('');

  box.querySelectorAll('.suggestion-item').forEach(el => {
    el.addEventListener('click', () => {
      if (onSelect) onSelect(el.dataset.title);
      box.classList.remove('show');
    });
  });

  box.classList.add('show');
}

/**
 * Loading Skeleton Cards
 */
export function showLoadingSkeleton(grid, count = 4) {
  if (!grid) return;
  grid.innerHTML = Array(count).fill(0).map(() => `
    <div class="product-card skeleton-card" aria-hidden="true">
      <div class="card-image-wrap" style="background:#e2e8f0;"></div>
      <div style="padding:0.85rem;">
        <div style="width:60%;height:11px;background:#e2e8f0;margin-bottom:0.45rem;border-radius:4px;"></div>
        <div style="width:85%;height:14px;background:#e2e8f0;margin-bottom:0.5rem;border-radius:4px;"></div>
        <div style="width:35%;height:16px;background:#e2e8f0;margin-bottom:0.6rem;border-radius:4px;"></div>
        <div style="width:100%;height:34px;background:#e2e8f0;border-radius:8px;"></div>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
