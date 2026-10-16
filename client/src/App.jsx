import { useCallback, useEffect, useState, useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { api, getToken, setToken } from './api';
import { getOrCreateKeyPair } from './crypto';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Chat from './pages/Chat';

// Make sure this browser has a key pair and the server has the matching public key.
async function syncKeys(user) {
  const publicKey = await getOrCreateKeyPair(user.id);
  if (user.public_key !== publicKey) await api.setPublicKey(publicKey);
  return { ...user, public_key: publicKey };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [offline, setOffline] = useState(false); // couldn't reach the server (not the same as "logged out")
  const [slow, setSlow] = useState(false); // the server is taking long (free hosting wakes up slowly)

  // Restore session on page load
  const restore = useCallback(() => {
    if (!getToken()) return;
    setOffline(false);
    setLoading(true);
    api
      .me()
      .then(({ user }) => syncKeys(user))
      .then(setUser)
      .catch((err) => {
        // Only a real "not logged in" answer ends the session. No signal in a tunnel must not log you out.
        if (err.status === 401 || err.status === 403) setToken(null);
        else setOffline(true);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(restore, [restore]);

  useEffect(() => {
    if (!loading) return undefined;
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [loading]);

  const auth = useMemo(
    () => ({
      user,
      async signIn({ token, user }) {
        setToken(token);
        try {
          setUser(await syncKeys(user));
        } catch (err) {
          setToken(null);
          throw err;
        }
      },
      signOut() {
        setToken(null);
        setUser(null);
      },
    }),
    [user]
  );

  if (loading) {
    return (
      <div className="splash">
        <div className="splash-box">
          <span className="spinner" aria-hidden="true" />
          <p>Loading SecureChat…</p>
          {slow && <small>Waking up the server, this can take up to a minute the first time.</small>}
        </div>
      </div>
    );
  }
  if (offline) {
    return (
      <div className="splash">
        <div className="splash-box">
          <p><strong>Can’t reach SecureChat</strong></p>
          <small>Check your internet connection. You are still logged in.</small>
          <button type="button" className="btn btn-primary" onClick={restore}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/chat" /> : <Landing />} />
        <Route path="/login" element={user ? <Navigate to="/chat" /> : <Auth mode="login" />} />
        <Route path="/register" element={user ? <Navigate to="/chat" /> : <Auth mode="register" />} />
        <Route path="/chat" element={user ? <Chat /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AuthContext.Provider>
  );
}
