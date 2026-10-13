import crypto from 'crypto';
import { pool } from './db.js';

// Helpers for "who is allowed to talk to whom". Two people can only exchange
// messages once they share an active room (one person created it, the other joined with its code).

export const userRoom = (id) => `user:${id}`; // Socket.IO room that holds all tabs of one user
export const pairKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

export async function areMatched(a, b) {
  const [rows] = await pool.query('SELECT 1 FROM rooms WHERE pair_key = ? LIMIT 1', [pairKey(a, b)]);
  return rows.length > 0;
}

// Everyone this user shares an active room with
export async function peerIds(userId) {
  const [rows] = await pool.query(
    'SELECT creator_id, guest_id FROM rooms WHERE guest_id IS NOT NULL AND (creator_id = ? OR guest_id = ?)',
    [userId, userId]
  );
  return rows.map((r) => (r.creator_id === userId ? r.guest_id : r.creator_id));
}

// 6 characters, no look-alikes (no 0/O, 1/I): about a billion combinations
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const generateCode = () =>
  Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
