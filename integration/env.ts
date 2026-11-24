// Where the throwaway local Supabase is. CI sets these from `supabase status`;
// locally they're read from `npx supabase status` (Docker Desktop + `npx supabase start`).
import { execSync } from 'node:child_process';

export type TestEnv = { url: string; anonKey: string; jwtSecret: string; dbUrl: string };

function fromStatus(): Record<string, string> {
  try {
    const out = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out.slice(out.indexOf('{')));
  } catch {
    return {};
  }
}

/** Finds a value by the first key name that matches, across CLI versions' naming. */
function pick(src: Record<string, string>, ...patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const key = Object.keys(src).find((k) => re.test(k));
    if (key && src[key]) return src[key];
  }
  return undefined;
}

export function loadTestEnv(): TestEnv | null {
  const e = process.env;
  let url = e.SUPABASE_URL, anonKey = e.SUPABASE_ANON_KEY, jwtSecret = e.SUPABASE_JWT_SECRET, dbUrl = e.SUPABASE_DB_URL;
  if (!url || !anonKey || !jwtSecret || !dbUrl) {
    const s = fromStatus();
    url ??= pick(s, /^API_URL$/i, /api.?url/i);
    anonKey ??= pick(s, /^ANON_KEY$/i, /anon.?key/i, /publishable/i);
    jwtSecret ??= pick(s, /^JWT_SECRET$/i, /jwt.?secret/i);
    dbUrl ??= pick(s, /^DB_URL$/i, /db.?url/i);
  }
  return url && anonKey && jwtSecret && dbUrl ? { url, anonKey, jwtSecret, dbUrl } : null;
}
