import { pool } from './db.js';
import { generateCode, pairKey } from './peers.js';

// Runs on every server start. Safe to repeat: it only adds what is missing,
// so an existing database from the first version upgrades automatically.

async function columnInfo(table, column) {
  const [rows] = await pool.query(
    `SELECT DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] || null;
}

export async function migrate() {
  const newColumns = [
    ['type', "ENUM('text','voice') NOT NULL DEFAULT 'text'"],
    ['duration_ms', 'INT NULL'],
    ['edited_at', 'DATETIME NULL DEFAULT NULL'],
    ['deleted_at', 'DATETIME NULL DEFAULT NULL'],
    ['hidden_by_sender', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['hidden_by_receiver', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ];
  for (const [name, definition] of newColumns) {
    if (!(await columnInfo('messages', name))) {
      await pool.query(`ALTER TABLE messages ADD COLUMN ${name} ${definition}`);
      console.log(`Database upgraded: messages.${name} added`);
    }
  }

  // Voice messages are far larger than the 64 KB a TEXT column can hold.
  const cipher = await columnInfo('messages', 'ciphertext');
  if (cipher && cipher.DATA_TYPE !== 'mediumtext') {
    await pool.query('ALTER TABLE messages MODIFY ciphertext MEDIUMTEXT NOT NULL');
    console.log('Database upgraded: messages.ciphertext is now MEDIUMTEXT');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reactions (
      message_id INT NOT NULL,
      user_id    INT NOT NULL,
      emoji      VARCHAR(32) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      code       VARCHAR(8) NOT NULL UNIQUE,
      creator_id INT NOT NULL,
      guest_id   INT NULL,
      pair_key   VARCHAR(24) NULL UNIQUE,   -- "smallerId:largerId" once two people are matched
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      joined_at  DATETIME NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (guest_id)   REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // Conversations that existed before rooms were introduced become active rooms,
  // so nobody loses their history.
  const [pairs] = await pool.query(
    `SELECT DISTINCT LEAST(sender_id, receiver_id) AS a, GREATEST(sender_id, receiver_id) AS b FROM messages`
  );
  for (const { a, b } of pairs) {
    const [existing] = await pool.query('SELECT 1 FROM rooms WHERE pair_key = ?', [pairKey(a, b)]);
    if (existing.length) continue;
    await pool.query(
      'INSERT INTO rooms (code, creator_id, guest_id, pair_key, joined_at) VALUES (?, ?, ?, ?, NOW())',
      [generateCode(), a, b, pairKey(a, b)]
    );
    console.log(`Database upgraded: existing chat between users ${a} and ${b} is now a room`);
  }
}
