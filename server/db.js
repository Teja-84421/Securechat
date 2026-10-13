import mysql from 'mysql2/promise';
import { config } from './config.js';

// Connection pool; all queries below use ? placeholders (prevents SQL injection).
export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
});
