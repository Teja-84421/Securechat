import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  port: process.env.PORT || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Google sign-in is optional: leave blank and the button simply won't appear.
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'securechat',
    // Hosted MySQL (Aiven, Railway, ...) usually requires an encrypted connection.
    // DB_SSL=true turns it on; DB_SSL_CA (optional) is the provider's CA certificate text.
    ...(process.env.DB_SSL === 'true'
      ? {
          ssl: process.env.DB_SSL_CA
            ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
            : { rejectUnauthorized: false },
        }
      : {}),
  },
};

if (!config.jwtSecret || config.jwtSecret.length < 32) {
  console.error('JWT_SECRET is missing or too short (min 32 chars). Check your .env file.');
  process.exit(1);
}
