// Signing in: the same email code as the app. The session (a refresh token) is
// saved in your home folder, readable only by you, and refreshed as it's used.

import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Config = { url: string; anonKey: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY (the same values as EXPO_PUBLIC_SUPABASE_* in the app\'s .env).');
  }
  return { url, anonKey };
}

export function sessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.CULTURE_TRACKER_SESSION ?? join(homedir(), '.culture-tracker-mcp', 'session.json');
}

function save(path: string, session: { refresh_token: string; user_email?: string }) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
  chmodSync(path, 0o600);
}

const client = (c: Config) =>
  createClient(c.url, c.anonKey, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } });

/** Interactive: emails a code, asks for it, saves the session. */
export async function login(config: Config, ask: (q: string) => Promise<string>, path = sessionPath()): Promise<string> {
  const db = client(config);
  const email = (await ask('Email you sign in to Culture Tracker with: ')).trim();
  const sent = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (sent.error) throw new Error(sent.error.message);
  const code = (await ask('Code from the email: ')).trim();
  const { data, error } = await db.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error || !data.session) throw new Error(error?.message ?? 'Sign-in failed');
  save(path, { refresh_token: data.session.refresh_token, user_email: email });
  return email;
}

/**
 * A signed-in client for the server. CULTURE_TRACKER_ACCESS_TOKEN (tests, CI)
 * takes precedence over the saved session.
 */
export async function signedInClient(config: Config, env: NodeJS.ProcessEnv = process.env): Promise<SupabaseClient> {
  const token = env.CULTURE_TRACKER_ACCESS_TOKEN;
  if (token) {
    return createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }
  const path = sessionPath(env);
  let saved: { refresh_token: string; user_email?: string };
  try {
    saved = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Not signed in. Run: npx culture-tracker-mcp login');
  }
  const db = client(config);
  const { data, error } = await db.auth.refreshSession({ refresh_token: saved.refresh_token });
  if (error || !data.session) throw new Error(`Session expired (${error?.message ?? 'no session'}). Run login again.`);
  save(path, { ...saved, refresh_token: data.session.refresh_token });
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && session) save(path, { ...saved, refresh_token: session.refresh_token });
  });
  return db;
}
