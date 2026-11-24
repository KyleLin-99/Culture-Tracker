// The lab's MCP server: read-only tools over a grower's own lab. Answers are short
// text (what an assistant quotes back) plus structured content for clients that use it.
// Rates and due dates use the app's own logic (src/domain), so answers match the app.

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { backupsDue, dueText, refreshDays } from '../../src/domain/backups';
import { normalizeCode } from '../../src/domain/cultureCode';
import { formatRate } from '../../src/domain/growth';
import { contaminationBy, DIMENSION_LABEL, type Dimension, growthByStrain, overall } from '../../src/domain/stats';
import type { Medium } from '../../src/domain/types';

import type { Lab, LookupRow, TreeRow } from './lab';

/** Today's date where the grower is (YYYY-MM-DD), not UTC. */
export function localDate(daysAgo = 0, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;

type Result = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const text = (t: string, data?: Record<string, unknown>): Result => ({
  content: [{ type: 'text', text: t }],
  ...(data ? { structuredContent: data } : {}),
});
const problem = (t: string): Result => ({ content: [{ type: 'text', text: t }], isError: true });

/** One line per culture, indented by depth: "  S-2A · agar · active · 11/20/26". */
export function renderTree(rows: TreeRow[], highlightId?: string): string {
  const min = Math.min(0, ...rows.map((r) => r.depth));
  return rows
    .map((r) => {
      const mark = r.id === highlightId ? ' ←' : '';
      return `${'  '.repeat(r.depth - min)}${r.code} · ${r.medium} · ${r.status} · ${r.made_on}${mark}`;
    })
    .join('\n');
}

/** Finds one culture by code; codes repeat across strains, so a strain name can narrow it. */
async function findOne(lab: Lab, code: string, strain?: string): Promise<LookupRow | string> {
  const exact = (await lab.lookupCode(normalizeCode(code))).filter((r) => r.exact);
  const matches = strain ? exact.filter((r) => r.strain_name.toLowerCase() === strain.trim().toLowerCase()) : exact;
  if (!matches.length) return `No culture with code ${normalizeCode(code)}${strain ? ` in ${strain}` : ''}.`;
  if (matches.length > 1) {
    return `${normalizeCode(code)} is in more than one strain (${matches.map((m) => m.strain_name).join(', ')}). Say which strain.`;
  }
  return matches[0];
}

const DIMENSIONS = ['recipe', 'run', 'batch', 'generation', 'month', 'strain'] as const;

export function createLabServer(lab: Lab, today: () => string = () => localDate()): McpServer {
  const server = new McpServer({ name: 'culture-tracker', version: '0.1.0' });

  server.registerTool(
    'find_culture',
    {
      title: 'Find a culture',
      description:
        'Look up cultures by culture code (e.g. "S-2A1", "TBG-3"). Matches the code exactly, or codes that start with it. Spaces and case are ignored.',
      inputSchema: z.object({ code: z.string().min(1).describe('Culture code or the start of one') }),
      annotations: READ_ONLY,
    },
    async ({ code }) => {
      const rows = await lab.lookupCode(normalizeCode(code));
      if (!rows.length) return text(`No culture with a code starting ${normalizeCode(code)}.`, { cultures: [] });
      const lines = rows.map((r) => `${r.code} (${r.strain_name}) · ${r.medium} · ${r.status} · made ${r.made_on} by ${r.initials}${r.exact ? '' : ' [starts with]'}`);
      return text(lines.join('\n'), { cultures: rows });
    },
  );

  server.registerTool(
    'culture_lineage',
    {
      title: 'Culture lineage',
      description:
        "A culture's ancestors and descendants, as an indented tree from the oldest ancestor down. Use direction 'up' for where it came from, 'down' for what was made from it.",
      inputSchema: z.object({
        code: z.string().min(1).describe('Culture code, e.g. "S-2A1"'),
        strain: z.string().optional().describe('Strain name, if the code exists in more than one strain'),
        direction: z.enum(['up', 'down', 'both']).default('both'),
      }),
      annotations: READ_ONLY,
    },
    async ({ code, strain, direction }) => {
      const found = await findOne(lab, code, strain);
      if (typeof found === 'string') return problem(found);
      const rows = await lab.itemLineage(found.id, direction);
      return text(`${found.code} (${found.strain_name}):\n${renderTree(rows, found.id)}`, { culture: found, lineage: rows });
    },
  );

  server.registerTool(
    'strain_tree',
    {
      title: 'Strain family tree',
      description: "Every culture in a strain, from its origins (spore prints, clones, vendor cultures) down.",
      inputSchema: z.object({ strain: z.string().min(1).describe('Strain name, e.g. "Blue Oyster"') }),
      annotations: READ_ONLY,
    },
    async ({ strain }) => {
      const all = await lab.strains();
      const s = all.find((x) => x.name.toLowerCase() === strain.trim().toLowerCase());
      if (!s) return problem(`No strain called ${strain}. Strains: ${all.map((x) => x.name).join(', ') || 'none yet'}.`);
      const rows = await lab.strainTree(s.id);
      return text(rows.length ? `${s.name}:\n${renderTree(rows)}` : `${s.name} has no cultures yet.`, { strain: s, tree: rows });
    },
  );

  server.registerTool(
    'contamination_trace',
    {
      title: 'Contamination trace',
      description:
        'What contaminated plates share that clean ones do not (parent culture, media batch, sterilization run, recipe, day made), ranked by Fisher exact p-value, with relative risk. Use it to find the likely cause of contamination.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(3650).default(60).describe('Plates made in the last N days'),
        strain: z.string().optional().describe('Limit to one strain'),
      }),
      annotations: READ_ONLY,
    },
    async ({ days, strain }) => {
      let strainId: string | null = null;
      if (strain) {
        const s = (await lab.strains()).find((x) => x.name.toLowerCase() === strain.trim().toLowerCase());
        if (!s) return problem(`No strain called ${strain}.`);
        strainId = s.id;
      }
      const rows = await lab.trace(localDate(days, new Date(`${today()}T12:00:00`)), today(), strainId);
      if (!rows.length) return text(`No contaminated plates in the last ${days} days${strain ? ` for ${strain}` : ''}.`, { causes: [] });
      const top = rows.slice(0, 8).map((r) => {
        const strong = r.p_value < 0.05 ? ' (unlikely to be chance)' : '';
        return `${r.factor} ${r.label}: ${r.contaminated_with} of ${r.contaminated_total} contaminated plates vs ${r.clean_with} of ${r.clean_total} clean; relative risk ${r.relative_risk}, p = ${r.p_value.toFixed(3)}${strong}`;
      });
      return text(`Likely causes, strongest first (last ${days} days):\n${top.join('\n')}`, { causes: rows });
    },
  );

  server.registerTool(
    'lab_stats',
    {
      title: 'Lab stats',
      description:
        'Contamination rate of transfers and backups made in the last N days, grouped by recipe, sterilization run, media batch, generation, month or strain, plus average growth rate per strain from growth checks.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(3650).default(90),
        group_by: z.enum(DIMENSIONS).default('recipe'),
      }),
      annotations: READ_ONLY,
    },
    async ({ days, group_by }) => {
      const rows = await lab.statsRows(localDate(days, new Date(`${today()}T12:00:00`)), today());
      const all = overall(rows);
      if (!all.total) return text(`No transfers or backups in the last ${days} days.`, { overall: all, groups: [], growth: [] });
      const groups = contaminationBy(rows, group_by as Dimension);
      const growth = growthByStrain(rows, await lab.checks(rows.map((r) => r.id)));
      const lines = [
        `Last ${days} days: ${all.contaminated} of ${all.total} plates contaminated (${pct(all.rate)}).`,
        `By ${DIMENSION_LABEL[group_by as Dimension].toLowerCase()}:`,
        ...groups.map((g) => `  ${g.label}: ${g.contaminated} of ${g.total} (${pct(g.rate)})`),
      ];
      if (growth.length) {
        lines.push('Growth by strain:');
        for (const g of growth) {
          const parts = [
            g.mmPerDay !== null ? formatRate(g.mmPerDay, 'mmPerDay') : null,
            g.percentPerDay !== null ? formatRate(g.percentPerDay, 'percentPerDay') : null,
            g.daysToFull !== null ? `full in ${g.daysToFull} days` : null,
          ].filter(Boolean);
          lines.push(`  ${g.name}: ${parts.join(', ')} (${g.cultures} culture${g.cultures === 1 ? '' : 's'})`);
        }
      }
      return text(lines.join('\n'), { overall: all, groups, growth });
    },
  );

  server.registerTool(
    'backups_due',
    {
      title: 'Backups due',
      description:
        "Active backups (slants, LC, agar) past their refresh age or due within 14 days, using the lab's refresh ages.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const [backups, settings] = await Promise.all([lab.activeBackups(), lab.backupRefreshSettings()]);
      const due = backupsDue(
        backups.map((b) => ({ ...b, medium: b.medium as Medium })),
        refreshDays(settings),
        today(),
      );
      if (!due.length) return text('No backups due in the next 14 days.', { due: [] });
      const lines = due.map((d) => `${d.backup.code}${d.backup.strains ? ` (${d.backup.strains.name})` : ''}: ${dueText(d.overdueDays)}, ${d.backup.medium} made ${d.backup.made_on}`);
      return text(lines.join('\n'), { due: due.map((d) => ({ code: d.backup.code, due_on: d.dueOn, overdue_days: d.overdueDays })) });
    },
  );

  return server;
}
