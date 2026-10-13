# SecureChat

A real-time, end-to-end encrypted chat application built for a Computer Networks college project.
Messages are encrypted in the sender's browser with **AES-256-GCM** and decrypted in the receiver's
browser. The server and the database only ever see ciphertext.

```
Register → Login → User list → Real-time chat → Encrypt → Send ciphertext → Receive → Decrypt → Display
```

## Features

- Landing page with Login / Register and a short explanation of encryption
- Registration and login (username or email) with bcrypt-hashed passwords and JWT sessions
- User list, user search, online/offline status, typing indicator, message timestamps, unread badges
- One-to-one real-time messaging over Socket.IO (WebSocket)
- Client-side AES-256-GCM encryption with a fresh random IV for every message
- Chat history stored in MySQL as ciphertext + IV only
- "🔒 End-to-End Encrypted" indicator and a Security Info panel
- **Edit** your own text messages (within 15 minutes) and see an "edited" label
- **Delete** a message for yourself, or for everyone (the ciphertext is wiped from the database)
- **React** to any message with an emoji (one reaction per person, like WhatsApp), plus copy-to-clipboard
- **Voice messages**: record, send and play with a waveform and 1x / 1.5x / 2x speed. The audio is
  encrypted in the browser with the same AES-256-GCM key as text
- Right-click or long-press a message (or use the hover buttons) to open its menu
- **Private rooms**: there is no public user list. One person creates a room and shares its 6-character code,
  the other joins with it, and only then can the two message each other
- **Safety number** in the chat details panel, so two people can verify nobody is intercepting their chat
- **Light and dark theme** (remembered, follows your system on first visit)
- Redesigned responsive UI: navigation rail, chat list, conversation and details panel; grouped message bubbles,
  day separators, emoji picker, bottom tab bar and bottom-sheet menu on phones

## Technologies

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, plain CSS, React Router, MediaRecorder API (voice) |
| Backend | Node.js, Express, Socket.IO |
| Database | MySQL (via `mysql2`) |
| Encryption | Browser Web Crypto API (ECDH P-256, HKDF, AES-256-GCM) |
| Auth | JWT (`jsonwebtoken`), bcrypt (`bcryptjs`) |
| Hardening | `helmet`, `cors`, `express-rate-limit`, input validation, parameterised SQL |

> `bcryptjs` is a pure-JavaScript implementation of the same bcrypt algorithm. It avoids native build
> problems (common on Windows). To use the native package, `npm i bcrypt` and change the import in
> `server/routes/auth.js`.

## Project structure

```
secure-chat/
├── client/            React + Vite frontend
│   └── src/
│       ├── crypto.js      all encryption code (Web Crypto)
│       ├── api.js         REST helper
│       ├── pages/         Landing, Auth (login/register), Chat
│       └── components/    Logo, SecurityPanel
├── server/            Express + Socket.IO backend
│   ├── index.js           app entry
│   ├── socket.js          real-time events, presence, typing
│   ├── auth.js            JWT helpers + middleware
│   └── routes/            auth, users, messages
├── database/schema.sql    MySQL tables
├── .env.example
└── README.md
```

## Setup

**Requirements:** Node.js 18+ and MySQL 8+.

### 1. MySQL

```bash
mysql -u root -p < database/schema.sql
```

This creates the `securechat` database with the `users`, `messages`, `reactions` and `rooms` tables.
Rooms are stored in a `rooms` table (`code`, `creator_id`, `guest_id`, and a unique `pair_key` so two people can only
share one room). Messages are only accepted, loaded or relayed between two people who share a room, and presence and
typing signals go only to room members.

