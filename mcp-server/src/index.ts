#!/usr/bin/env node
// culture-tracker-mcp: a read-only MCP server for your Culture Tracker lab.
//   culture-tracker-mcp login   sign in once (email code), saves the session
//   culture-tracker-mcp         run the server over stdio (what Claude starts)

import { createInterface } from 'node:readline/promises';

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { supabaseLab } from './lab';
import { loadConfig, login, signedInClient } from './session';
import { createLabServer } from './tools';

async function main() {
  const config = loadConfig();
  if (process.argv[2] === 'login') {
    // stdout is free here (not the MCP channel), but keep prompts on stderr for consistency.
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const email = await login(config, (q) => rl.question(q));
    rl.close();
    console.error(`Signed in as ${email}. Add the server to Claude (see mcp-server/README.md).`);
    return;
  }
  const db = await signedInClient(config);
  const server = createLabServer(supabaseLab(db));
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  // Never write to stdout: it's the MCP channel.
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
