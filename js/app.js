/**
 * Zulora Local — Main Storefront Application Engine v4
 * Zomato/Blinkit-grade modular quick commerce orchestrator.
 * Location-first discovery, Checkout auto-fill, Dynamic UPI QR,
 * Authorized Seller registration in Settings, and live Firestore sync.
 */

import {
  db, collection, doc, getDoc, setDoc, addDoc, updateDoc,
  onSnapshot, serverTimestamp, increment, isConfigPlaceholder
} from './firebase-init.js';

import {
  initAuth, signInWithGoogle, signOutUser
} from './auth.js';

import {
  getCart, loadCartFromStorage, addToCart as cartAdd,
  changeCartQty as cartChangeQty, clearCart, getCartTotals,
  groupCartByShop
} from './cart.js';

import {
  getCurrentGpsPosition, saveUserLocation, getSavedUserLocation,
  saveUserProfile, getSavedUserProfile
} from './geo-pricing.js';

import { PLATFORM_CONSTANTS } from './config.js';
import { promptPWAInstall } from './pwa.js';
import {
  loadSavedNotifications, renderNotificationDrawer,
  markAllRead, notifyOrderStatus, showToast
} from './notifications.js';

import { openLocationSetupModal } from './location-modal.js';
import { openProductDetailModal } from './product-modal.js';
import {
  renderStorefrontProducts, updateCardStepperDOM,
  renderLiveSuggestions, showLoadingSkeleton
} from './storefront.js';
import { buildUpiUri, renderQrSvgHtml } from './upi-qr.js';

// ─── Application State ────────────────────────────────────────────────────────
let currentUser = null;
let userLocation = getSavedUserLocation();
let userProfile = getSavedUserProfile();
let allProducts = [];
let allShops = new Map();
let selectedCategory = 'All';
let searchQuery = '';
let nearbyFilterActive = false;
let pendingCheckoutAfterAuth = false;
let regShopCoords = null;

// ─── Boot Lifecycle ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateLocationUI();
  initAuth(handleUserAuthChange);
  loadCartFromStorage(allProducts);
  updateCartUI();
  loadPlatformData();
  loadSavedNotifications();
});

// ─── Setup Event Listeners ────────────────────────────────────────────────────
function setupEventListeners() {
  // Navigation & 3-Bar Hamburger Drawer
  document.getElementById('btnHamburgerMenu')?.addEventListener('click', openMenuDrawer);
  document.getElementById('btnCloseMenuDrawer')?.addEventListener('click', closeMenuDrawer);
  document.getElementById('topLocationPill')?.addEventListener('click', triggerLocationModal);
  document.getElementById('navCartBtn')?.addEventListener('click', openCart);
  document.getElementById('mobileTabSettings')?.addEventListener('click', () => openSettingsModal('profile'));

  // Drawer Menu Navigation Links
  document.getElementById('menuItemLocation')?.addEventListener('click', () => {
    closeMenuDrawer();
    triggerLocationModal();
  });
  document.getElementById('menuItemSettings')?.addEventListener('click', () => {
    closeMenuDrawer();
    openSettingsModal('profile');
  });
  document.getElementById('menuItemAbout')?.addEventListener('click', () => {
    closeMenuDrawer();
    openAboutModal();
  });
  document.getElementById('menuItemPolicy')?.addEventListener('click', () => {
    closeMenuDrawer();
    openPolicyModal();
  });
  document.getElementById('menuItemTerms')?.addEventListener('click', () => {
    closeMenuDrawer();
    openTermsModal();
  });
  document.getElementById('drawerUserCard')?.addEventListener('click', () => {
    if (!currentUser) {
      closeMenuDrawer();
      openSignInModal();
    }
  });

  // Auth Modals & Actions
  document.getElementById('authBtn')?.addEventListener('click', openSignInModal);
  document.getElementById('btnCloseSignInModal')?.addEventListener('click', closeSignInModal);
  document.getElementById('modalGoogleSignInBtn')?.addEventListener('click', async () => {
    closeSignInModal();
    await handleSignInAction();
  });

  // Account Modal & Safe Sign-Out
  document.getElementById('btnUserAccount')?.addEventListener('click', openAccountModal);
  document.getElementById('btnCloseAccountModal')?.addEventListener('click', closeAccountModal);
  document.getElementById('modalAccountSignOutBtn')?.addEventListener('click', async () => {
    closeAccountModal();
    await handleSignOutAction();
  });
  document.getElementById('btnAccountChangeLocation')?.addEventListener('click', () => {
    closeAccountModal();
    triggerLocationModal();
  });
  document.getElementById('userAccountModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'userAccountModal') closeAccountModal();
  });

  // Informational Modals
  document.getElementById('btnCloseTermsModal')?.addEventListener('click', closeTermsModal);
  document.getElementById('btnAgreeTerms')?.addEventListener('click', closeTermsModal);
  document.getElementById('btnClosePolicyModal')?.addEventListener('click', closePolicyModal);
  document.getElementById('btnAgreePolicy')?.addEventListener('click', closePolicyModal);
  document.getElementById('btnCloseAboutUsModal')?.addEventListener('click', closeAboutModal);

  // Expanded Settings Modal
  setupSettingsModalListeners();

  // Location Controls in Banner
  document.getElementById('btnDetectGps')?.addEventListener('click', triggerLocationModal);
  document.getElementById('btnManualLocation')?.addEventListener('click', triggerLocationModal);

  // Debounced Search Input & Live Suggestions
  const searchInput = document.getElementById('searchInput');
  const suggestionsBox = document.getElementById('searchSuggestions');
  let searchDebounceTimer = null;

  searchInput?.addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    renderLiveSuggestions(suggestionsBox, searchQuery, allProducts, selectedTitle => {
      if (searchInput) searchInput.value = selectedTitle;
      searchQuery = selectedTitle;
      refreshProductGrid();
    });

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      refreshProductGrid();
    }, 100);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-hero')) {
      suggestionsBox?.classList.remove('show');
    }
  });

  // Filters: All vs Nearby
  document.getElementById('filterAllBtn')?.addEventListener('click', () => {
    nearbyFilterActive = false;
    document.getElementById('filterAllBtn')?.classList.add('active');
    document.getElementById('filterNearbyBtn')?.classList.remove('active');
    refreshProductGrid();
  });

  document.getElementById('filterNearbyBtn')?.addEventListener('click', () => {
    if (!userLocation || (userLocation.lat == null && (!userLocation.town || userLocation.town === 'All Locations'))) {
      showToast('Set your City/Town or GPS first to filter nearby stores.', 'warning');
      triggerLocationModal();
      return;
    }
    nearbyFilterActive = true;
    document.getElementById('filterNearbyBtn')?.classList.add('active');
    document.getElementById('filterAllBtn')?.classList.remove('active');
    refreshProductGrid();
  });

  // Category Pills Navigation
  document.getElementById('categoryScroll')?.addEventListener('click', e => {
    const pill = e.target.closest('.category-pill');
    if (!pill) return;
    document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedCategory = pill.dataset.category || 'All';
    refreshProductGrid();
  });

  // Cart Drawer Triggers
  document.getElementById('floatingCartBar')?.addEventListener('click', openCart);
  document.getElementById('btnOpenCart')?.addEventListener('click', openCart);
  document.getElementById('closeCartDrawer')?.addEventListener('click', closeCart);

  // Global Backdrop
  document.getElementById('drawerBackdrop')?.addEventListener('click', () => {
    closeCart();
    closeNotifDrawer();
    closeMenuDrawer();
  });

  // PWA Install
  document.getElementById('btnInstallApp')?.addEventListener('click', promptPWAInstall);
  document.getElementById('btnPwaInstall')?.addEventListener('click', promptPWAInstall);
  document.getElementById('btnPwaDismiss')?.addEventListener('click', () => {
    document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  });

  // Data Refresh
  document.getElementById('btnRefreshData')?.addEventListener('click', () => {
    loadPlatformData();
    showToast('Refreshing live storefront…', 'info');
  });

  // Notifications Drawer
  document.getElementById('btnNotifBell')?.addEventListener('click', openNotifDrawer);
  document.getElementById('btnCloseNotifDrawer')?.addEventListener('click', closeNotifDrawer);
  document.getElementById('btnMarkAllRead')?.addEventListener('click', () => {
    markAllRead();
    renderNotificationDrawer();
  });
}

