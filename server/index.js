import { config } from './config.js';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { pool } from './db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import messageRoutes from './routes/messages.js';
import roomRoutes from './routes/rooms.js';
import { setupSocket } from './socket.js';
import { migrate } from './migrate.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.clientUrl },
  maxHttpBufferSize: 4e6, // voice messages are sent as encrypted base64 (a few hundred KB)
});
app.set('io', io);

app.set('trust proxy', 1); // behind Render's load balancer: use the real client IP for rate limiting
app.use(helmet());
app.use(cors({ origin: config.clientUrl }));
app.use(express.json({ limit: '10kb' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/messages', messageRoutes);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

setupSocket(io);

try {
  await pool.query('SELECT 1');
  console.log('MySQL connected');
  await migrate();
} catch (err) {
  console.error('Database error:', err.message);
  console.error('Check DB_* values in .env and that you ran database/schema.sql');
  process.exit(1);
}

server.listen(config.port, () => console.log(`SecureChat server running on port ${config.port}`));
