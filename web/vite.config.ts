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
    // Dev port allocation: Heorth 14000/5173, retired Feoh slot 14001, KithLedger 14002/5174
    port: 5174,
    proxy: {
      '/api': 'http://localhost:14002',
    },
  },
});