function triggerLocationModal() {
  openLocationSetupModal({
    currentLocation: userLocation,
    currentUser,
    db,
    isConfigPlaceholder,
    onLocationSaved: handleLocationSaved
  });
}

// ─── Settings Modal Tabs, Profile, Authorized Seller & Feedback ───────────────
function setupSettingsModalListeners() {
  document.getElementById('btnCloseSettingsModal')?.addEventListener('click', closeSettingsModal);
  document.getElementById('btnSettingsSignOut')?.addEventListener('click', async () => {
    closeSettingsModal();
    await handleSignOutAction();
  });
  document.getElementById('btnSettingsChangeLocation')?.addEventListener('click', () => {
    closeSettingsModal();
    triggerLocationModal();
  });

  // Tab switching
  document.querySelectorAll('#settingsTabs .settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchSettingsTab(btn.dataset.tab || 'profile');
    });
  });

  // Save Profile & Address
  document.getElementById('btnSettingsSaveProfile')?.addEventListener('click', async () => {
    const name = document.getElementById('setProfileName')?.value.trim() || '';
    const phone = document.getElementById('setProfilePhone')?.value.trim() || '';
    const town = document.getElementById('setProfileTown')?.value.trim() || '';
    const state = document.getElementById('setProfileState')?.value.trim() || '';
    const street = document.getElementById('setProfileStreet')?.value.trim() || '';

    userProfile = { ...userProfile, name, phone };
    saveUserProfile(userProfile);

    if (town || street || phone || state) {
      const address = `${street ? street + ', ' : ''}${town}${state ? ', ' + state : ''}`;
      userLocation = {
        ...(userLocation || {}),
        town: town || userLocation?.town || '',
        region: state || userLocation?.region || '',
        street: street || userLocation?.street || '',
        phone: phone || userLocation?.phone || '',
        address: address || userLocation?.address || ''
      };
      saveUserLocation(userLocation);
      updateLocationUI();
      refreshProductGrid();
    }

    if (currentUser && db && !isConfigPlaceholder) {
      try {
        await setDoc(doc(db, 'users', currentUser.uid), {
          uid: currentUser.uid,
          displayName: name || currentUser.displayName || '',
          phone,
          location: userLocation,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.warn('[Settings] Firestore profile sync:', err);
      }
    }
    showToast('✓ Profile & delivery address saved! Checkout will auto-fill.', 'success');
  });

  // Become an Authorized Seller: Sign in CTA
  document.getElementById('btnSettingsSellerSignIn')?.addEventListener('click', async () => {
    await signInWithGoogle();
    refreshSettingsSellerState();
  });

  // Become an Authorized Seller: GPS Capture
  document.getElementById('btnRegShopGps')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnRegShopGps');
    const disp = document.getElementById('regShopGpsStatus');
    if (btn) btn.textContent = '⏳ Detecting…';
    try {
      const pos = await getCurrentGpsPosition();
      regShopCoords = { lat: pos.lat, lng: pos.lng };
      const cityEl = document.getElementById('regShopCity');
      const stateEl = document.getElementById('regShopState');
      if (cityEl && !cityEl.value && pos.town) cityEl.value = pos.town;
      if (stateEl && !stateEl.value && pos.region) stateEl.value = pos.region;
      if (disp) {
        disp.textContent = `✓ GPS Set (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`;
        disp.style.color = 'var(--emerald-600)';
      }
    } catch (err) {
      showToast(err.message || 'GPS unavailable. You can still register manually.', 'warning');
    } finally {
      if (btn) btn.textContent = '🛰️ Capture Shop GPS';
    }
  });

  // Become an Authorized Seller: Form Submit
  document.getElementById('settingsBecomeSellerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) {
      showToast('Please sign in with Google first to become an Authorized Seller.', 'warning');
      return;
    }
    if (!db || isConfigPlaceholder) return;

    const name = document.getElementById('regShopName')?.value.trim();
    const rawHandle = document.getElementById('regShopHandle')?.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const city = document.getElementById('regShopCity')?.value.trim();
    const state = document.getElementById('regShopState')?.value.trim();
    const phone = document.getElementById('regShopPhone')?.value.trim().replace(/[^0-9]/g, '');
    const upiId = document.getElementById('regShopUpi')?.value.trim();
    const radius = parseFloat(document.getElementById('regShopRadius')?.value || '5') || 5;
    const category = document.getElementById('regShopCategory')?.value || 'Grocery';
    const agreed = document.getElementById('regShopAgree')?.checked;

    if (!name || !rawHandle || !city || !state) {
      showToast('Please fill Shop Name, Handle, Town/City, and State.', 'warning');
      return;
    }
    if (!phone || phone.length < 10) {
      showToast('Please enter a valid 10-digit phone/WhatsApp number.', 'warning');
      return;
    }
    if (!agreed) {
      showToast('Please accept the Seller Compliance & Terms Agreement.', 'warning');
      return;
    }

    const submitBtn = document.getElementById('btnSubmitAuthorizedSeller');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Registering Store…'; }

    try {
      const shopPayload = {
        ownerUid: currentUser.uid,
        sellerUid: currentUser.uid,
        ownerEmail: currentUser.email || '',
        name,
        handle: `@${rawHandle}`,
        city,
        town: city,
        state,
        phone,
        whatsapp: phone,
        upiId: upiId || '',
        category,
        deliveryRadiusKm: radius,
        perKmRate: 15,
        lat: regShopCoords?.lat ?? userLocation?.lat ?? null,
        lng: regShopCoords?.lng ?? userLocation?.lng ?? null,
        isAuthorizedSeller: true,
        agreementsAccepted: true,
        agreementsTimestamp: serverTimestamp(),
        isOpen: true,
        isVerified: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, 'shops', currentUser.uid), shopPayload, { merge: true });
      allShops.set(currentUser.uid, { id: currentUser.uid, ...shopPayload });
      showToast(`🎉 "${name}" is now registered as an Authorized Seller!`, 'success');
      refreshSettingsSellerState();
    } catch (err) {
      console.error('[Settings] Seller registration failed:', err);
      showToast('Registration failed: ' + (err.message || err.code), 'error');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✓ Register as Authorized Seller'; }
    }
  });

  // Order & Notification Preferences
  document.getElementById('btnSettingsEnablePush')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Notifications are not supported in this browser.', 'warning');
      return;
    }
    const perm = await Notification.requestPermission();
    showToast(perm === 'granted' ? '🔔 Push notifications enabled!' : 'Notification permission was not granted.', perm === 'granted' ? 'success' : 'info');
  });

  ['prefOrderNotifs', 'prefCartReminders', 'prefLocalDeals', 'prefAutoFillCheckout', 'prefDefaultPayment'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      const prefs = {
        orders: document.getElementById('prefOrderNotifs')?.checked ?? true,
        cart: document.getElementById('prefCartReminders')?.checked ?? true,
        deals: document.getElementById('prefLocalDeals')?.checked ?? true,
        autoFill: document.getElementById('prefAutoFillCheckout')?.checked ?? true,
        defaultPayment: document.getElementById('prefDefaultPayment')?.value || 'UPI'
      };
      try { localStorage.setItem('zulora_notif_prefs', JSON.stringify(prefs)); } catch (_) {}
      showToast('Preferences saved.', 'info');
    });
  });

  // Customer / Seller Feedback submission
  document.getElementById('settingsFeedbackForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rating = parseInt(document.getElementById('fbRating')?.value || '5', 10);
    const category = document.getElementById('fbCategory')?.value || 'Buyer Experience';
    const message = document.getElementById('fbMessage')?.value.trim();
    if (!message) return;

    if (db && !isConfigPlaceholder) {
      try {
        await addDoc(collection(db, 'feedback'), {
          uid: currentUser?.uid || 'guest',
          email: currentUser?.email || '',
          name: currentUser?.displayName || userProfile?.name || 'Zulora User',
          rating,
          category,
          message,
          createdAt: serverTimestamp()
        });
        document.getElementById('fbMessage').value = '';
        showToast('🙏 Thank you! Your feedback has been sent to Zulora AI.', 'success');
      } catch (err) {
        showToast('Could not submit feedback: ' + err.message, 'error');
      }
    } else {
      showToast('🙏 Thank you for your feedback!', 'success');
      document.getElementById('fbMessage').value = '';
    }
  });
}

