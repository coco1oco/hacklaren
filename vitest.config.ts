import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Unit/component tests. Firestore rules tests use vitest.rules.config.ts (requires the emulator).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./functions/src/shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'functions/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/rules/**', 'tests/e2e/**'],
  },
});
