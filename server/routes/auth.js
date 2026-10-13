import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { pool } from '../db.js';
import { signToken, signSetupToken, verifySetupToken, requireAuth } from '../auth.js';

const router = Router();

// Slows down brute-force password guessing
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

// Only created when GOOGLE_CLIENT_ID is set in .env
const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', limiter, async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username))
      return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores' });
    if (typeof email !== 'string' || email.length > 100 || !EMAIL_RE.test(email))
      return res.status(400).json({ error: 'Enter a valid email address' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 72)
      return res.status(400).json({ error: 'Password must be 8-72 characters' });

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email.toLowerCase()]
    );
    if (existing.length) return res.status(409).json({ error: 'Username or email already in use' });

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email.toLowerCase(), passwordHash]
    );
    const user = { id: result.insertId, username, email: email.toLowerCase(), public_key: null };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', limiter, async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier || !password)
      return res.status(400).json({ error: 'Enter your username/email and password' });

    const [rows] = await pool.query(
      'SELECT id, username, email, password_hash, public_key FROM users WHERE username = ? OR email = ?',
      [identifier, identifier.toLowerCase()]
    );
    const row = rows[0];
    if (row && !row.password_hash)
      return res.status(401).json({ error: 'This account uses Google. Use the "Continue with Google" button.' });
    const ok = row && (await bcrypt.compare(password, row.password_hash));
    if (!ok) return res.status(401).json({ error: 'Invalid username/email or password' });

    const user = { id: row.id, username: row.username, email: row.email, public_key: row.public_key };
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------- Google sign-in
// Flow: the browser gets a signed Google ID token (a JWT) from Google, sends it here,
// and we verify its signature, audience (our client ID) and expiry with Google's public
// keys. We never see the user's Google password. Then we log in / create the account
// and return our own normal session token, so everything after this is unchanged.

// The client asks which Google client ID to use, so it only has to be set once (.env).
router.get('/google-config', (req, res) => {
  res.json({ clientId: googleClient ? config.googleClientId : null });
});

// Builds a valid, unused username (3-20 letters/numbers/underscores) from the email.
async function makeUsername(email) {
  let base = email
    .split('@')[0]
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 15);
  if (base.length < 3) base = (base + 'user').slice(0, 15);

  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? base : `${base}_${Math.floor(1000 + Math.random() * 9000)}`;
    const [taken] = await pool.query('SELECT 1 FROM users WHERE username = ?', [candidate]);
    if (!taken.length) return candidate;
  }
  return `user_${Date.now().toString(36)}`.slice(0, 20);
}

router.post('/google', limiter, async (req, res) => {
  if (!googleClient)
    return res.status(501).json({ error: 'Google sign-in is not set up on this server' });

  try {
    const { credential } = req.body || {};
    if (typeof credential !== 'string' || credential.length < 20 || credential.length > 4096)
      return res.status(400).json({ error: 'Missing Google credential' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: config.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
    }

    if (!payload?.sub || !payload.email)
      return res.status(401).json({ error: 'Google did not return an email address' });
    if (!payload.email_verified)
      return res.status(401).json({ error: 'Your Google email address is not verified' });

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();
    if (email.length > 100) return res.status(400).json({ error: 'Email address is too long' });

    const [rows] = await pool.query(
      'SELECT id, username, email, public_key, google_id FROM users WHERE google_id = ? OR email = ?',
      [googleId, email]
    );
    // Prefer the row already linked to this Google account, otherwise the one with this email.
    const row = rows.find((r) => r.google_id === googleId) || rows.find((r) => r.email === email);

    // 1) Returning Google user, or an existing email/password account signing in with Google
    if (row) {
      if (row.google_id && row.google_id !== googleId)
        return res.status(409).json({ error: 'This email is linked to a different Google account' });
      if (!row.google_id) {
        // Same (Google-verified) email as an existing account: link them, keep their username/rooms.
        await pool.query('UPDATE users SET google_id = ? WHERE id = ?', [googleId, row.id]);
      }
      const user = { id: row.id, username: row.username, email: row.email, public_key: row.public_key };
      return res.json({ token: signToken(user), user, isNew: false });
    }

    // 2) First time: don't create the account yet. The client now asks for a username and
    //    password, then calls /google/complete with this short-lived setup token.
    res.json({
      needsSetup: true,
      setupToken: signSetupToken({ googleId, email }),
      email,
      suggestedUsername: await makeUsername(email),
    });
  } catch (err) {
    console.error('Google sign-in error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Step 2 of Google sign-up: the person chose a username and password.
router.post('/google/complete', limiter, async (req, res) => {
  try {
    const { setupToken, username, password } = req.body || {};
    let setup;
    try {
      setup = verifySetupToken(typeof setupToken === 'string' ? setupToken : '');
    } catch {
      return res.status(401).json({ error: 'Your sign-up session expired. Click "Continue with Google" again.' });
    }
    if (typeof username !== 'string' || !USERNAME_RE.test(username))
      return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 72)
      return res.status(400).json({ error: 'Password must be 8-72 characters' });

    const [taken] = await pool.query(
      'SELECT username, google_id, email FROM users WHERE username = ? OR google_id = ? OR email = ?',
      [username, setup.googleId, setup.email]
    );
    if (taken.some((r) => r.google_id === setup.googleId || r.email === setup.email))
      return res.status(409).json({ error: 'This Google account already has an account. Please sign in.' });
    if (taken.length) return res.status(409).json({ error: 'That username is already taken' });

    const passwordHash = await bcrypt.hash(password, 12);
    let result;
    try {
      [result] = await pool.query(
        'INSERT INTO users (username, email, password_hash, google_id) VALUES (?, ?, ?, ?)',
        [username, setup.email, passwordHash, setup.googleId]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That username is already taken' });
      throw err;
    }
    const user = { id: result.insertId, username, email: setup.email, public_key: null };
    res.status(201).json({ token: signToken(user), user, isNew: true });
  } catch (err) {
    console.error('Google complete error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Lets the client verify its stored token on page load
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, email, public_key, created_at,
              google_id IS NOT NULL AS has_google, password_hash IS NOT NULL AS has_password
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'User no longer exists' });
    const { has_google, has_password, ...rest } = rows[0];
    res.json({ user: { ...rest, has_google: !!has_google, has_password: !!has_password } });
  } catch (err) {
    console.error('Me error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
