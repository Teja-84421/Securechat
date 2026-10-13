import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useTheme } from '../theme';

// "Continue with Google" using Google Identity Services.
// Google draws the button (it must follow their branding rules) and hands us a signed
// ID token via `onCredential`; the server verifies it. If the server has no
// GOOGLE_CLIENT_ID configured, this renders nothing, so the normal form still works.

let clientIdPromise;
const getClientId = () => (clientIdPromise ??= api.googleConfig().then((d) => d.clientId || null).catch(() => null));

let scriptPromise;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => {
      scriptPromise = null; // allow a retry on the next mount
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function GoogleButton({ mode, onCredential, onError, disabled }) {
  const holder = useRef(null);
  const [clientId, setClientId] = useState(null);
  const [theme] = useTheme();

  // Always call the latest handler without re-initialising Google's button
  const handlers = useRef({});
  handlers.current = { onCredential, onError };

  useEffect(() => {
    let alive = true;
    getClientId().then((id) => alive && setClientId(id));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!clientId || !holder.current) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !holder.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (res) => res.credential && handlers.current.onCredential(res.credential),
        });
        holder.current.innerHTML = '';
        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: theme === 'light' ? 'outline' : 'filled_black',
          size: 'large',
          shape: 'pill',
          text: mode === 'register' ? 'signup_with' : 'continue_with',
          logo_alignment: 'left',
          width: Math.max(200, Math.min(400, Math.floor(holder.current.offsetWidth) || 300)),
        });
      })
      .catch((err) => handlers.current.onError?.(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, mode, theme]);

  if (!clientId) return null;

  return (
    <>
      <div className={`google-btn${disabled ? ' is-busy' : ''}`} ref={holder} />
      <div className="auth-divider"><span>or use your email</span></div>
    </>
  );
}
