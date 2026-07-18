import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
    // The suite's heavy userEvent flows (job forms, admin dialogs) exceed the
    // 5s default under full-suite worker contention — they pass in isolation.
    // This is a load allowance, not a license for slow tests.
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@skillindiaconnect/shared-types': path.resolve(__dirname, '../../packages/shared-types/src'),
    },
  },
});
