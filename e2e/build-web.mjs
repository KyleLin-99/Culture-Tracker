// Builds the web app for the screen tests, pointed at a fake Supabase URL that
// the tests intercept. Values set here win over anything in your .env file.
import { spawnSync } from 'node:child_process';

export const FAKE_SUPABASE_URL = 'http://127.0.0.1:54321';

const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-e2e'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    EXPO_PUBLIC_SUPABASE_URL: FAKE_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e',
    EXPO_NO_TELEMETRY: '1',
  },
});

process.exit(result.status ?? 1);
