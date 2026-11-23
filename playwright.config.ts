import { defineConfig, devices } from '@playwright/test';

// Screen tests run against the exported web build (npm run test:e2e builds it
// first) with Supabase mocked in e2e/fixtures.ts. Database behaviour is covered
// by the pgTAP tests in supabase/tests.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8088',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Optional: point at an already-installed Chromium instead of `npx playwright install`.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'node e2e/serve.mjs dist-e2e 8088',
    url: 'http://localhost:8088',
    reuseExistingServer: !process.env.CI,
  },
});
