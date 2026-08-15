import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const target = env.MACHA_API_TARGET;
  return {
    plugins: [react()],
    server: target ? {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
      },
    } : undefined,
    test: {
      environment: 'node',
    },
  };
});
