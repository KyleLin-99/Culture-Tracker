# Culture Tracker MCP server

Lets Claude (or any MCP client) answer questions from **your** lab:

- "What's the lineage of S-2A1?"
- "Trace the contamination from the last month."
- "What's my contamination rate by sterilization run this quarter?"
- "Which backups are due?"

It's **read-only** (every tool is marked read-only and only reads), and it signs in
as you, so Supabase's row-level security limits it to your lab, exactly like the app.

## Set up (once)

Needs Node 22+.

```powershell
cd mcp-server
npm install
npm run build
```

Sign in with the same email code as the app. The values are the ones in the app's
`.env` (`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`):

```powershell
$env:SUPABASE_URL = "https://<your-project-ref>.supabase.co"
$env:SUPABASE_ANON_KEY = "<publishable key, sb_publishable_...>"
npm run login
```

This saves a session in `~/.culture-tracker-mcp/session.json`, readable only by
you. It refreshes itself as it's used; run `npm run login` again if it ever expires.
Delete that file to sign out.

## Add it to Claude

In Claude Desktop: **Settings → Developer → Edit Config**, and add (use your
own path and values):

```json
{
  "mcpServers": {
    "culture-tracker": {
      "command": "node",
      "args": ["C:\\Users\\Kyle\\Desktop\\CultureTracker\\Culture-Tracker\\mcp-server\\dist\\index.js"],
      "env": {
        "SUPABASE_URL": "https://<your-project-ref>.supabase.co",
        "SUPABASE_ANON_KEY": "<publishable key, sb_publishable_...>"
      }
    }
  }
}
```

Restart Claude Desktop. The tools appear under the culture-tracker server.

## Tools

See [docs/ai/mcp-tools.md](../docs/ai/mcp-tools.md) for each tool's inputs and an
example answer.

| Tool | Answers |
|---|---|
| `find_culture` | Cultures by code (exact or starting with) |
| `culture_lineage` | A culture's ancestors and descendants as a tree |
| `strain_tree` | A strain's whole family tree |
| `contamination_trace` | Likely causes of contamination, ranked by p-value |
| `lab_stats` | Contamination rate by recipe / run / batch / generation / month / strain, and growth by strain |
| `backups_due` | Backups past their refresh age |

## Development

```bash
npm test                 # tools, through a real MCP client against a fake lab
npm run typecheck
npm run test:integration # the built server over stdio against a local Supabase
                         # (npx supabase start in the repo root first)
```

The anon key is public by design (the app ships it); the session file is what
proves it's you, so keep it private.
