/**
 * Zulora Local - Firebase v10 Modular SDK Initialization (CDN)
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { firebaseConfig, PLATFORM_CONSTANTS } from './config.js';

export const isConfigPlaceholder =
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey.includes('PASTE') ||
  firebaseConfig.apiKey.includes('YOUR_');

let app = null, auth = null, db = null, googleProvider = null;

try {
  if (!isConfigPlaceholder) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    console.log('[Zulora] Firebase v10 initialized:', firebaseConfig.projectId);
  } else {
    console.warn('[Zulora] Demo mode: placeholder config detected.');
  }
} catch (err) {
  console.error('[Zulora] Firebase init error:', err);
}

export {
  app, auth, db, googleProvider,
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, increment,
  arrayUnion, arrayRemove, Timestamp
};
