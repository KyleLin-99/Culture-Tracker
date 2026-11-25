// Test users, labs and clients against a real (local, throwaway) Supabase.
// No app imports here, so both Jest (integration/) and Playwright (e2e-real/) can use it.
import { createHmac, randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';

import type { TestEnv } from './env';

/** Today's date where the tests run (YYYY-MM-DD), the same way the app picks dates (todayLocal). */
export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** An access token for a user, signed like Supabase Auth signs them. */
export function signJwt(secret: string, sub: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, email: `${sub}@test.local` }),
  );
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export type TestUser = { id: string; token: string; client: SupabaseClient };

/** Admin access to the test database, for creating users and checking results. */
export async function adminDb(env: TestEnv): Promise<Client> {
  const db = new Client({ connectionString: env.dbUrl });
  await db.connect();
  // Test runs make many users; the production cap of 25 is covered in pgTAP.
  await db.query("update app_settings set value = '100000' where key = 'max_users'");
  return db;
}

/** A new signed-in user (no lab yet), with a client that acts as them. */
export async function newUser(env: TestEnv, admin: Client): Promise<TestUser> {
  const id = randomUUID();
  await admin.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@test.local`]);
  const token = signJwt(env.jwtSecret, id);
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { id, token, client };
}

/** A new user with their own lab and one strain. */
export async function newLab(env: TestEnv, admin: Client, name = 'Test lab') {
  const user = await newUser(env, admin);
  const { data: accountId, error } = await user.client.rpc('create_account', { p_name: name, p_initials: 'KL' });
  if (error) throw error;
  const strainId = randomUUID();
  const s = await user.client.from('strains').insert({ id: strainId, account_id: accountId, name: 'Blue Oyster' });
  if (s.error) throw s.error;
  return { ...user, accountId: accountId as string, strainId };
}

export function must<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error) throw error;
  return data as T;
}
