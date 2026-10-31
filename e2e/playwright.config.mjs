// WebKit tests for iPhone and iPad sizes. How to run them:
//   npm run build                      (from the repo root; the tests use the built app)
//   cd e2e && npm install && npx playwright install webkit
//   DATABASE_URL=... MIGRATE_DATABASE_URL=... npx playwright test
// DATABASE_URL must be this repo's own local database, on port 5433.
// This is WebKit in a device profile, not Safari on a real iPhone. Add to Home Screen, the notch and touch need a real phone.
import { defineConfig, devices } from '@playwright/test';

const url = process.env.DATABASE_URL || '';
if (!url.includes('localhost:5433')) throw new Error('Set DATABASE_URL to this repo\'s own database on localhost:5433 before running these tests.');

const PORT = 5056;
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  workers: 1,
  timeout: 90000,
  // Pages under a service worker skip the CSP rewrite in ios.spec.mjs, so only the service worker's own test allows one
  use: { baseURL: `http://localhost:${PORT}`, serviceWorkers: 'block' },
  webServer: { command: 'node src/server.js', cwd: '../server', url: `http://localhost:${PORT}/api/health`, env: { ...process.env, PORT: String(PORT) }, reuseExistingServer: false },
  projects: [
    { name: 'iPhone 14', use: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } } },
    { name: 'iPhone 14 Pro Max', use: { ...devices['iPhone 14 Pro Max'], viewport: { width: 430, height: 932 } } },
    { name: 'iPad', use: { ...devices['iPad Pro 11'], viewport: { width: 820, height: 1180 } } },
  ],
});
