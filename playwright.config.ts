/**
 * MARA end-to-end tests (Playwright).
 *
 * Prerequisites (run in separate terminals, from the repo root):
 *   1. npm --prefix functions run build
 *   2. npm run emulators          # Auth, Firestore, Functions, Storage emulators (Java 21+ required)
 *   3. npm run seed               # seeds midwife@mara.test / Password123!, Maria Santos (MARA-PAT-2841), "Provincial Hospital"
 *   4. npx playwright install chromium   # first run only
 *
 * Then:  npm run test:e2e
 * The Vite dev server (npm run dev) is started automatically, or reused if already running on :5173.
 * The app must be configured to use the emulators (see .env.example) with AI_PROVIDER=mock and the mock SMS provider.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-pixel5', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
