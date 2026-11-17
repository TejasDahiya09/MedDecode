import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Isolated Phase 1F composition only. Normal Vite startup remains unchanged.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    proxy: {
      '^/api(?:/|$)': { target: 'http://127.0.0.1:3011', changeOrigin: true },
      '^/__acceptance(?:/|$)': { target: 'http://127.0.0.1:3011', changeOrigin: true },
    },
  },
});
