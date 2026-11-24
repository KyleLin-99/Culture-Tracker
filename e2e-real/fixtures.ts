// Signs the browser in as the seeded user of the local test Supabase.
import { readFileSync } from 'node:fs';

import { test as base, type Page } from '@playwright/test';
import { Client } from 'pg';

import { loadTestEnv } from '../integration/env';

import { SEED_FILE } from './global-setup';

export type Seed = { url: string; token: string; userId: string; accountId: string; ids: Record<string, string> };

export const test = base.extend<{ seed: Seed; signedIn: Page; db: Client }>({
  seed: async ({}, use) => {
    await use(JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Seed);
  },
  signedIn: async ({ page, seed }, use) => {
    const key = `sb-${new URL(seed.url).hostname.split('.')[0]}-auth-token`;
    const session = {
      access_token: seed.token,
      refresh_token: 'not-used',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: seed.userId, aud: 'authenticated', role: 'authenticated', email: `${seed.userId}@test.local`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    };
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(session)]);
    await use(page);
  },
  /** Admin access to the test database, to check what the screens saved. */
  db: async ({}, use) => {
    const env = loadTestEnv();
    const client = new Client({ connectionString: env!.dbUrl });
    await client.connect();
    await use(client);
    await client.end();
  },
});

export { expect } from '@playwright/test';
