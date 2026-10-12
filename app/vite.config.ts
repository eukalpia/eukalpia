import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/eukalpia/',
  plugins: [react()],
  // The BVH worker for photo mode imports modules, so workers are bundled as ES modules.
  worker: { format: 'es' },
  build: {
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
