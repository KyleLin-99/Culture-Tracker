# MCP tools

The lab's MCP server (`mcp-server/`) exposes six read-only tools. Each returns a
short text answer (what an assistant quotes back) and the same data as
`structuredContent`. All of them run as the signed-in grower, so row-level security
limits them to that grower's lab.

| Tool | Inputs | Wraps | Example answer |
|---|---|---|---|
| `find_culture` | `code` (exact or the start) | `lookup_code()` | `S-2A (Blue Oyster) · agar · active · made 2026-11-01 by KL` |
| `culture_lineage` | `code`, optional `strain` (when the code is in two strains), `direction` up/down/both | `item_lineage()` | An indented tree from the oldest ancestor, the culture marked `←` |
| `strain_tree` | `strain` (name, any case) | `strain_tree()` | The strain's whole indented tree |
| `contamination_trace` | `days` (default 60), optional `strain` | `contamination_trace()` | `sterilization_run SR-007: 4 of 5 contaminated plates vs 1 of 12 clean; relative risk 10, p = 0.004 (unlikely to be chance)` |
| `lab_stats` | `days` (default 90), `group_by` recipe/run/batch/generation/month/strain | `stats_rows()` + growth checks | `Last 30 days: 1 of 2 plates contaminated (50%).` then one line per group and growth by strain |
| `backups_due` | none | active backups + lab settings | `S-2(1) (Blue Oyster): 27 days overdue, slant made 2026-05-01` |

Errors (no such culture or strain, a code in two strains) come back as tool
errors with a sentence saying what to do, e.g. `S is in more than one strain
(Blue Oyster, King). Say which strain.`

Rates, due dates and grouping use the app's own code (`src/domain/`), so the
server and the app always agree.

## Adding a tool

1. A read in `mcp-server/src/lab.ts` (an existing SQL function if there is one).
2. The tool in `mcp-server/src/tools.ts`, with `annotations: READ_ONLY`.
3. A test in `mcp-server/test/tools.test.ts`, and a check in
   `mcp-server/test/server.int.test.ts` if it needs the real database.

Write tools (e.g. "mark S-2A contaminated") are deliberately not here yet: per the
roadmap's guardrails, AI suggests and a person confirms before records change.
