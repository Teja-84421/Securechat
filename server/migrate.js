import { pool } from './db.js';
import { generateCode, pairKey } from './peers.js';

// Runs on every server start. Safe to repeat: it only adds what is missing,
// so an existing database from the first version upgrades automatically.

async function columnInfo(table, column) {
  const [rows] = await pool.query(
    `SELECT DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] || null;
}

export async function migrate() {
  // Fresh database (e.g. a new hosted MySQL): create the base tables, so nobody has to run schema.sql by hand.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      username      VARCHAR(20)  NOT NULL UNIQUE,
      email         VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(100) NULL,
      google_id     VARCHAR(40)  NULL UNIQUE,
      public_key    TEXT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      sender_id   INT NOT NULL,
      receiver_id INT NOT NULL,
      type        ENUM('text','voice') NOT NULL DEFAULT 'text',
      duration_ms INT NULL,
      ciphertext  MEDIUMTEXT NOT NULL,
      iv          VARCHAR(24) NOT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      edited_at   DATETIME NULL DEFAULT NULL,
      deleted_at  DATETIME NULL DEFAULT NULL,
      hidden_by_sender   TINYINT(1) NOT NULL DEFAULT 0,
      hidden_by_receiver TINYINT(1) NOT NULL DEFAULT 0,
      FOREIGN KEY (sender_id)   REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_conversation (sender_id, receiver_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

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

  // Google sign-in: accounts created through Google have no password.
  if (!(await columnInfo('users', 'google_id'))) {
    await pool.query('ALTER TABLE users ADD COLUMN google_id VARCHAR(40) NULL UNIQUE');
    console.log('Database upgraded: users.google_id added');
  }
  const pw = await columnInfo('users', 'password_hash');
  if (pw && pw.IS_NULLABLE === 'NO') {
    await pool.query('ALTER TABLE users MODIFY password_hash VARCHAR(100) NULL');
    console.log('Database upgraded: users.password_hash can now be NULL (Google accounts)');
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
