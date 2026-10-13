// Thin wrapper around fetch for the REST API.
// Tradeoff: the JWT lives in localStorage (simple, but readable by any XSS bug).
const TOKEN_KEY = 'securechat_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function request(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

export const api = {
  register: (body) => request('/auth/register', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  googleConfig: () => request('/auth/google-config'),
  googleLogin: (credential) => request('/auth/google', { method: 'POST', body: { credential } }),
  me: () => request('/auth/me'),
  rooms: () => request('/rooms'),
  createRoom: () => request('/rooms', { method: 'POST', body: {} }),
  joinRoom: (code) => request('/rooms/join', { method: 'POST', body: { code } }),
  closeRoom: (id) => request(`/rooms/${id}`, { method: 'DELETE' }),
  setPublicKey: (publicKey) => request('/users/me/key', { method: 'PUT', body: { publicKey } }),
  history: (userId) => request(`/messages/${userId}`),
  audio: (messageId) => request(`/messages/audio/${messageId}`),
};