function switchSettingsTab(tabName) {
  document.querySelectorAll('#settingsTabs .settings-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('#settingsModal .settings-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });
}

function refreshSettingsSellerState() {
  const gate = document.getElementById('settingsSellerGatePrompt');
  const activeBox = document.getElementById('settingsSellerActiveBox');
  const regForm = document.getElementById('settingsBecomeSellerForm');

  if (!currentUser) {
    gate?.classList.remove('hidden');
    activeBox?.classList.add('hidden');
    regForm?.classList.add('hidden');
    return;
  }

  gate?.classList.add('hidden');
  const shop = allShops.get(currentUser.uid) || Array.from(allShops.values()).find(s => s.ownerUid === currentUser.uid || s.sellerUid === currentUser.uid);
  const isAuthorized = Boolean(shop && (shop.isAuthorizedSeller || shop.agreementsAccepted || (shop.phone && shop.name)));

  if (isAuthorized) {
    activeBox?.classList.remove('hidden');
    regForm?.classList.add('hidden');
    const handleDisp = document.getElementById('settingsSellerHandleDisp');
    const summaryEl = document.getElementById('settingsSellerShopSummary');
    const verBadge = document.getElementById('settingsSellerVerifiedBadge');
    if (handleDisp) handleDisp.textContent = shop.handle || '';
    if (verBadge) verBadge.classList.toggle('hidden', !shop.isVerified);
    if (summaryEl) {
      summaryEl.textContent = `${shop.name} • ${shop.city || shop.town || 'Area set'} (${shop.deliveryRadiusKm || 5} km radius) • Phone: ${shop.phone || '—'}`;
    }
  } else {
    activeBox?.classList.add('hidden');
    regForm?.classList.remove('hidden');
    const cityEl = document.getElementById('regShopCity');
    const stateEl = document.getElementById('regShopState');
    const phoneEl = document.getElementById('regShopPhone');
    if (cityEl && !cityEl.value && userLocation?.town && userLocation.town !== 'All Locations') cityEl.value = userLocation.town;
    if (stateEl && !stateEl.value && userLocation?.region) stateEl.value = userLocation.region;
    if (phoneEl && !phoneEl.value) phoneEl.value = userProfile?.phone || userLocation?.phone || '';
  }
}

// ─── 3-Bar Left Menu Drawer Controls ──────────────────────────────────────────
function openMenuDrawer() {
  const drawer = document.getElementById('menuDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) {
    drawer.classList.remove('hidden');
    void drawer.offsetWidth;
    drawer.classList.add('open');
  }
  if (backdrop) backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeMenuDrawer() {
  const drawer = document.getElementById('menuDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
  setTimeout(() => drawer?.classList.add('hidden'), 280);
}

// ─── Modal Dialog Handlers ───────────────────────────────────────────────────
function openSignInModal() {
  document.getElementById('signInModal')?.classList.add('open');
}
function closeSignInModal() {
  document.getElementById('signInModal')?.classList.remove('open');
}

function openTermsModal() {
  document.getElementById('termsModal')?.classList.add('open');
}
function closeTermsModal() {
  document.getElementById('termsModal')?.classList.remove('open');
}
window.openTermsModal = openTermsModal;

function openPolicyModal() {
  document.getElementById('policyModal')?.classList.add('open');
}
function closePolicyModal() {
  document.getElementById('policyModal')?.classList.remove('open');
}
window.openPolicyModal = openPolicyModal;

function openSettingsModal(initialTab = 'profile') {
  const locDesc = document.getElementById('settingsLocationDesc');
  if (locDesc) {
    locDesc.textContent = (userLocation && userLocation.town && userLocation.town !== 'All Locations')
      ? `Current: ${userLocation.address || userLocation.town}`
      : 'Current: Not set yet (click Set / Detect GPS)';
  }

  // Pre-fill profile fields
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  setVal('setProfileName', userProfile?.name || currentUser?.displayName || '');
  setVal('setProfilePhone', userProfile?.phone || userLocation?.phone || '');
  setVal('setProfileTown', (userLocation?.town && userLocation.town !== 'All Locations') ? userLocation.town : '');
  setVal('setProfileState', userLocation?.region || '');
  setVal('setProfileStreet', userLocation?.street || '');

  try {
    const raw = localStorage.getItem('zulora_notif_prefs');
    const prefs = raw ? JSON.parse(raw) : { orders: true, cart: true, deals: true, autoFill: true, defaultPayment: 'UPI' };
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
    setChk('prefOrderNotifs', prefs.orders !== false);
    setChk('prefCartReminders', prefs.cart !== false);
    setChk('prefLocalDeals', prefs.deals !== false);
    setChk('prefAutoFillCheckout', prefs.autoFill !== false);
    const payEl = document.getElementById('prefDefaultPayment');
    if (payEl) payEl.value = prefs.defaultPayment || 'UPI';
  } catch (_) {}

  refreshSettingsSellerState();
  switchSettingsTab(initialTab);
  document.getElementById('settingsModal')?.classList.add('open');
}
window.openSettingsModal = openSettingsModal;

function closeSettingsModal() {
  document.getElementById('settingsModal')?.classList.remove('open');
}

function openAboutModal() {
  document.getElementById('aboutUsModal')?.classList.add('open');
}
function closeAboutModal() {
  document.getElementById('aboutUsModal')?.classList.remove('open');
}

// ─── Location & Auth Synchronization ──────────────────────────────────────────
function handleLocationSaved(newLoc) {
  userLocation = newLoc;
  if (newLoc?.phone) {
    userProfile = { ...userProfile, phone: newLoc.phone };
    saveUserProfile(userProfile);
  }
  updateLocationUI();
  refreshProductGrid();
}

function updateLocationUI() {
  const el = document.getElementById('locationTownText');
  const topEl = document.getElementById('topLocationText');
  const banner = document.getElementById('locationBanner');

  const hasLoc = Boolean(userLocation && ((userLocation.town && userLocation.town !== 'All Locations') || userLocation.lat != null));
  const displayText = hasLoc
    ? (userLocation.town && userLocation.town !== 'All Locations'
        ? (userLocation.region ? `${userLocation.town}, ${userLocation.region}` : userLocation.town)
        : `${userLocation.lat.toFixed(3)}, ${userLocation.lng.toFixed(3)}`)
    : 'Set Area';

  if (topEl) topEl.textContent = displayText;
  if (el) {
    el.textContent = hasLoc
      ? (userLocation.street ? `${userLocation.street}, ${displayText}` : displayText)
      : 'Set your City / Town / Village to see km distance & nearby stores';
  }
  if (banner) {
    banner.classList.toggle('needs-location', !hasLoc);
  }
}

async function handleSignInAction() {
  const user = await signInWithGoogle();
  if (user && pendingCheckoutAfterAuth) {
    pendingCheckoutAfterAuth = false;
    openCheckoutModal();
    return;
  }
  // If signed-in user hasn't set location yet, invite them cleanly
  if (user && (!userLocation || (!userLocation.town && userLocation.lat == null))) {
    setTimeout(() => {
      if (!userLocation || (!userLocation.town && userLocation.lat == null)) {
        triggerLocationModal();
      }
    }, 600);
  }
}

async function handleSignOutAction() {
  const step1 = confirm('Are you sure you want to sign out of Zulora Local?');
  if (!step1) return;
  const step2 = confirm('Final confirmation: Sign out now? Your cart items will be saved locally.');
  if (!step2) return;
  await signOutUser();
}

async function handleUserAuthChange(user) {
  currentUser = user;
  updateAuthUI(user);

  if (user && db && !isConfigPlaceholder) {
    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        const data = snap.data();
        if (data.displayName || data.phone) {
          userProfile = {
            ...userProfile,
            name: data.displayName || userProfile?.name || user.displayName || '',
            phone: data.phone || userProfile?.phone || ''
          };
          saveUserProfile(userProfile);
        }
        if (data.location && (data.location.town || data.location.lat != null)) {
          userLocation = data.location;
          saveUserLocation(userLocation);
          updateLocationUI();
          refreshProductGrid();
        }
      }
    } catch (e) {
      console.warn('[Firestore] User profile check:', e);
    }
  }
}

function openAccountModal() {
  document.getElementById('userAccountModal')?.classList.add('open');
}

function closeAccountModal() {
  document.getElementById('userAccountModal')?.classList.remove('open');
}

function updateAuthUI(user) {
  const authBtn = document.getElementById('authBtn');
  const userMenu = document.getElementById('userMenu');
  const navAdmin = document.getElementById('navAdminLink');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');

  const modalAccountAvatar = document.getElementById('modalAccountAvatar');
  const modalAccountName = document.getElementById('modalAccountName');
  const modalAccountEmail = document.getElementById('modalAccountEmail');

  const drawerUserAvatar = document.getElementById('drawerUserAvatar');
  const drawerUserName = document.getElementById('drawerUserName');
  const drawerUserEmail = document.getElementById('drawerUserEmail');
  const drawerAdminLink = document.getElementById('drawerAdminLink');

  if (user) {
    authBtn?.classList.add('hidden');
    userMenu?.classList.remove('hidden');
    if (userAvatar) userAvatar.src = user.photoURL || PLATFORM_CONSTANTS.BRAND_LOGO_URL;
    if (userName) userName.textContent = user.displayName ? user.displayName.split(' ')[0] : 'Account';

    if (modalAccountAvatar) modalAccountAvatar.src = user.photoURL || PLATFORM_CONSTANTS.BRAND_LOGO_URL;
    if (modalAccountName) modalAccountName.textContent = user.displayName || 'Shopper Account';
    if (modalAccountEmail) modalAccountEmail.textContent = user.email || '';

    if (drawerUserAvatar) drawerUserAvatar.src = user.photoURL || PLATFORM_CONSTANTS.BRAND_LOGO_URL;
    if (drawerUserName) drawerUserName.textContent = user.displayName || 'Signed-In Shopper';
    if (drawerUserEmail) drawerUserEmail.textContent = user.email || 'Google Account Active';

    const isSupremeAdmin = user.email?.toLowerCase() === PLATFORM_CONSTANTS.SUPREME_ADMIN_EMAIL.toLowerCase();
    if (navAdmin) navAdmin.classList.toggle('hidden', !isSupremeAdmin);
    if (drawerAdminLink) drawerAdminLink.classList.toggle('hidden', !isSupremeAdmin);
  } else {
    authBtn?.classList.remove('hidden');
    userMenu?.classList.add('hidden');
    closeAccountModal();
    if (navAdmin) navAdmin.classList.add('hidden');

    if (modalAccountAvatar) modalAccountAvatar.src = PLATFORM_CONSTANTS.BRAND_LOGO_URL;
    if (modalAccountName) modalAccountName.textContent = 'Shopper Account';
    if (modalAccountEmail) modalAccountEmail.textContent = '';

    if (drawerUserAvatar) drawerUserAvatar.src = PLATFORM_CONSTANTS.BRAND_LOGO_URL;
    if (drawerUserName) drawerUserName.textContent = 'Welcome, Shopper!';
    if (drawerUserEmail) drawerUserEmail.textContent = 'Sign in to track orders & save address';
    if (drawerAdminLink) drawerAdminLink.classList.add('hidden');
  }
}

// ─── Real Firestore Products Load (Live onSnapshot Sync) ─────────────────────
let unsubShops = null;
let unsubProducts = null;

function loadPlatformData() {
  const grid = document.getElementById('productGrid');
  showLoadingSkeleton(grid, 4);

  if (!db || isConfigPlaceholder) {
    allProducts = [];
    allShops.clear();
    loadCartFromStorage(allProducts);
    updateCartUI();
    refreshProductGrid();
    return;
  }

  if (unsubShops) unsubShops();
  try {
    unsubShops = onSnapshot(collection(db, 'shops'), snapshot => {
      allShops.clear();
      snapshot.forEach(d => {
        allShops.set(d.id, { id: d.id, ...d.data() });
      });
      refreshProductGrid();
    }, err => {
      console.warn('[Firestore] Shops live listener notice:', err);
    });
  } catch (err) {
    console.warn('[Firestore] Shops listener setup:', err);
  }

  if (unsubProducts) unsubProducts();
  try {
    unsubProducts = onSnapshot(collection(db, 'products'), snapshot => {
      const rawProds = [];
      snapshot.forEach(d => {
        const p = { id: d.id, ...d.data() };
        if (p.title && (p.price != null)) {
          rawProds.push(p);
        }
      });

      rawProds.sort((a, b) => {
        const tA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : (a.createdAtIso ? new Date(a.createdAtIso).getTime() : 0);
        const tB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : (b.createdAtIso ? new Date(b.createdAtIso).getTime() : 0);
        return tB - tA;
      });

      allProducts = rawProds;
      loadCartFromStorage(allProducts);
      updateCartUI();
      refreshProductGrid();
    }, err => {
      console.warn('[Firestore] Products live listener notice:', err);
    });
  } catch (err) {
    console.warn('[Firestore] Products listener setup:', err);
  }
}

function resetAllFilters() {
  searchQuery = '';
  selectedCategory = 'All';
  nearbyFilterActive = false;
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  document.querySelectorAll('.category-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.category === 'All');
  });
  document.getElementById('filterAllBtn')?.classList.add('active');
  document.getElementById('filterNearbyBtn')?.classList.remove('active');
  refreshProductGrid();
}

