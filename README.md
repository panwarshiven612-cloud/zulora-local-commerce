# Zulora Local — Hyperlocal Quick Commerce & PWA v2

![PWA](https://img.shields.io/badge/PWA-Ready-0284C7?logo=pwa) ![Firebase](https://img.shields.io/badge/Firebase-Spark%20Free-FFCA28?logo=firebase) ![Cloudinary](https://img.shields.io/badge/Cloudinary-Free%20Tier-3448C5?logo=cloudinary) ![Vercel](https://img.shields.io/badge/Vercel-Static%20Hosting-000000?logo=vercel)

**By Zulora AI** — 100% free stack: Vercel static hosting + Firebase Spark (Auth + Firestore) + Cloudinary unsigned uploads. No paid backend, no Cloud Functions, no Firebase Storage billing.

---

## ✨ Features

| Feature | Detail |
|---|---|
| **Dual-Role Account** | Same Google UID → Buyer & Seller without re-registration |
| **Multi-Image Upload** | Select multiple images at once → simultaneous Cloudinary upload → `images[]` + `imageUrl` in Firestore |
| **GPS Hyperlocal Discovery** | Haversine distance filter, delivery time estimation, dynamic delivery fee rules |
| **Smart Cart Splitting** | Auto-groups items by shop, independent min-order checks per shop |
| **UPI QR + COD** | Direct peer-to-peer UPI QR (zero gateway fee), Cash on Delivery |
| **4-Step Live Tracker** | Blinkit-style progress bar synced via Firestore `onSnapshot` |
| **Notifications Center** | Bell badge, in-app drawer, cart reminders, order alerts, browser push |
| **Verified Blue Tick** | Admin-managed seller verification badge on cards and profiles |
| **Custom Categories** | Sellers create custom categories surfaced dynamically in buyer filters |
| **Supreme Admin Panel** | Restricted to `zulora.help@gmail.com` — GMV, commission, verify/revoke shops |
| **PWA Installable** | Standalone install, offline cache, push notification support |

---

## 🔑 Exact Credentials

| Key | Value |
|---|---|
| Firebase Project ID | `zulora-local-commerce` |
| Firebase Auth Domain | `zulora-local-commerce.firebaseapp.com` |
| Cloudinary Cloud Name | `g2udlmgl` |
| Cloudinary Upload Preset | `zulora_unsigned` |
| Cloudinary Upload Folder | `zulora_products` |
| Supreme Admin Email | `zulora.help@gmail.com` |
| Helpline Phone | `+91 6395211325` |
| Helpline WhatsApp | `https://wa.me/916395211325` |

All credentials are pre-configured in `js/config.js`. **Do not commit any private API secrets** (the Firebase API key shown is a public browser key — this is normal and safe for client-side Firebase).

---

## 🚀 Quick Setup

### Step 1 — Firebase Console (Free Spark Plan)

1. Go to [Firebase Console](https://console.firebase.google.com/) and open project `zulora-local-commerce`.
2. **Authentication** → Sign-in method → Enable **Google Provider**.
3. **Firestore Database** → Create database (choose region, start in test mode or apply rules below).
4. **Authentication → Settings → Authorized Domains** → Add:
   - `localhost`
   - Your Vercel domain (e.g. `zulora-local-commerce.vercel.app`)

### Firestore Security Rules (copy-paste ready in `firestore.rules`)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSupremeAdmin() {
      return request.auth != null && 
        (request.auth.token.email == 'zulora.help@gmail.com' || 
         (request.auth.token.email_verified == true && request.auth.token.email == 'zulora.help@gmail.com'));
    }

    match /users/{userId} {
      allow read: if true;
      allow write: if request.auth != null && (request.auth.uid == userId || isSupremeAdmin());
    }

    match /shops/{shopId} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && 
        (resource.data.ownerUid == request.auth.uid || 
         resource.data.sellerUid == request.auth.uid || 
         shopId == request.auth.uid || 
         isSupremeAdmin());
    }

    match /products/{productId} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update: if (request.auth != null && 
        (resource.data.ownerUid == request.auth.uid || 
         resource.data.sellerUid == request.auth.uid || 
         resource.data.shopId == request.auth.uid || 
         isSupremeAdmin())) ||
        (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['stock', 'salesCount', 'inStock']));
      allow delete: if request.auth != null && 
        (resource.data.ownerUid == request.auth.uid || 
         resource.data.sellerUid == request.auth.uid || 
         resource.data.shopId == request.auth.uid || 
         isSupremeAdmin());
    }

    match /orders/{orderId} {
      allow read: if true;
      allow create: if true;
      allow update: if true;
      allow delete: if request.auth != null && 
        (resource.data.sellerUid == request.auth.uid || 
         resource.data.shopId == request.auth.uid || 
         isSupremeAdmin());
    }
  }
}
```

### Step 2 — Cloudinary (Free Tier)

1. Sign up at [cloudinary.com](https://cloudinary.com/) → note your **Cloud Name** (`g2udlmgl`).
2. **Settings (⚙️) → Upload → Upload Presets** → **Add upload preset**:
   - Preset name: `zulora_unsigned`
   - Signing Mode: **Unsigned**
   - Folder: `zulora_products`
3. Save. ✅ No backend required.

---

## 💻 Local Development

```bash
# Any static server works — Python example:
python -m http.server 8000

