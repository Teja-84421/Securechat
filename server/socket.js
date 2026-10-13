import { pool } from './db.js';
import { verifyToken } from './auth.js';
import { areMatched, peerIds, userRoom } from './peers.js';

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const EMOJI_RE = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f]{1,16}$/u;

const MAX_TEXT_CHARS = 8000;
const MAX_VOICE_CHARS = 2_000_000; // ~1.5 MB of audio once base64-encoded
const MAX_VOICE_MS = 92_000; // client records at most 90 s
const EDIT_WINDOW_MS = 15 * 60 * 1000; // messages can be edited for 15 minutes

const room = userRoom;

export const isOnline = (io, userId) => io.sockets.adapter.rooms.has(room(userId));

const validCipher = (ciphertext, iv, max) =>
  typeof ciphertext === 'string' && ciphertext.length >= 1 && ciphertext.length <= max && B64_RE.test(ciphertext) &&
  typeof iv === 'string' && iv.length === 16 && B64_RE.test(iv);

export function setupSocket(io) {
  // Authenticate every socket connection with the JWT
  io.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth?.token);
      socket.user = { id: payload.id, username: payload.username };
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  // Send an event to both people in a conversation (all of their open tabs)
  const toPair = (a, b) => io.to([room(a), room(b)]);

  // Presence goes only to people who share a room with this user (not to everyone)
  const notifyPeers = async (userId, event, payload) => {
    try {
      const ids = await peerIds(userId);
      if (ids.length) io.to(ids.map(room)).emit(event, payload);
    } catch (err) {
      console.error(`${event} notify error:`, err.message);
    }
  };

  const getMessage = async (id) => {
    if (!Number.isInteger(id)) return null;
    const [rows] = await pool.query(
      'SELECT id, sender_id, receiver_id, type, created_at, deleted_at FROM messages WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  };

  io.on('connection', (socket) => {
    const me = socket.user.id;
    socket.join(room(me)); // one room per user (supports multiple tabs)
    if (io.sockets.adapter.rooms.get(room(me)).size === 1) {
      notifyPeers(me, 'presence', { userId: me, online: true });
    }

    // Wraps a handler so every event gets the same ack + error handling
    const handle = (event, fn) =>
      socket.on(event, async (data, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          await fn(data || {}, reply);
        } catch (err) {
          console.error(`${event} error:`, err.message);
          reply({ ok: false, error: 'Something went wrong. Please try again.' });
        }
      });

    // ---- Send (text or voice). The server only ever sees ciphertext + IV ----
    handle('message:send', async ({ to, ciphertext, iv, type = 'text', durationMs }, reply) => {
      if (type !== 'text' && type !== 'voice') return reply({ ok: false, error: 'Invalid message type' });
      const isVoice = type === 'voice';
      if (!Number.isInteger(to) || to === me) return reply({ ok: false, error: 'Invalid recipient' });
      if (!validCipher(ciphertext, iv, isVoice ? MAX_VOICE_CHARS : MAX_TEXT_CHARS))
        return reply({ ok: false, error: isVoice ? 'Voice message is invalid or too long' : 'Invalid ciphertext' });
      if (isVoice && !(Number.isInteger(durationMs) && durationMs >= 300 && durationMs <= MAX_VOICE_MS))
        return reply({ ok: false, error: 'Invalid voice duration' });

      if (!(await areMatched(me, to))) return reply({ ok: false, error: 'You can only message people in your rooms' });

      const createdAt = new Date();
      const [result] = await pool.query(
        'INSERT INTO messages (sender_id, receiver_id, type, duration_ms, ciphertext, iv, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [me, to, type, isVoice ? durationMs : null, ciphertext, iv, createdAt]
      );
      const message = {
        id: result.insertId,
        sender_id: me,
        receiver_id: to,
        type,
        duration_ms: isVoice ? durationMs : null,
        iv,
        created_at: createdAt.toISOString(),
        edited_at: null,
        deleted_at: null,
        reactions: [],
      };
      // Voice audio is fetched on demand (GET /api/messages/audio/:id), not pushed to everyone.
      if (!isVoice) message.ciphertext = ciphertext;

      io.to(room(to)).emit('message:new', message);
      io.to(room(me)).except(socket.id).emit('message:new', message); // sync sender's other tabs
      reply({ ok: true, message });
    });

    // ---- Edit (own text messages, within 15 minutes) ----
    handle('message:edit', async ({ id, ciphertext, iv }, reply) => {
      if (!validCipher(ciphertext, iv, MAX_TEXT_CHARS)) return reply({ ok: false, error: 'Invalid ciphertext' });
      const m = await getMessage(id);
      if (!m || m.sender_id !== me) return reply({ ok: false, error: 'You can only edit your own messages' });
      if (m.type !== 'text' || m.deleted_at) return reply({ ok: false, error: 'This message can’t be edited' });
      if (Date.now() - new Date(m.created_at).getTime() > EDIT_WINDOW_MS)
        return reply({ ok: false, error: 'Messages can only be edited for 15 minutes' });

      const editedAt = new Date();
      await pool.query('UPDATE messages SET ciphertext = ?, iv = ?, edited_at = ? WHERE id = ?', [ciphertext, iv, editedAt, id]);
      toPair(m.sender_id, m.receiver_id).emit('message:edited', { id, ciphertext, iv, edited_at: editedAt.toISOString() });
      reply({ ok: true });
    });

    // ---- Delete: "everyone" (sender only, leaves a tombstone) or "me" (hide for myself) ----
    handle('message:delete', async ({ id, scope }, reply) => {
      const m = await getMessage(id);
      if (!m || (m.sender_id !== me && m.receiver_id !== me)) return reply({ ok: false, error: 'Message not found' });

      if (scope === 'everyone') {
        if (m.sender_id !== me) return reply({ ok: false, error: 'You can only delete your own messages for everyone' });
        const deletedAt = new Date();
        // The ciphertext is wiped, so nothing is left in the database.
        await pool.query("UPDATE messages SET ciphertext = '', edited_at = NULL, deleted_at = ? WHERE id = ?", [deletedAt, id]);
        await pool.query('DELETE FROM reactions WHERE message_id = ?', [id]);
        toPair(m.sender_id, m.receiver_id).emit('message:deleted', { id, deleted_at: deletedAt.toISOString() });
      } else if (scope === 'me') {
        const column = m.sender_id === me ? 'hidden_by_sender' : 'hidden_by_receiver';
        await pool.query(`UPDATE messages SET ${column} = 1 WHERE id = ?`, [id]);
        io.to(room(me)).emit('message:hidden', { id });
      } else {
        return reply({ ok: false, error: 'Invalid delete option' });
      }
      reply({ ok: true });
    });

    // ---- React (one emoji per person per message; null removes it) ----
    handle('message:react', async ({ id, emoji }, reply) => {
      const m = await getMessage(id);
      if (!m || (m.sender_id !== me && m.receiver_id !== me)) return reply({ ok: false, error: 'Message not found' });
      if (m.deleted_at) return reply({ ok: false, error: 'This message was deleted' });

      if (emoji === null || emoji === undefined) {
        await pool.query('DELETE FROM reactions WHERE message_id = ? AND user_id = ?', [id, me]);
      } else {
        if (typeof emoji !== 'string' || !EMOJI_RE.test(emoji)) return reply({ ok: false, error: 'Invalid emoji' });
        await pool.query(
          'INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE emoji = ?',
          [id, me, emoji, emoji]
        );
      }
      const [reactions] = await pool.query('SELECT user_id, emoji FROM reactions WHERE message_id = ? ORDER BY created_at', [id]);
      toPair(m.sender_id, m.receiver_id).emit('reaction:update', { id, reactions });
      reply({ ok: true });
    });

    socket.on('typing', async ({ to, isTyping } = {}) => {
      if (!Number.isInteger(to)) return;
      try {
        if (await areMatched(me, to)) io.to(room(to)).emit('typing', { from: me, isTyping: !!isTyping });
      } catch {
        /* typing hints are best-effort */
      }
    });

    socket.on('disconnect', () => {
      if (!io.sockets.adapter.rooms.has(room(me))) {
        notifyPeers(me, 'presence', { userId: me, online: false });
      }
    });
  });
}