function refreshProductGrid() {
  const grid = document.getElementById('productGrid');
  const countEl = document.getElementById('productCount');
  renderStorefrontProducts({
    container: grid,
    countElement: countEl,
    products: allProducts,
    allShops,
    userLocation,
    cart: getCart(),
    selectedCategory,
    searchQuery,
    nearbyFilterActive,
    onResetFilters: resetAllFilters
  });
}

// ─── Fast In-Card Stepper & Cart Integration ──────────────────────────────────
window.handleCartAdd = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  cartAdd(product);
  updateCartUI();
  const cart = getCart();
  const qty = cart[productId]?.qty || 0;
  updateCardStepperDOM(productId, qty, product);
};

window.handleCartChange = function(productId, delta) {
  const product = allProducts.find(p => p.id === productId);
  cartChangeQty(productId, delta);
  updateCartUI();
  const cart = getCart();
  const qty = cart[productId]?.qty || 0;
  updateCardStepperDOM(productId, qty, product);
};

function updateCartUI() {
  const { totalCount, totalPrice } = getCartTotals();
  const bar = document.getElementById('floatingCartBar');
  const countEl = document.getElementById('floatingCartCount');
  const totalEl = document.getElementById('floatingCartTotal');
  const navCountEl = document.getElementById('navCartCount');

  if (bar) bar.classList.toggle('hidden', totalCount === 0);
  if (countEl) countEl.textContent = totalCount;
  if (totalEl) totalEl.textContent = totalPrice.toFixed(2);
  if (navCountEl) {
    navCountEl.textContent = totalCount;
    navCountEl.style.display = totalCount > 0 ? 'inline-block' : 'none';
  }
}

