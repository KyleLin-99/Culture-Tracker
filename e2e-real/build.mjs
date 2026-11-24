// Builds the web app against the local test Supabase (npx supabase start),
// for the real-backend screen tests.
import { execSync, spawnSync } from 'node:child_process';

function status() {
  try {
    const out = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out.slice(out.indexOf('{')));
  } catch {
    return {};
  }
}
const pick = (src, ...res) => {
  for (const re of res) {
    const k = Object.keys(src).find((x) => re.test(x));
    if (k && src[k]) return src[k];
  }
};

let url = process.env.SUPABASE_URL;
let key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  const s = status();
  url ??= pick(s, /^API_URL$/i, /api.?url/i);
  key ??= pick(s, /^ANON_KEY$/i, /anon.?key/i, /publishable/i);
}
if (!url || !key) {
  console.error('Local Supabase not found. Start it with: npx supabase start');
  process.exit(1);
}

const r = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-real'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, EXPO_NO_TELEMETRY: '1' },
});
process.exit(r.status ?? 1);
