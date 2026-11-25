// Emails one saved feedback message to the app's owner through Resend.
//
// The app saves feedback with send_feedback() first (so nothing is lost), then
// calls this function with { id }. The caller must be signed in and own that
// row. Secrets (set with `supabase secrets set`): RESEND_API_KEY, FEEDBACK_TO
// (the owner's address), FEEDBACK_FROM (a sender on your verified domain).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: who } = await asUser.auth.getUser();
  if (!who.user) return reply(401, { error: 'Sign in first' });

  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== 'string') return reply(400, { error: 'Missing id' });

  // Row-level security: the caller can only read their own feedback.
  const { data: row } = await asUser.from('feedback').select('*').eq('id', id).maybeSingle();
  if (!row) return reply(404, { error: 'Not found' });
  if (row.emailed_at) return reply(200, { ok: true, already: true });

  const key = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('FEEDBACK_TO');
  const from = Deno.env.get('FEEDBACK_FROM');
  if (!key || !to || !from) return reply(503, { error: 'Email is not set up yet' });

  const diag = Object.entries(row.diagnostics ?? {}).map(([k, v]) => `${esc(k)}: ${esc(String(v))}`).join('<br>');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: who.user.email,
      subject: `[Culture Tracker ${row.kind}] ${row.message.slice(0, 60)}`,
      html: `<p>${esc(row.message).replace(/\n/g, '<br>')}</p><hr><p>From ${esc(who.user.email ?? 'unknown')}<br>${diag}</p>`,
    }),
  });
  if (!res.ok) return reply(502, { error: 'The email service refused it' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  await admin.from('feedback').update({ emailed_at: new Date().toISOString() }).eq('id', id);
  return reply(200, { ok: true });
});
