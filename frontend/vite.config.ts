import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react(), tailwindcss()],
  ...(command === 'serve' && !isPreview ? {
    server: {
      proxy: {
        '^/backend(?:/|$)': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/backend(?=\/|$)/, '') || '/',
        },
      },
    },
  } : {}),
}));