// ─── Product Detail Modal Opening ─────────────────────────────────────────────
window.openProductDetailModal = function(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  const shop = allShops.get(product.shopId) || {};
  const cart = getCart();
  const cartQty = cart[productId]?.qty || 0;

  openProductDetailModal({
    product,
    shop,
    userLocation,
    cartQty,
    onAddToCart: (pId) => window.handleCartAdd(pId),
    onCartChange: (pId, delta) => window.handleCartChange(pId, delta)
  });
};

// ─── Cart Drawer Controls & Multi-Shop Breakdown ──────────────────────────────
function openCart() {
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';
  renderCartDrawerContent();
}

function closeCart() {
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
}

function renderCartDrawerContent() {
  const body = document.getElementById('cartDrawerBody');
  const footer = document.getElementById('cartDrawerFooter');
  if (!body || !footer) return;

  const groups = groupCartByShop(allShops, userLocation);
  const groupList = Object.entries(groups);

  if (groupList.length === 0) {
    body.innerHTML = `
      <div style="text-align:center;padding:3.5rem 1rem;">
        <div style="font-size:3rem;margin-bottom:0.75rem;">🛒</div>
        <p style="color:var(--slate-800);font-weight:800;font-size:1.1rem;margin-bottom:0.25rem;">Your cart is empty</p>
        <p style="color:var(--slate-500);font-size:0.85rem;">Discover neighbourhood items and start your order!</p>
      </div>
    `;
    footer.innerHTML = '';
    return;
  }

  let totalGrand = 0;
  let hasAnyShortfall = false;

  const shopSections = groupList.map(([shopId, group]) => {
    totalGrand += group.grandTotal;
    if (group.isBelowMinOrder) hasAnyShortfall = true;

    const shopCity = group.shop.city || group.shop.town || '';
    const distBadgeText = group.distKm != null
      ? `📍 ${group.distKm.toFixed(1)} km away`
      : (shopCity ? `📍 ${escapeHtml(shopCity)}` : '📍 Set GPS for km');

    const rows = group.items.map(item => {
      const coverImg = Array.isArray(item.product.images) && item.product.images.length > 0
        ? item.product.images[0]
        : (item.product.imageUrl || 'https://via.placeholder.com/100x100?text=Item');
      return `
        <div class="shop-cart-item">
          <img src="${escapeHtml(coverImg)}" alt="${escapeHtml(item.product.title)}" class="shop-cart-item-img" />
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.84rem;font-weight:700;color:var(--slate-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(item.product.title)}
            </div>
            ${item.product.unit ? `<div style="font-size:0.72rem;color:var(--slate-400);">${escapeHtml(item.product.unit)}</div>` : ''}
            <div style="font-size:0.82rem;font-weight:700;color:var(--slate-900);margin-top:0.15rem;">
              ₹${item.product.price} × ${item.qty} = ₹${(item.product.price * item.qty).toFixed(2)}
            </div>
          </div>
          <div class="qty-pill">
            <button class="qty-btn" onclick="window.handleCartChange('${escapeHtml(item.product.id)}', -1); window.renderCartDrawerContent();">−</button>
            <span class="qty-count">${item.qty}</span>
            <button class="qty-btn" onclick="window.handleCartChange('${escapeHtml(item.product.id)}', 1); window.renderCartDrawerContent();">+</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="shop-cart-card">
        <div class="shop-cart-header">
          <div>
            <strong style="font-size:0.88rem;color:var(--slate-900);">${escapeHtml(group.shop.name || 'Neighbourhood Seller')}</strong>
            <span style="display:block;font-size:0.7rem;color:var(--slate-400);">Self-Delivery by merchant</span>
          </div>
          <span style="font-size:0.74rem;font-weight:700;color:var(--azure-700);background:var(--azure-50);padding:0.2rem 0.5rem;border-radius:var(--radius-sm);">
            ${distBadgeText}
          </span>
        </div>

        ${rows}

        <div class="shop-bill-breakdown">
          <div class="shop-bill-row">
            <span>Items Subtotal</span>
            <span>₹${group.shopTotal.toFixed(2)}</span>
          </div>
          <div class="shop-bill-row">
            <span>Distance Fee (${group.distKm ? group.distKm.toFixed(1) : 1} km @ ₹${group.perKmRate || 15}/km)</span>
            <span>₹${(group.baseFee || 15).toFixed(2)}</span>
          </div>
          <div class="shop-bill-row">
            <span>Weight Surcharge (${(group.totalWeightKg || 0).toFixed(1)} kg, first 2 kg free)</span>
            <span>${group.weightFee > 0 ? `₹${group.weightFee.toFixed(2)}` : '<strong style="color:var(--emerald-600);">FREE</strong>'}</span>
          </div>
          <div class="shop-bill-total">
            <span>Store Total</span>
            <strong style="color:var(--azure-800);">₹${group.grandTotal.toFixed(2)}</strong>
          </div>
        </div>

        ${group.isBelowMinOrder ? `
          <div class="shortfall-alert">
            <span>⚠️</span>
            <span>Minimum order for this store is <strong>₹${group.minOrder}</strong>. Please add items worth <strong>₹${group.shortfall.toFixed(2)}</strong> more.</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  body.innerHTML = shopSections;
  footer.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;font-size:1.05rem;">
      <span style="font-weight:700;">Grand Total:</span>
      <strong style="color:var(--azure-800);font-size:1.25rem;">₹${totalGrand.toFixed(2)}</strong>
    </div>
    ${hasAnyShortfall ? `
      <div style="background:#fef2f2;border:1px solid #fee2e2;border-radius:var(--radius-md);padding:0.5rem;font-size:0.75rem;color:#b91c1c;margin-bottom:0.6rem;text-align:center;">
        ⚠️ One or more stores do not meet the ₹50 minimum order threshold.
      </div>
    ` : ''}
    <button class="btn btn-success btn-block" onclick="window.handleCheckoutClick()" ${hasAnyShortfall ? 'disabled style="opacity:0.6;cursor:not-allowed;"' : ''} style="padding:0.75rem;font-size:0.95rem;font-weight:800;border-radius:var(--radius-full);">
      Proceed to Checkout →
    </button>
  `;
}
window.renderCartDrawerContent = renderCartDrawerContent;

// ─── STRICT GOOGLE AUTH GATE FOR ORDERS ───────────────────────────────────────
window.handleCheckoutClick = function() {
  if (!currentUser) {
    pendingCheckoutAfterAuth = true;
    showToast('Please sign in with Google to place your order.', 'info');
    openSignInModal();
    return;
  }
  // Location gate: buyer must have at minimum a city/town or GPS before checkout
  const hasLoc = userLocation && (
    (userLocation.town && userLocation.town !== 'All Locations') ||
    userLocation.lat != null
  );
  if (!hasLoc) {
    showToast('📍 Please set your City / Town or GPS location first so the seller can deliver to you.', 'warning');
    triggerLocationModal();
    return;
  }
  openCheckoutModal();
};

// ─── Checkout & Order Placement (Auto-Fill + Dynamic UPI QR) ──────────────────
window.openCheckoutModal = function() {
  if (!currentUser) {
    pendingCheckoutAfterAuth = true;
    openSignInModal();
    return;
  }

  document.getElementById('checkoutModal')?.remove();

  const groups = groupCartByShop(allShops, userLocation);
  const anyBelow = Object.values(groups).find(g => g.isBelowMinOrder);
  if (anyBelow) {
    showToast(`Order from "${anyBelow.shop.name || 'Store'}" is below the ₹50 minimum order value. Please add ₹${anyBelow.shortfall.toFixed(2)} more.`, 'warning');
    return;
  }

  const grandTotal = Object.values(groups).reduce((sum, g) => sum + g.grandTotal, 0);

  let savedPrefs = { autoFill: true, defaultPayment: 'UPI' };
  try {
    const raw = localStorage.getItem('zulora_notif_prefs');
    if (raw) savedPrefs = { ...savedPrefs, ...JSON.parse(raw) };
  } catch (_) {}

  const autoFill = savedPrefs.autoFill !== false;
  const defaultPayment = savedPrefs.defaultPayment || 'UPI';

  const preName = autoFill ? (userProfile?.name || currentUser?.displayName || '') : '';
  const prePhone = autoFill ? (userProfile?.phone || userLocation?.phone || currentUser?.phoneNumber || '') : '';
  const preCity = autoFill ? ((userLocation?.town && userLocation.town !== 'All Locations') ? userLocation.town : '') : '';
  const preState = autoFill ? (userLocation?.region || userLocation?.state || '') : '';
  const preStreet = autoFill ? (userLocation?.street || '') : '';

  const qrSections = Object.entries(groups).map(([shopId, group]) => {
    const shop = group.shop;
    const shopTotal = group.grandTotal;
    const upiId = (shop.upiId || '').trim();
    const hasCustomQr = Boolean(shop.upiQrImageUrl);
    const cleanPhone = (shop.phone || '').replace(/[^0-9]/g, '');
    const callUrl = cleanPhone ? `tel:+91${cleanPhone}` : '';
    const shopCity = shop.city || shop.town || '';

    const upiUri = upiId ? buildUpiUri({ upiId, shopName: shop.name || 'Zulora Seller', amount: shopTotal }) : '';
    const dynamicQrSvg = upiUri ? renderQrSvgHtml(upiUri, 152, `UPI QR for ${shop.name}`) : '';

    return `
      <div class="checkout-upi-box" style="margin-bottom:0.75rem;padding:0.9rem;background:#f8fafc;border:1px solid var(--border-subtle);border-radius:var(--radius-md);text-align:left;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.45rem;">
          <div>
            <div style="font-size:0.92rem;font-weight:800;color:var(--slate-900);display:flex;align-items:center;gap:0.3rem;">
              🏪 ${escapeHtml(shop.name || 'Neighbourhood Seller')}
              ${shop.isVerified ? `<img src="${PLATFORM_CONSTANTS.VERIFIED_BADGE_URL}" alt="✓" class="verified-badge-sm" />` : ''}
            </div>
            <div style="font-size:0.75rem;color:var(--slate-600);margin-top:0.15rem;">
              📞 Contact: ${callUrl ? `<a href="${callUrl}" style="color:var(--azure-700);font-weight:700;">+91 ${escapeHtml(cleanPhone)}</a>` : '<span style="color:var(--slate-400);">Shared upon confirmation</span>'}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.15rem;font-weight:900;color:var(--emerald-600);">₹${shopTotal.toFixed(2)}</div>
            <div style="font-size:0.72rem;color:var(--slate-400);">${group.items.length} item${group.items.length > 1 ? 's' : ''}</div>
          </div>
        </div>

        <div style="font-size:0.75rem;background:#ffffff;border:1px dashed var(--slate-200);padding:0.45rem 0.6rem;border-radius:var(--radius-sm);margin-bottom:0.65rem;color:var(--slate-600);">
          📍 <strong>${group.distKm != null ? `${group.distKm} km away` : (shopCity ? escapeHtml(shopCity) : 'Set GPS for km')}</strong> (₹${group.perKmRate || 15}/km delivery) • Min Order: ₹50<br/>
          Fee: ₹${group.baseFee || 15} base + ₹${group.weightFee || 0} weight surcharge (${group.totalWeightKg.toFixed(1)} kg) • Merchant Self-Delivery
        </div>

        ${(dynamicQrSvg || hasCustomQr) ? `
          <div style="background:#ffffff;border:1px solid var(--azure-200);border-radius:var(--radius-md);padding:0.75rem;text-align:center;">
            <div style="font-size:0.74rem;font-weight:800;color:var(--azure-800);margin-bottom:0.45rem;">
              Scan &amp; Pay ₹${shopTotal.toFixed(2)} Directly to Seller
            </div>
            <div style="display:flex;justify-content:center;align-items:center;gap:0.75rem;flex-wrap:wrap;">
              ${dynamicQrSvg ? `
                <div>
                  ${dynamicQrSvg}
                  <div style="font-size:0.68rem;color:var(--emerald-700);font-weight:700;margin-top:0.25rem;">⚡ Dynamic Amount UPI QR</div>
                </div>
              ` : ''}
              ${hasCustomQr ? `
                <div>
                  <img src="${escapeHtml(shop.upiQrImageUrl)}" alt="Merchant QR Code" style="width:152px;height:152px;object-fit:contain;border-radius:10px;border:1px solid var(--border-subtle);padding:4px;background:#fff;" />
                  <div style="font-size:0.68rem;color:var(--slate-500);font-weight:700;margin-top:0.25rem;">Merchant Uploaded QR</div>
                </div>
              ` : ''}
            </div>
            ${upiId ? `
              <div style="margin-top:0.55rem;display:flex;align-items:center;justify-content:center;gap:0.45rem;flex-wrap:wrap;">
                <div class="checkout-upi-id-pill">
                  <span class="checkout-upi-id-text">${escapeHtml(upiId)}</span>
                  <button type="button" onclick="navigator.clipboard.writeText('${escapeHtml(upiId)}').then(()=>{ window.showToast?.('✓ UPI ID copied!', 'success'); })" style="background:none;border:none;cursor:pointer;font-size:0.85rem;" title="Copy UPI ID">📋</button>
                </div>
                <a href="${escapeHtml(upiUri)}" class="btn btn-primary btn-sm" style="border-radius:var(--radius-full);">📲 Open UPI App</a>
              </div>
            ` : ''}
          </div>
        ` : `
          <div style="font-size:0.76rem;color:var(--slate-500);text-align:center;padding:0.35rem;">
            Merchant accepts Cash on Delivery &amp; in-person UPI upon arrival.
          </div>
        `}
      </div>
    `;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'checkoutModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box checkout-modal-box" role="dialog" aria-modal="true" aria-label="Complete Order" style="max-width:560px;">
      <div class="modal-header">
        <h3 style="font-size:1.1rem;font-weight:800;">🛍️ Complete Your Order</h3>
        <button class="btn btn-icon" onclick="document.getElementById('checkoutModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:1.15rem 1.25rem;">
        <div style="font-size:0.74rem;color:var(--emerald-700);background:var(--emerald-50);border:1px solid var(--emerald-200);border-radius:var(--radius-sm);padding:0.45rem 0.65rem;margin-bottom:0.85rem;">
          ⚡ Pre-filled from your saved profile &amp; location. Review or edit below before placing your order.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.65rem;margin-bottom:0.65rem;">
          <div>
            <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:0.2rem;">Full Name *</label>
            <input id="coName" type="text" class="form-input" placeholder="Your name" value="${escapeHtml(preName)}" />
          </div>
          <div>
            <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:0.2rem;">Mobile Phone *</label>
            <input id="coPhone" type="tel" class="form-input" placeholder="10-digit mobile" value="${escapeHtml(prePhone)}" />
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.65rem;margin-bottom:0.65rem;">
          <div>
            <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:0.2rem;">City / Town / Village *</label>
            <input id="coCityTown" type="text" class="form-input" placeholder="e.g. Haldwani" value="${escapeHtml(preCity)}" />
          </div>
          <div>
            <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:0.2rem;">State / Region</label>
            <input id="coState" type="text" class="form-input" placeholder="e.g. Uttarakhand" value="${escapeHtml(preState)}" />
          </div>
        </div>

        <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:0.2rem;">Delivery Address / House No. / Landmark *</label>
        <textarea id="coAddress" rows="2" class="form-input" placeholder="House no, street name, nearest landmark" style="margin-bottom:0.75rem;">${escapeHtml(preStreet)}</textarea>

        <label style="font-size:0.78rem;font-weight:700;display:block;margin-bottom:0.3rem;">Payment Option *</label>
        <div style="display:flex;gap:1.5rem;margin-bottom:0.85rem;">
          <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem;cursor:pointer;font-weight:700;">
            <input type="radio" name="coPayment" value="UPI" ${defaultPayment === 'UPI' ? 'checked' : ''} /> 💳 Direct UPI (Instant QR)
          </label>
          <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem;cursor:pointer;font-weight:700;">
            <input type="radio" name="coPayment" value="COD" ${defaultPayment === 'COD' ? 'checked' : ''} /> 💵 Cash on Delivery
          </label>
        </div>

        <div id="upiQrSection" style="margin-bottom:0.85rem;${defaultPayment === 'COD' ? 'display:none;' : ''}">
          ${qrSections}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.7rem 0.9rem;background:var(--azure-50);border:1px solid var(--azure-200);border-radius:var(--radius-md);margin-bottom:0.65rem;">
          <span style="font-size:0.86rem;color:var(--azure-900);font-weight:800;">Total Payable Amount:</span>
          <strong style="font-size:1.2rem;color:var(--azure-800);">₹${grandTotal.toFixed(2)}</strong>
        </div>

        <p style="font-size:0.73rem;color:var(--slate-500);text-align:center;margin:0;line-height:1.45;">
          By placing an order, you agree to the <a href="#" onclick="window.openPolicyModal();return false;" style="color:var(--azure-700);text-decoration:underline;font-weight:700;">Zulora Local Policy</a> and <a href="#" onclick="window.openTermsModal();return false;" style="color:var(--azure-700);text-decoration:underline;font-weight:700;">Terms &amp; Conditions</a>.
        </p>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;">
        <button class="btn btn-ghost" onclick="document.getElementById('checkoutModal').remove()">Cancel</button>
        <button class="btn btn-success" onclick="window.executeOrderPlacement()" style="font-weight:800;padding:0.55rem 1.25rem;">Place Order ✓</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('input[name="coPayment"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const upiSec = document.getElementById('upiQrSection');
      if (upiSec) upiSec.style.display = radio.value === 'UPI' ? 'block' : 'none';
    });
  });
};

window.executeOrderPlacement = async function() {
  if (!currentUser) {
    showToast('Please sign in with Google to place an order.', 'warning');
    openSignInModal();
    return;
  }

  const name = document.getElementById('coName')?.value.trim();
  const phone = document.getElementById('coPhone')?.value.trim();
  const address = document.getElementById('coAddress')?.value.trim();
  const cityTown = document.getElementById('coCityTown')?.value.trim();
  const state = document.getElementById('coState')?.value.trim();
  const paymentEl = document.querySelector('input[name="coPayment"]:checked');
  const payment = paymentEl?.value || 'COD';

  if (!name) { showToast('Please enter your name.', 'warning'); return; }
  if (!phone || phone.length < 7) { showToast('Please enter a valid phone number.', 'warning'); return; }
  if (!cityTown) { showToast('Please enter your City / Town / Village name.', 'warning'); return; }
  if (!address) { showToast('Please enter your delivery street or landmark address.', 'warning'); return; }

  // Persist buyer profile & address for seamless future auto-fill
  userProfile = { ...userProfile, name, phone };
  saveUserProfile(userProfile);
  userLocation = {
    ...(userLocation || {}),
    town: cityTown,
    region: state || userLocation?.region || '',
    street: address,
    phone,
    address: `${address}, ${cityTown}${state ? ', ' + state : ''}`
  };
  saveUserLocation(userLocation);
  updateLocationUI();

  if (db && !isConfigPlaceholder) {
    setDoc(doc(db, 'users', currentUser.uid), {
      uid: currentUser.uid,
      displayName: name,
      phone,
      location: userLocation,
      updatedAt: serverTimestamp()
    }, { merge: true }).catch(() => {});
  }

  const fullDeliveryAddress = `${address}, ${cityTown}${state ? ', ' + state : ''}`;

  const groups = groupCartByShop(allShops, userLocation);
  const anyBelow = Object.values(groups).find(g => g.isBelowMinOrder);
  if (anyBelow) {
    showToast(`Order from "${anyBelow.shop.name || 'Store'}" is below the ₹50 minimum order value.`, 'warning');
    return;
  }

  const orderIds = [];

  for (const [shopId, group] of Object.entries(groups)) {
    const shop = group.shop;
    const shopTotal = group.grandTotal;

    const generatedOrderCode = 'ZUL-' + Math.floor(100000 + Math.random() * 900000);
    const orderData = {
      orderCode: generatedOrderCode,
      orderId: generatedOrderCode,
      buyerName: name,
      buyerPhone: phone,
      buyerAddress: fullDeliveryAddress,
      buyerUid: currentUser?.uid || 'guest',
      buyerEmail: currentUser?.email || '',
      buyerCityTown: cityTown,
      buyerState: state || userLocation?.region || '',
      buyerCoords: (userLocation?.lat != null && userLocation?.lng != null)
        ? { lat: userLocation.lat, lng: userLocation.lng }
        : null,
      sellerUid: group.shop.sellerUid || group.shop.ownerUid || group.shop.ownerId || group.items[0]?.product?.sellerUid || group.items[0]?.product?.ownerUid || shopId,
      shopId,
      shopName: group.shop.name || 'Neighbourhood Seller',
      shopPhone: group.shop.phone || group.items[0]?.product?.sellerPhone || '',
      shopEmail: group.shop.ownerEmail || group.shop.email || '',
      shopUpiId: group.shop.upiId || '',
      shopQrUrl: group.shop.upiQrImageUrl || '',
      sellerPhone: group.shop.phone || group.items[0]?.product?.sellerPhone || '',
      sellerEmail: group.shop.ownerEmail || group.shop.email || '',
      items: group.items.map(i => ({
        productId: i.product.id,
        title: i.product.title,
        qty: i.qty,
        quantity: i.qty,
        price: i.product.price,
        unit: i.product.unit || '',
        weightKg: i.product.weightKg || i.product.weight || 0.5
      })),
      subtotal: group.shopTotal,
      itemsSubtotal: group.shopTotal,
      distanceKm: group.distKm != null ? group.distKm : null,
      distKm: group.distKm != null ? group.distKm : null,
      perKmRate: group.perKmRate || group.shop.perKmRate || 15,
      deliveryCharge: group.deliveryFee != null ? group.deliveryFee : 15,
      baseDeliveryFee: group.baseFee != null ? group.baseFee : 15,
      extraWeightCharge: group.weightFee || 0,
      weightFee: group.weightFee || 0,
      totalWeightKg: group.totalWeightKg,
      totalAmount: shopTotal,
      grandTotal: shopTotal,
      paymentMethod: payment,
      paymentMode: payment,
      status: 'placed',
      orderStatus: 'Placed',
      buyerDeliveredConfirmed: false,
      deliveryModel: 'Self-Delivery (Merchant)',
      cancelableUntil: Date.now() + 5 * 60 * 1000,
      createdAt: serverTimestamp(),
      createdAtIso: new Date().toISOString(),
      updatedAt: serverTimestamp()
    };

    let docId = 'ORD-' + Date.now();
    if (db && !isConfigPlaceholder) {
      try {
        const ref = await addDoc(collection(db, 'orders'), orderData);
        docId = ref.id;

        // Write a notifications doc so the seller's onSnapshot fires immediately
        try {
          await addDoc(collection(db, 'notifications'), {
            type: 'new_order',
            orderId: orderData.orderId,
            orderDocId: docId,
            orderCode: orderData.orderCode,
            shopId,
            sellerUid: orderData.sellerUid,
            buyerName: name,
            buyerPhone: phone,
            totalAmount: shopTotal,
            read: false,
            createdAt: serverTimestamp()
          });
        } catch (notifErr) {
          console.warn('[Firestore] Notification write:', notifErr);
        }

        for (const item of group.items) {
          try {
            const pRef = doc(db, 'products', item.product.id);
            await updateDoc(pRef, {
              stock: increment(-item.qty),
              salesCount: increment(item.qty)
            });
          } catch (e) {}
        }
      } catch (err) {
        console.warn('[Firestore] Order placement save error:', err);
      }
    }

    orderIds.push({ orderId: orderData.orderId, docId, shop, orderData });
    notifyOrderStatus(orderData.orderId, 'Placed');
  }

  clearCart();
  updateCartUI();

  document.getElementById('checkoutModal')?.remove();
  closeCart();
  refreshProductGrid();
  showOrderSuccessModal(orderIds, { name, phone, address: fullDeliveryAddress, payment });
};

function showOrderSuccessModal(orderIds, buyer) {
  document.getElementById('orderSuccessModal')?.remove();

  const waLinks = orderIds.map(({ orderId, shop, orderData }) => {
    const waNum = (shop.whatsapp || shop.phone || orderData.sellerPhone || PLATFORM_CONSTANTS.HELPLINE_WHATSAPP).replace(/[^0-9]/g, '');
    const cleanNum = waNum.startsWith('91') ? waNum : '91' + waNum;
    const msg = encodeURIComponent(
      `🛒 *New Order on Zulora Local (#${orderId})*\n\n` +
      `👤 *Buyer:* ${buyer.name} (${buyer.phone})\n` +
      `📍 *Address:* ${buyer.address}\n` +
      `💵 *Payment:* ${buyer.payment}\n` +
      `💰 *Total:* ₹${orderData.totalAmount}\n\n` +
      `📦 *Items:*\n` +
      orderData.items.map(i => `• ${i.title} (${i.unit}) x ${i.qty} - ₹${i.price * i.qty}`).join('\n')
    );
    return `<a href="https://wa.me/${cleanNum}?text=${msg}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp" style="padding:0.6rem 1rem;font-weight:700;">
      💬 WhatsApp ${escapeHtml(shop.name || 'Seller')}
    </a>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = 'orderSuccessModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Order Placed">
      <div class="modal-header" style="background:var(--emerald-50);">
        <h3 style="color:var(--emerald-700);font-size:1.1rem;font-weight:800;">🎉 Order Placed Successfully!</h3>
        <button class="btn btn-icon" onclick="document.getElementById('orderSuccessModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="text-align:center;padding:1.5rem 1rem;">
        <div style="font-size:3.5rem;margin-bottom:0.75rem;">✅</div>
        <p style="font-size:0.95rem;color:var(--slate-800);margin-bottom:0.4rem;">
          Thank you, <strong>${escapeHtml(buyer.name)}</strong>!
        </p>
        <p style="font-size:0.82rem;color:var(--slate-500);margin-bottom:1.25rem;">
          Your order has been transmitted directly to the merchant.
        </p>
        <div style="display:flex;flex-direction:column;gap:0.55rem;">
          ${waLinks}
          <a href="./orders.html" class="btn btn-primary" style="padding:0.65rem 1rem;font-weight:800;">
            📦 Track My Orders
          </a>
          <a href="tel:${PLATFORM_CONSTANTS.HELPLINE_PHONE}" class="btn btn-ghost" style="font-size:0.8rem;">
            📞 Support: ${PLATFORM_CONSTANTS.HELPLINE_PHONE_DISPLAY}
          </a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ─── Notification Drawer Controls ─────────────────────────────────────────────
function openNotifDrawer() {
  document.getElementById('notifDrawer')?.classList.remove('hidden');
  document.getElementById('drawerBackdrop')?.classList.add('active');
  renderNotificationDrawer();
  document.body.style.overflow = 'hidden';
}

function closeNotifDrawer() {
  document.getElementById('notifDrawer')?.classList.add('hidden');
  document.getElementById('drawerBackdrop')?.classList.remove('active');
  document.body.style.overflow = '';
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
