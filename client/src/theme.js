import { useSyncExternalStore } from 'react';

// Tiny theme store: the <html data-theme> attribute is the source of truth, and the
// choice is remembered in localStorage. Every toggle on screen stays in sync.
const KEY = 'securechat_theme';
const listeners = new Set();

const read = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
let current = read();

function apply(theme) {
  const root = document.documentElement;
  root.classList.add('theme-switching'); // enables a short colour cross-fade (see index.css)
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#eef0f8' : '#0a0f24');
  setTimeout(() => root.classList.remove('theme-switching'), 350);
}

export function setTheme(theme) {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the theme just won't be remembered */
  }
  apply(theme);
  listeners.forEach((l) => l());
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current
  );
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')];
}
