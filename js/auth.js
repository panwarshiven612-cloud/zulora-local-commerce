/**
 * Zulora Local — Modular Authentication Engine v2
 * Firebase Google Sign-In with Spark Plan support & unauthorized-domain guidance
 */

import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
  isConfigPlaceholder
} from './firebase-init.js';
import { PLATFORM_CONSTANTS } from './config.js';
import { showToast } from './notifications.js';

let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

export function initAuth(onUserChangeCallback) {
  if (!auth || isConfigPlaceholder) {
    if (onUserChangeCallback) onUserChangeCallback(null);
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (onUserChangeCallback) onUserChangeCallback(user);

    if (user && db) {
      try {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);

        const basicData = {
          uid: user.uid,
          displayName: user.displayName || '',
          email: user.email || '',
          photoURL: user.photoURL || '',
          lastLogin: serverTimestamp()
        };

        if (snap.exists()) {
          await updateDoc(userRef, basicData);
        } else {
          basicData.createdAt = serverTimestamp();
          await setDoc(userRef, basicData);
        }
      } catch (err) {
        console.warn('[Auth] Firestore user sync notice:', err);
      }
    }
  });
}

export async function signInWithGoogle() {
  if (!auth || isConfigPlaceholder) {
    showToast('Firebase configuration is placeholder or offline.', 'warning');
    return null;
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    currentUser = result.user;
    showToast(`Welcome, ${result.user.displayName ? result.user.displayName.split(' ')[0] : 'friend'}!`, 'success');
    return result.user;
  } catch (err) {
    console.error('[Auth] Google sign-in error:', err);

    if (err.code === 'auth/unauthorized-domain') {
      showUnauthorizedDomainDialog();
    } else if (err.code === 'auth/popup-closed-by-user') {
      // User dismissed popup, silently ignore
    } else {
      showToast('Sign-in failed: ' + (err.message || 'Unknown error'), 'error');
    }
    return null;
  }
}

export async function signOutUser() {
  if (!auth || isConfigPlaceholder) {
    currentUser = null;
    return;
  }
  try {
    await signOut(auth);
    currentUser = null;
    showToast('Signed out successfully.', 'info');
  } catch (err) {
    console.error('[Auth] Sign-out error:', err);
  }
}

export function showUnauthorizedDomainDialog() {
  document.getElementById('unauthDomainModal')?.remove();

  const currentHost = window.location.hostname || 'localhost';
  const modal = document.createElement('div');
  modal.id = 'unauthDomainModal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Unauthorized Domain" style="max-width:540px;">
      <div class="modal-header" style="background:var(--amber-50,#fffbeb);border-bottom:1px solid var(--amber-200,#fde68a);">
        <h3 style="color:var(--amber-900,#78350f);font-size:1.15rem;font-weight:700;display:flex;align-items:center;gap:0.4rem;">
          ⚠️ Authorized Domain Setup Required
        </h3>
        <button class="btn btn-icon" onclick="document.getElementById('unauthDomainModal').remove()">✕</button>
      </div>
      <div class="modal-body" style="padding:1.25rem 1rem;font-size:0.9rem;line-height:1.5;color:var(--slate-700);">
        <p style="margin-bottom:0.75rem;">
          Firebase Google Sign-In blocked this domain (<strong>${currentHost}</strong>) because it is not yet whitelisted in your Firebase Console.
        </p>
        <div style="background:var(--slate-50);border:1px solid var(--slate-200);border-radius:var(--radius-md);padding:0.85rem;margin-bottom:1rem;font-size:0.85rem;">
          <strong>Quick 30-Second Fix:</strong>
          <ol style="margin-left:1.25rem;margin-top:0.4rem;display:flex;flex-direction:column;gap:0.35rem;">
            <li>Open <a href="https://console.firebase.google.com" target="_blank" rel="noopener" style="color:var(--azure-600);font-weight:700;">Firebase Console</a></li>
            <li>Select project: <strong>zulora-local-commerce</strong></li>
            <li>Go to <strong>Authentication</strong> → <strong>Settings</strong> → <strong>Authorized domains</strong></li>
            <li>Click <strong>Add domain</strong> and paste: <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-weight:700;">${currentHost}</code></li>
          </ol>
        </div>
        <p style="font-size:0.8rem;color:var(--slate-500);">
          Once saved in Firebase, Google Sign-In will immediately work seamlessly on this Vercel deployment!
        </p>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:flex-end;">
        <button class="btn btn-primary" onclick="document.getElementById('unauthDomainModal').remove()">
          Understood ✓
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
