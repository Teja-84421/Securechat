import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { areMatched } from '../peers.js';

const router = Router();
router.use(requireAuth);

// Encrypted audio for one voice message (fetched when the person presses play).
router.get('/audio/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid message' });
    const me = req.user.id;
    const [rows] = await pool.query(
      'SELECT sender_id, receiver_id, type, ciphertext, iv, deleted_at FROM messages WHERE id = ?',
      [id]
    );
    const m = rows[0];
    if (!m || (m.sender_id !== me && m.receiver_id !== me) || m.type !== 'voice')
      return res.status(404).json({ error: 'Voice message not found' });
    if (m.deleted_at) return res.status(410).json({ error: 'This message was deleted' });
    res.json({ ciphertext: m.ciphertext, iv: m.iv });
  } catch (err) {
    console.error('Audio error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Conversation history with one user. Returns CIPHERTEXT only (voice audio is fetched separately).
router.get('/:userId', async (req, res) => {
  try {
    const other = Number(req.params.userId);
    if (!Number.isInteger(other) || other <= 0) return res.status(400).json({ error: 'Invalid user' });
    const me = req.user.id;
    if (!(await areMatched(me, other))) return res.status(403).json({ error: 'You are not in a room with this person' });

    // Newest 500 messages, returned oldest-first. Messages I deleted "for me" are left out.
    const [rows] = await pool.query(
      `SELECT id, sender_id, receiver_id, type, duration_ms, iv, created_at, edited_at, deleted_at,
              CASE WHEN type = 'text' AND deleted_at IS NULL THEN ciphertext ELSE NULL END AS ciphertext
       FROM messages
       WHERE (sender_id = ? AND receiver_id = ? AND hidden_by_sender = 0)
          OR (sender_id = ? AND receiver_id = ? AND hidden_by_receiver = 0)
       ORDER BY created_at DESC, id DESC LIMIT 500`,
      [me, other, other, me]
    );
    rows.reverse();

    const byId = new Map(rows.map((m) => [m.id, (m.reactions = [])]));
    if (rows.length) {
      const [reactions] = await pool.query(
        'SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (?) ORDER BY created_at',
        [rows.map((m) => m.id)]
      );
      reactions.forEach((r) => byId.get(r.message_id)?.push({ user_id: r.user_id, emoji: r.emoji }));
    }
    res.json({ messages: rows });
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
