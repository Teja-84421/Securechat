import { useSyncExternalStore } from 'react';

// Keeps the app glued to the part of the screen you can actually SEE.
// On phones the on-screen keyboard and the browser toolbars change the visible height; without this the
// message box can end up hidden behind the keyboard (especially on iPhone).
//
//   --app-h    height of the visible area      --vv-top   how far the visible area is scrolled
//   html.kb-open  is set while the keyboard is up (used to drop the home-indicator padding)
const root = document.documentElement;

let tallest = 0; // the biggest visible height seen at this width = "no keyboard"
let lastWidth = 0;

function update() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  root.style.setProperty('--app-h', `${Math.round(height)}px`);
  root.style.setProperty('--vv-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);

  // Keyboard = I'm typing AND the visible area got much shorter than normal (works on iPhone and Android)
  if (window.innerWidth !== lastWidth) {
    lastWidth = window.innerWidth; // rotated or resized: start measuring again
    tallest = 0;
  }
  tallest = Math.max(tallest, height);
  const a = document.activeElement;
  const typing = !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  root.classList.toggle('kb-open', typing && tallest - height > 140);

  window.dispatchEvent(new Event('sc:viewport')); // lets the chat keep the newest message in view
}

let started = false;
export function initViewport() {
  if (started) return;
  started = true;
  update();
  const vv = window.visualViewport;
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 250));
  document.addEventListener('focusin', () => setTimeout(update, 60));
  document.addEventListener('focusout', () => setTimeout(update, 60));
}

// true on phones and small tablets (the single-pane layout)
const query = '(max-width: 860px)';
export function useIsMobile() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}
