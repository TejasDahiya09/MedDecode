import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase') || id.includes('@gotrue') || id.includes('@realtime') || id.includes('@postgrest') || id.includes('@storage')) {
            return 'vendor-supabase';
          }
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
  ...(command === 'serve' && !isPreview ? {
    server: {
      proxy: {
        '^/api(?:/|$)': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
        '^/health$': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
        '^/backend(?:/|$)': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/backend(?=\/|$)/, '') || '/',
        },
      },
    },
  } : {}),
}));
