import { useSyncExternalStore } from 'react';

// "Install app" support. Chrome/Edge/Android offer a real install prompt; iPhone/iPad Safari has none,
// so we show a short how-to instead.
let deferred = null;
let version = 0;
const listeners = new Set();
const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  notify();
  return outcome === 'accepted';
}

export function useInstall() {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version
  );
  const standalone = isStandalone();
  return { canInstall: !!deferred && !standalone, iosHint: isIos() && !standalone, installed: standalone, promptInstall };
}
