/**
 * Zulora Local — PWA Install Prompt Manager v2
 */
let deferredInstallPrompt = null;

export function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('[PWA] SW registered:', reg.scope))
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallUI();
    if (window.showToast) window.showToast('Zulora Local installed on your device!', 'success');
  });
}

function showInstallUI() {
  document.getElementById('pwaInstallBanner')?.classList.remove('hidden');
  document.getElementById('btnInstallApp')?.classList.remove('hidden');
}

export function hideInstallUI() {
  document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  document.getElementById('btnInstallApp')?.classList.add('hidden');
}

export async function promptPWAInstall() {
  if (!deferredInstallPrompt) {
    window.showToast?.('App already installed or use browser menu to install.', 'info');
    return;
  }
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  console.log('[PWA] Install outcome:', outcome);
  deferredInstallPrompt = null;
  hideInstallUI();
}

initPWA();
