import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { isOnline } from '../socket.js';
import { generateCode, pairKey, userRoom } from '../peers.js';

const router = Router();
router.use(requireAuth);

const MAX_OPEN_ROOMS = 5;
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

const shape = (row, io) => {
  const active = row.guest_id !== null;
  return {
    id: row.id,
    status: active ? 'active' : 'waiting',
    code: active ? undefined : row.code, // the code is only needed while waiting
    created_at: row.created_at,
    joined_at: row.joined_at,
    peer: active
      ? { id: row.peer_id, username: row.peer_username, public_key: row.peer_public_key, online: isOnline(io, row.peer_id) }
      : null,
  };
};

async function loadRoom(id, me, io) {
  const [rows] = await pool.query(
    `SELECT r.id, r.code, r.creator_id, r.guest_id, r.created_at, r.joined_at,
            u.id AS peer_id, u.username AS peer_username, u.public_key AS peer_public_key
     FROM rooms r LEFT JOIN users u ON u.id = IF(r.creator_id = ?, r.guest_id, r.creator_id)
     WHERE r.id = ?`,
    [me, id]
  );
  return rows[0] ? shape(rows[0], io) : null;
}

// My rooms: waiting ones (with their code) and active ones (with the other person)
router.get('/', async (req, res) => {
  try {
    const me = req.user.id;
    const [rows] = await pool.query(
      `SELECT r.id, r.code, r.creator_id, r.guest_id, r.created_at, r.joined_at,
              u.id AS peer_id, u.username AS peer_username, u.public_key AS peer_public_key
       FROM rooms r LEFT JOIN users u ON u.id = IF(r.creator_id = ?, r.guest_id, r.creator_id)
       WHERE r.creator_id = ? OR r.guest_id = ?
       ORDER BY COALESCE(r.joined_at, r.created_at) DESC`,
      [me, me, me]
    );
    const io = req.app.get('io');
    res.json({ rooms: rows.map((r) => shape(r, io)) });
  } catch (err) {
    console.error('List rooms error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a room and get a code to share
router.post('/', limiter, async (req, res) => {
  try {
    const me = req.user.id;
    const [[{ pending }]] = await pool.query(
      'SELECT COUNT(*) AS pending FROM rooms WHERE creator_id = ? AND guest_id IS NULL',
      [me]
    );
    if (pending >= MAX_OPEN_ROOMS)
      return res.status(400).json({ error: `You already have ${MAX_OPEN_ROOMS} rooms waiting. Cancel one first.` });

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [result] = await pool.query('INSERT INTO rooms (code, creator_id) VALUES (?, ?)', [generateCode(), me]);
        const io = req.app.get('io');
        io.to(userRoom(me)).emit('rooms:changed');
        return res.status(201).json({ room: await loadRoom(result.insertId, me, io) });
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err; // code collision: try another
      }
    }
    res.status(500).json({ error: 'Could not create a room. Please try again.' });
  } catch (err) {
    console.error('Create room error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Join someone's room with its code
router.post('/join', limiter, async (req, res) => {
  try {
    const me = req.user.id;
    const code = String(req.body?.code ?? '').toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9]{6}$/.test(code)) return res.status(400).json({ error: 'Room codes have 6 letters or numbers' });

    const [rows] = await pool.query('SELECT id, creator_id FROM rooms WHERE code = ? AND guest_id IS NULL', [code]);
    const room = rows[0];
    if (!room) return res.status(404).json({ error: 'No open room matches that code' });
    if (room.creator_id === me) return res.status(400).json({ error: 'That’s your own room. Share the code with a friend.' });

    try {
      const [result] = await pool.query(
        'UPDATE rooms SET guest_id = ?, pair_key = ?, joined_at = ? WHERE id = ? AND guest_id IS NULL',
        [me, pairKey(me, room.creator_id), new Date(), room.id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'No open room matches that code' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'You already have a chat with this person' });
      throw err;
    }

    const io = req.app.get('io');
    io.to([userRoom(me), userRoom(room.creator_id)]).emit('rooms:changed');
    res.json({ room: await loadRoom(room.id, me, io) });
  } catch (err) {
    console.error('Join room error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Cancel a waiting room, or close an active one (deletes the conversation for both people)
router.delete('/:id', async (req, res) => {
  try {
    const me = req.user.id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid room' });

    const [rows] = await pool.query('SELECT id, creator_id, guest_id FROM rooms WHERE id = ?', [id]);
    const room = rows[0];
    if (!room || (room.creator_id !== me && room.guest_id !== me)) return res.status(404).json({ error: 'Room not found' });

    const peer = room.guest_id === null ? null : room.creator_id === me ? room.guest_id : room.creator_id;
    if (peer) {
      await pool.query(
        'DELETE FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)',
        [me, peer, peer, me]
      ); // reactions are removed by ON DELETE CASCADE
    }
    await pool.query('DELETE FROM rooms WHERE id = ?', [id]);

    res.app.get('io').to(peer ? [userRoom(me), userRoom(peer)] : userRoom(me)).emit('rooms:changed');
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete room error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
