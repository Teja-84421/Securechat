import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { peerIds, userRoom } from '../peers.js';

const router = Router();
router.use(requireAuth);

// There is no public user list any more: people only see each other through rooms.

// Upload my ECDH PUBLIC key. (The private key never leaves the browser.)
router.put('/me/key', async (req, res) => {
  try {
    const { publicKey } = req.body || {};
    if (typeof publicKey !== 'string' || publicKey.length > 1000)
      return res.status(400).json({ error: 'Invalid public key' });
    let jwk;
    try {
      jwk = JSON.parse(publicKey);
    } catch {
      return res.status(400).json({ error: 'Invalid public key' });
    }
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d)
      return res.status(400).json({ error: 'Invalid public key' });

    await pool.query('UPDATE users SET public_key = ? WHERE id = ?', [publicKey, req.user.id]);
    const peers = await peerIds(req.user.id);
    if (peers.length) req.app.get('io').to(peers.map(userRoom)).emit('rooms:changed'); // refresh their copy of my key
    res.json({ ok: true });
  } catch (err) {
    console.error('Update key error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
