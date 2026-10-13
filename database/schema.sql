CREATE DATABASE IF NOT EXISTS securechat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE securechat;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(20)  NOT NULL UNIQUE,
  email         VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,          -- bcrypt hash, never the password
  public_key    TEXT NULL,                      -- ECDH public key (JWK). Safe to share.
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  sender_id   INT NOT NULL,
  receiver_id INT NOT NULL,
  type        ENUM('text','voice') NOT NULL DEFAULT 'text',
  duration_ms INT NULL,                         -- voice messages only
  ciphertext  MEDIUMTEXT NOT NULL,              -- AES-256-GCM output (base64). No plaintext.
  iv          VARCHAR(24) NOT NULL,             -- 12-byte nonce (base64), unique per message
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  edited_at   DATETIME NULL DEFAULT NULL,
  deleted_at  DATETIME NULL DEFAULT NULL,       -- "delete for everyone" (ciphertext is wiped)
  hidden_by_sender   TINYINT(1) NOT NULL DEFAULT 0,  -- "delete for me"
  hidden_by_receiver TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (sender_id)   REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_conversation (sender_id, receiver_id, created_at)
);

CREATE TABLE IF NOT EXISTS reactions (
  message_id INT NOT NULL,
  user_id    INT NOT NULL,
  emoji      VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id),            -- one reaction per person per message
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(8) NOT NULL UNIQUE,        -- 6-character invite code
  creator_id INT NOT NULL,
  guest_id   INT NULL,                          -- NULL while the room is waiting for someone to join
  pair_key   VARCHAR(24) NULL UNIQUE,           -- "smallerId:largerId": one room per pair of people
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  joined_at  DATETIME NULL,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (guest_id)   REFERENCES users(id) ON DELETE CASCADE
);
