// Registers the service worker (production only, so local development is never cached)
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      // Ask the worker to keep the files this page just loaded (scripts, styles) for offline use
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => new URL(u).origin === location.origin && /\/(assets|icons)\//.test(u));
      (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'CACHE_URLS', urls });
    } catch {
      /* the app works fine without it */
    }
  });
}
