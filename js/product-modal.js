/**
 * Zulora Local — Product Detail Modal Engine (js/product-modal.js)
 * High-converting quick-commerce product detail view:
 * Multi-image carousel, delivery ETA, store distance & radius comparison.
 */

import { PLATFORM_CONSTANTS } from './config.js';
import { calculateHaversineDistance, getEstimatedDeliveryTime } from './geo-pricing.js';

export function openProductDetailModal({
  product,
  shop = {},
  userLocation = null,
  cartQty = 0,
  onAddToCart = null,
  onCartChange = null
} = {}) {
  if (!product) return;

  document.getElementById('productDetailModal')?.remove();

  const isVerified = Boolean(shop.isVerified);
  const rawImages = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : (product.imageUrl ? [product.imageUrl] : ['https://via.placeholder.com/400x400?text=Product+Image']);

  const distKm = (userLocation?.lat != null && shop.lat != null)
    ? calculateHaversineDistance(userLocation.lat, userLocation.lng, shop.lat, shop.lng)
    : null;
  const eta = getEstimatedDeliveryTime(distKm);
  const deliveryRadius = shop.deliveryRadiusKm ?? PLATFORM_CONSTANTS.DEFAULT_DELIVERY_RADIUS_KM;
  const isOutOfRadius = distKm != null && distKm > deliveryRadius;
  const shopCity = shop.city || shop.town || '';

  const hasDiscount = product.mrp && product.mrp > product.price;
  const discountPct = hasDiscount ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;
  const stockVal = product.stock != null ? product.stock : product.stockCount;
  const outOfStock = (stockVal != null && stockVal <= 0);

  const verifiedBadgeHtml = isVerified
    ? `<img src="${escapeHtml(PLATFORM_CONSTANTS.VERIFIED_BADGE_URL)}" class="verified-badge-sm" title="Verified Authorized Seller" alt="✓" />`
    : '';

  const dotsHtml = rawImages.length > 1
    ? `<div class="carousel-dots" style="bottom:10px;">
        ${rawImages.map((_, i) => `<span class="carousel-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></span>`).join('')}
       </div>`
    : '';

  const distanceBadgeText = distKm != null
    ? `📍 ${distKm} km from you`
    : (shopCity ? `📍 ${escapeHtml(shopCity)}` : '📍 Set GPS to calculate km');

  const modal = document.createElement('div');
  modal.id = 'productDetailModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box product-modal-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(product.title)}">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:0.4rem;overflow:hidden;padding-right:0.5rem;">
          <h3 style="font-size:1.05rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${escapeHtml(product.title)}
          </h3>
        </div>
        <button class="btn btn-icon" id="btnCloseProdModal" aria-label="Close">✕</button>
      </div>

      <div class="modal-body" style="padding:1rem;">
        <!-- Image Gallery / Carousel -->
        <div class="product-modal-gallery img-carousel" id="modalCarousel" data-idx="0">
          <img id="modalCarouselImg" src="${escapeHtml(rawImages[0])}" alt="${escapeHtml(product.title)}" />
          ${rawImages.length > 1 ? `
            <button class="carousel-prev" id="btnModalPrev" aria-label="Previous image">‹</button>
            <button class="carousel-next" id="btnModalNext" aria-label="Next image">›</button>
            ${dotsHtml}
          ` : ''}
        </div>

        <div style="padding-top:1rem;">
          <!-- Store & Distance info -->
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.65rem;">
            <div style="display:flex;align-items:center;gap:0.3rem;">
              <span style="font-size:0.86rem;font-weight:800;color:var(--azure-800);">
                🏪 ${escapeHtml(shop.name || product.shopName || 'Neighbourhood Seller')}
              </span>
              ${verifiedBadgeHtml}
            </div>
            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
              <span class="badge badge-distance">${distanceBadgeText}</span>
              <span class="badge badge-time">${eta}</span>
            </div>
          </div>

          <!-- Radius Alert -->
          ${isOutOfRadius ? `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius-sm);padding:0.45rem 0.65rem;font-size:0.75rem;color:#92400e;margin-bottom:0.75rem;">
              ⚠️ This store's standard delivery radius is ${deliveryRadius} km (you are ${distKm} km away). Delivery fee scales with distance.
            </div>
          ` : ''}

          <!-- Pricing & Discounts -->
          <div class="product-modal-pricing">
            <span class="product-modal-price">₹${product.price}</span>
            ${hasDiscount ? `<span class="product-modal-mrp">₹${product.mrp}</span>` : ''}
            ${hasDiscount ? `<span class="product-modal-discount">${discountPct}% OFF</span>` : ''}
          </div>

          <!-- Description -->
          <p class="product-modal-desc">
            ${escapeHtml(product.description || 'Freshly prepared and packaged by this neighbourhood merchant for direct doorstep delivery.')}
          </p>

          <!-- Specifications -->
          <div style="font-size:0.8rem;color:var(--slate-600);background:var(--slate-50);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:1rem;display:flex;flex-direction:column;gap:0.35rem;">
            <span>📦 <strong>Unit / Weight:</strong> ${escapeHtml(product.unit || '1 pc')} (${product.weightKg || product.weight || 0.5} kg)</span>
            <span>🏪 <strong>Store Area:</strong> ${escapeHtml(shopCity || 'Location on file')}${shop.state ? `, ${escapeHtml(shop.state)}` : ''} • Delivery Radius: ${deliveryRadius} km</span>
            <span>🚚 <strong>Distance Rate:</strong> ₹${shop.perKmRate || 15}/km (First 2 kg free, +₹10/km extra kg)</span>
            <span>📊 <strong>Availability:</strong> ${outOfStock ? '<strong style="color:var(--rose-600);">Out of Stock</strong>' : `<strong>${stockVal ?? 'In stock'} left</strong>`}</span>
          </div>

          <!-- Action Buttons -->
          <div class="product-modal-actions">
            <div id="modalCartActionWrap" style="flex:1.5;">
              ${outOfStock
                ? `<button class="btn btn-add-cart btn-out-of-stock" disabled style="width:100%;padding:0.65rem;">Out of Stock</button>`
                : cartQty > 0
                  ? `<div class="qty-pill" style="padding:0.35rem 0.6rem;">
                      <button class="qty-btn" id="btnModalQtyMinus" style="width:30px;height:30px;">−</button>
                      <span class="qty-count" style="font-size:0.95rem;">${cartQty}</span>
                      <button class="qty-btn" id="btnModalQtyPlus" style="width:30px;height:30px;">+</button>
                    </div>`
                  : `<button class="btn btn-success" id="btnModalAddToCart" style="width:100%;padding:0.65rem;font-size:0.88rem;">
                      🛒 Add to Cart
                    </button>`
              }
            </div>

            <div style="flex:1;">
              <a href="./orders.html" class="btn btn-secondary" style="width:100%;padding:0.65rem 0.5rem;font-size:0.8rem;text-align:center;display:flex;align-items:center;justify-content:center;gap:0.3rem;" title="Track Orders">
                📦 My Orders
              </a>
            </div>
          </div>

          <div style="margin-top:0.6rem;font-size:0.72rem;color:var(--slate-400);text-align:center;">
            🔒 Direct merchant phone &amp; WhatsApp appear immediately after order placement
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btnCloseProdModal')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  let curImgIdx = 0;
  const imgEl = modal.querySelector('#modalCarouselImg');
  const dots = modal.querySelectorAll('.carousel-dot');

  function setImg(idx) {
    curImgIdx = (idx + rawImages.length) % rawImages.length;
    if (imgEl) imgEl.src = rawImages[curImgIdx];
    dots.forEach((d, i) => d.classList.toggle('active', i === curImgIdx));
  }

  modal.querySelector('#btnModalPrev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setImg(curImgIdx - 1);
  });
  modal.querySelector('#btnModalNext')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setImg(curImgIdx + 1);
  });

  modal.querySelector('#btnModalAddToCart')?.addEventListener('click', () => {
    if (onAddToCart) onAddToCart(product.id);
    modal.remove();
  });

  modal.querySelector('#btnModalQtyMinus')?.addEventListener('click', () => {
    if (onCartChange) onCartChange(product.id, -1);
    modal.remove();
  });

  modal.querySelector('#btnModalQtyPlus')?.addEventListener('click', () => {
    if (onCartChange) onCartChange(product.id, 1);
    modal.remove();
  });
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
