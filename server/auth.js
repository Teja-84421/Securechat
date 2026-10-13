import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

// Short-lived token that proves Google verified this email, while the person picks a
// username + password. It is signed with a different key than session tokens, so it
// cannot be used to log in or to open a socket.
const setupSecret = `${config.jwtSecret}:google-signup`;

export function signSetupToken({ googleId, email }) {
  return jwt.sign({ googleId, email }, setupSecret, { expiresIn: '15m' });
}

export function verifySetupToken(token) {
  return jwt.verify(token, setupSecret);
}

// Express middleware: protects REST routes
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.id, username: payload.username };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Used by Socket.IO handshake
export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