**Upgrading from an earlier version?** You don't need to re-run it. The server adds the new columns and the
`reactions` table automatically the next time it starts (you'll see `Database upgraded: …` in the console).
(Or open `database/schema.sql` in MySQL Workbench and run it.)

### 2. Environment variables

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`: set `DB_PASSWORD` and generate a `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Run the backend (port 5000)

```bash
cd server
npm install
npm run dev        # or: npm start
```

You should see `MySQL connected` and `SecureChat server running on port 5000`.

### 4. Run the frontend (port 5173)

```bash
cd client
npm install
npm run dev
```

Open **http://localhost:5173** (use `localhost` — Web Crypto requires a secure context).

### 5. Try it

Open the app in two different browsers (or one normal window + one private window), register two
users, log in, and chat. Check the `messages` table to see only ciphertext:

```sql
SELECT sender_id, receiver_id, ciphertext, iv, created_at FROM messages;
```

## How the encryption works

1. **Key pair.** When a user first logs in on a browser, `crypto.subtle.generateKey` creates an
   ECDH P-256 key pair. The **public key** is uploaded to the server (`users.public_key`). The
   **private key** stays in that browser.
2. **Shared secret.** To chat, Alice combines *her private key* with *Bob's public key*. Bob does the
   reverse and gets the identical secret (Diffie–Hellman). The secret is never transmitted.
3. **Key derivation.** HKDF-SHA-256 turns the secret into a 256-bit AES key.
4. **Encrypt.** Each message is encrypted with **AES-256-GCM** using a new random 12-byte IV from
   `crypto.getRandomValues`. GCM also produces an authentication tag, so tampering is detected.
5. **Transport.** Only `{ciphertext, iv}` (base64) goes over the WebSocket. The server validates the
   format, stores it in MySQL and forwards it.
6. **Decrypt.** The recipient derives the same AES key and decrypts. If the data was modified or the
   key is wrong, GCM authentication fails and the message shows as "Could not decrypt".

No custom cryptography is implemented — every primitive is the browser's native Web Crypto API.

## Computer Networks concepts used

- **Client–server architecture** (React client, Express server, MySQL data tier)
- **HTTP/REST** for register, login, user list and history; **status codes** (400, 401, 409, 429…)
- **WebSocket** (via Socket.IO) for full-duplex, low-latency real-time messaging, plus **rooms**,
  events and acknowledgements
- **Presence tracking** and **typing events** (small signalling messages over the same connection)
- **Proxying** and **CORS / same-origin policy** (Vite dev proxy forwards `/api` and `/socket.io`)
- **Ports and sockets** (5000 backend, 5173 frontend, 3306 MySQL)
- **Confidentiality, integrity, authentication**: AES-GCM, GCM tags, JWT, bcrypt
- **Diffie–Hellman key exchange** (ECDH) over an untrusted network
- **Stateless authentication** with Bearer tokens; **rate limiting** against brute force
- **Man-in-the-middle** risk and why transport security (HTTPS/TLS) matters

## Edit, delete, react and voice: how they work

| Feature | What travels / is stored |
|---|---|
| Edit | The browser encrypts the new text with a **new IV** and sends `{id, ciphertext, iv}`. The server checks you are the sender and that it is within 15 minutes, then stores it and tells both people. |
| Delete for me | Only a `hidden_by_*` flag is set. The other person still sees the message. |
| Delete for everyone | The ciphertext is replaced with an empty string and `deleted_at` is set. Both people see a "message was deleted" placeholder, and its reactions are removed. |
| React | A single emoji per person per message, validated on the server. Reactions are **not** encrypted (see tradeoffs). |
| Voice message | The recording is encrypted in the browser (`[mime][audio]` inside the AES-GCM payload). The socket event only carries metadata; the receiver downloads the ciphertext (`GET /api/messages/audio/:id`) when pressing play and decrypts it locally. Max 90 seconds. |

## Security tradeoffs (kept simple on purpose)

These are deliberate simplifications for a college project:

1. **Private key in `localStorage`.** The key never leaves the browser, but scripts on the page (XSS)
   could read it. Production apps use non-extractable keys, a passphrase-wrapped key backup, or
   a secure enclave.
2. **Single device.** Keys live in one browser. Logging in from a new browser/device creates a new
   key pair, so older messages cannot be decrypted there (shown as "Could not decrypt").
   Clearing browser data has the same effect. Logging out does *not* delete the key, so history stays readable.
3. **No key verification.** The server hands out public keys, so a malicious server could swap them
   (man-in-the-middle). Real apps (Signal, WhatsApp) let users compare safety numbers/fingerprints.
4. **No forward secrecy.** One long-lived shared key per pair of users. Compromise of a private key
   exposes that user's past messages. Protocols like Signal's Double Ratchet fix this, but are far too
   complex for this project.
5. **JWT in `localStorage`.** Simple, but readable by XSS. HttpOnly cookies are safer.
6. **Metadata is visible.** The server knows who talks to whom and when (only content is hidden).
7. **HTTP in development.** Use HTTPS (TLS) when deploying anywhere beyond localhost, otherwise
   JWTs and metadata travel unencrypted.
8. **Basic limits.** Login/register are rate limited; message sending is not.
9. **Reactions and voice length are metadata.** Emoji reactions and a voice note's duration are stored
   unencrypted so the server can validate and relay them. The message content itself stays encrypted.
10. **"Delete for everyone" can't un-see.** It removes the data from the server, but it cannot erase what the
    other person already read, copied, or played in their browser.

Passwords and private keys are never logged. Passwords are only ever stored as bcrypt hashes (cost 12).

## Troubleshooting

- **`JWT_SECRET is missing`** – `.env` must be in the project root (next to `.env.example`).
- **`Cannot connect to MySQL`** – check `DB_*` values and that you ran `database/schema.sql`.
  If you get "Client does not support authentication protocol", run in MySQL:
  `ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'your_password';`
- **"Web Crypto is unavailable"** – open the app at `http://localhost:5173`, not a LAN IP over HTTP.
- **Microphone doesn't work** – allow it from the lock icon in the address bar. Recording needs
  `http://localhost` or HTTPS, and a microphone must be connected.
- **Contact shows "hasn't set up encryption keys"** – that user must log in once.
- **Sent messages show "Could not decrypt"** – the browser's key was cleared or you are on a different
  browser than before. Chats created from the new key onward work normally.
