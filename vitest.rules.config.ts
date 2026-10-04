import { defineConfig } from 'vitest/config';

// Firestore security rules tests. Requires the Firestore emulator (Java 21+):
//   npm run test:rules
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
