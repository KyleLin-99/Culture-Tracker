import { defineConfig, devices } from '@playwright/test';

// Screen tests against a real local Supabase: real sign-in token, database,
// server functions and security rules. `npm run test:e2e:real` builds the app
// against it first (needs `npx supabase start`). The tests share seeded data,
// so they run one at a time, in file order.
export default defineConfig({
  testDir: 'e2e-real',
  globalSetup: './e2e-real/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-real' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8089',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'node e2e/serve.mjs dist-real 8089',
    url: 'http://localhost:8089',
    reuseExistingServer: !process.env.CI,
  },
});
