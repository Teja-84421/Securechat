import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server forwards API + WebSocket traffic to the Express backend,
// so the browser only ever talks to one origin (no CORS headaches).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
});