# Or Node:
npx serve .
```

Open `http://localhost:8000` in Chrome. The PWA will work fully including GPS, auth, and Cloudinary uploads.

---

## 📦 GitHub Push

```bash
git init
git add .
git commit -m "feat: Zulora Local v2 — multi-image, notifications, verified badges, custom categories"
git branch -M main
git remote add origin https://github.com/panwarshiven612-cloud/zulora-local-commerce.git
git push -u origin main
```

> If the remote already exists: `git remote set-url origin https://github.com/panwarshiven612-cloud/zulora-local-commerce.git`

---

## 🌐 Vercel Deployment

1. Go to [vercel.com](https://vercel.com/) → **Add New Project**.
2. Import `panwarshiven612-cloud/zulora-local-commerce` from GitHub.
3. Settings:
   - **Framework Preset:** `Other`
   - **Root Directory:** `./`
   - **Build Command:** *(leave empty)*
   - **Output Directory:** `./`
4. Click **Deploy**. 🚀

5. After deploy, copy your Vercel URL (e.g. `https://zulora-local-commerce.vercel.app`).
6. Add it to Firebase Console → **Authentication → Authorized Domains**.

The `vercel.json` already configures:
- Security headers (X-Frame-Options, CSP, Referrer-Policy)
- Correct `Cache-Control` for `sw.js` (no-cache, so users always get the latest service worker)

---

## 📁 File Structure

```
zulora-local-commerce/
├── index.html          # Main storefront + multi-image carousel + notifications
├── seller.html         # Seller Studio — multi-image upload, custom categories, live orders
├── orders.html         # Buyer live order tracker (4-step Blinkit stepper)
├── admin.html          # Supreme Admin panel (zulora.help@gmail.com only)
├── manifest.json       # PWA Web App Manifest
├── sw.js               # Service Worker — offline cache + push notifications
├── vercel.json         # Vercel headers + cache rules
├── robots.txt          # SEO — noindex admin.html
├── sitemap.xml         # SEO sitemap for Vercel domain
├── .gitignore
├── css/
│   └── style.css       # Pearl & Azure glassmorphic design system
├── js/
│   ├── config.js       # Firebase + Cloudinary + platform constants
│   ├── firebase-init.js
│   ├── cloudinary.js   # Multi-image simultaneous upload
│   ├── geo-pricing.js  # Haversine + delivery fee engine
│   ├── notifications.js# Bell, toast, cart reminders, order alerts, browser push
│   ├── pwa.js          # Install prompt manager
│   ├── app.js          # Front page — discovery, cart, checkout, UPI QR
│   ├── seller.js       # Merchant dashboard
│   ├── orders.js       # Buyer order tracker
│   └── admin.js        # Supreme Admin analytics
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## 📞 Support

| Channel | Contact |
|---|---|
| Email | [zulora.help@gmail.com](mailto:zulora.help@gmail.com) |
| Phone | [+91 6395211325](tel:+916395211325) |
| WhatsApp | [wa.me/916395211325](https://wa.me/916395211325) |

---

© 2026 Zulora AI. All Rights Reserved.
