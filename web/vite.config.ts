import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    // Dev port allocation: Heorth 3000/5173, Feoh 3001, KithLedger 3002/5174
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
});
