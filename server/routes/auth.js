import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { signToken, requireAuth } from '../auth.js';

const router = Router();

// Slows down brute-force password guessing
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

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
    const ok = row && (await bcrypt.compare(password, row.password_hash));
    if (!ok) return res.status(401).json({ error: 'Invalid username/email or password' });

    const user = { id: row.id, username: row.username, email: row.email, public_key: row.public_key };
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Lets the client verify its stored token on page load
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, public_key FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'User no longer exists' });
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('Me error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
