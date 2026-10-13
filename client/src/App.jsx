import { useEffect, useState, useMemo } from 'react';
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

  // Restore session on page load
  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then(({ user }) => syncKeys(user))
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return <div className="splash">Loading SecureChat…</div>;

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
