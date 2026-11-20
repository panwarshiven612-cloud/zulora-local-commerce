/**
 * Zulora Local — Exact Platform Configuration v2
 * Configured with live Firebase + Cloudinary production keys.
 */

export const firebaseConfig = {
  apiKey: "AIzaSyCrU7qYFzRntPW1wBP1aKw2l4FYwTeUl68",
  authDomain: "zulora-local-commerce.firebaseapp.com",
  projectId: "zulora-local-commerce",
  storageBucket: "zulora-local-commerce.firebasestorage.app",
  messagingSenderId: "176478506506",
  appId: "1:176478506506:web:9ff136754641c36afc19f3"
};

export const cloudinaryConfig = {
  cloudName: "g2udlmgl",
  uploadPreset: "zulora_unsigned",
  uploadFolder: "zulora_products"
};

export const PLATFORM_CONSTANTS = {
  APP_NAME: "Zulora Local",
  TAGLINE: "Hyperlocal Quick Commerce by Zulora AI",
  BRAND_LOGO_URL: "https://i.postimg.cc/V621Yk7C/IMG-20260531-172651.jpg",
  VERIFIED_BADGE_URL: "https://i.postimg.cc/MZVr9JS2/LS20260530205459.png",
  SUPREME_ADMIN_EMAIL: "zulora.help@gmail.com",
  HELPLINE_PHONE: "+916395211325",
  HELPLINE_PHONE_DISPLAY: "+91 6395211325",
  HELPLINE_WHATSAPP: "916395211325",
  GITHUB_REPO: "https://github.com/panwarshiven612-cloud/zulora-local-commerce.git",
  PLATFORM_COMMISSION_RATE: 0.03,
  DEFAULT_DELIVERY_RADIUS_KM: 5.0,
  DEFAULT_TOWN: "All Locations",
  DEFAULT_LAT: null,
  DEFAULT_LNG: null,
  PRESET_CATEGORIES: ["Food", "Crops", "Electronics", "Sweets", "Grocery", "Fashion", "Toys"]
};
