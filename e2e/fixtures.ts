// A fake Supabase for the screen tests: a small lab (one strain, a TBG chain)
// served from memory, plus a record of every RPC call so tests can check what
// the app sent.
import { test as base, type Page, type Route } from '@playwright/test';

const USER_ID = '00000000-0000-4000-8000-00000000000a';
const ACCOUNT_ID = '00000000-0000-4000-8000-0000000000ac';
const STRAIN_ID = '00000000-0000-4000-8000-000000000051';
const MADE_ON = '2026-11-23';

type Row = Record<string, unknown> & { id: string; code: string; parent_id: string | null };

function item(id: string, code: string, kind: string, medium: string, generation: number, parent: string | null, status = 'active'): Row {
  return {
    id, account_id: ACCOUNT_ID, strain_id: STRAIN_ID, parent_id: parent, kind, medium,
    origin_prefix: kind === 'origin' ? code : null, origin_number: null,
    position: kind === 'transfer' ? 1 : null, backup_number: kind === 'backup' ? 1 : null,
    code, generation, status, location: null, made_on: MADE_ON, initials: 'KL', notes: null,
    created_at: `${MADE_ON}T12:00:00Z`, strains: { name: 'Blue Oyster' },
    media_batch_id: null, media_batches: null,
  };
}

/** The lab every test starts with. */
export function seedItems(): Row[] {
  return [
    item('o-tbg', 'TBG', 'origin', 'culture', 0, null),
    item('t-1', 'TBG-1', 'transfer', 'agar', 1, 'o-tbg'),
    item('t-2', 'TBG-2', 'transfer', 'agar', 1, 'o-tbg'),
    item('t-3', 'TBG-3', 'transfer', 'agar', 1, 'o-tbg'),
    item('t-2a', 'TBG-2A', 'transfer', 'agar', 2, 't-2'),
    item('t-3a', 'TBG-3A', 'transfer', 'lc', 2, 't-3'),
    item('t-3b', 'TBG-3B', 'transfer', 'lc', 2, 't-3', 'contaminated'),
  ];
}

const session = () => ({
  access_token: 'e2e-access',
  refresh_token: 'e2e-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: USER_ID, email: 'kyle@example.com', aud: 'authenticated', role: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: '2026-11-16T00:00:00Z',
  },
});

/** Rows in tree order with depth relative to `rootId`, the way item_lineage returns them. */
function lineage(items: Row[], rootId: string) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows: (Row & { depth: number })[] = [];
  const ancestors: Row[] = [];
  for (let p = byId.get(rootId)?.parent_id; p; p = byId.get(p)?.parent_id) ancestors.unshift(byId.get(p)!);
  ancestors.forEach((a, i) => rows.push({ ...a, depth: i - ancestors.length }));
  const walk = (id: string, depth: number) => {
    rows.push({ ...byId.get(id)!, depth });
    items.filter((c) => c.parent_id === id).forEach((c) => walk(c.id, depth + 1));
  };
  walk(rootId, 0);
  return rows;
}

/** Lab records every test starts with: one run and one agar batch made in it. */
export function seedRecords() {
  const run = { id: 'run-1', account_id: ACCOUNT_ID, code: 'SR-001', method: 'pressure_cooker', psi: 15, minutes: 90, run_on: MADE_ON, notes: null, created_at: `${MADE_ON}T10:00:00Z` };
  const batch = { id: 'mb-1', account_id: ACCOUNT_ID, code: 'MB-001', kind: 'agar', recipe: 'MEA 2%', sterilization_run_id: 'run-1', made_on: MADE_ON, notes: null, created_at: `${MADE_ON}T11:00:00Z`, sterilization_runs: { code: 'SR-001' } };
  return { runs: [run] as Record<string, unknown>[], batches: [batch] as Record<string, unknown>[] };
}

/** One saved recipe: MEA 2%, version 1, for 500 ml. */
export function seedRecipes(): Record<string, unknown>[] {
  return [
    {
      id: 'rc-mea-1', account_id: ACCOUNT_ID, family_id: 'fam-mea', version: 1, name: 'MEA 2%', kind: 'agar', volume_ml: 500,
      ingredients: [
        { name: 'Light malt extract', amount: 10, unit: 'g' },
        { name: 'Agar', amount: 10, unit: 'g' },
      ],
      steps: 'Cook 45 min at 15 psi', created_at: `${MADE_ON}T09:00:00Z`, deleted_at: null,
    },
  ];
}

/** TBG-2's history: a transfer (fixed) and a note (editable). */
export function seedEvents(): Record<string, unknown>[] {
  return [
    { id: 'ev-transfer', account_id: ACCOUNT_ID, item_id: 't-2', type: 'transferred', note: '1 × agar: TBG-2A', contam_type: null, occurred_at: `${MADE_ON}T12:00:00Z`, deleted_at: null },
    { id: 'ev-note', account_id: ACCOUNT_ID, item_id: 't-2', type: 'note', note: 'Slow growth', contam_type: null, occurred_at: `${MADE_ON}T13:00:00Z`, deleted_at: null },
  ];
}

/** What contamination_trace() returns in the screen tests (the SR-002 example). */
export const TRACE_ROWS = [
  { factor: 'media_batch', factor_id: 'mb-2', label: 'MB-002', contaminated_with: 4, clean_with: 1, contaminated_total: 5, clean_total: 12, rate_with: 0.8, rate_without: 0.083, relative_risk: 9.6, p_value: 0.00986 },
  { factor: 'sterilization_run', factor_id: 'run-2', label: 'SR-002', contaminated_with: 4, clean_with: 1, contaminated_total: 5, clean_total: 12, rate_with: 0.8, rate_without: 0.083, relative_risk: 9.6, p_value: 0.00986 },
  { factor: 'parent', factor_id: 't-1', label: 'TBG-1', contaminated_with: 1, clean_with: 5, contaminated_total: 5, clean_total: 12, rate_with: 0.167, rate_without: 0.364, relative_risk: 0.46, p_value: 0.93 },
];

export type Lab = {
  items: Row[];
  runs: Record<string, unknown>[];
  batches: Record<string, unknown>[];
  /** Every saved recipe version. */
  recipes: Record<string, unknown>[];
  /** History entries (notes, transfers…) by item. */
  events: Record<string, unknown>[];
  /** Plates to relabel after an offline code conflict. */
  relabels: Record<string, unknown>[];
  /** Every insert the app made: table and request body. */
  inserts: { table: string; body: Record<string, unknown> }[];
  /** Every RPC call the app made: function name and request body. */
  rpcCalls: { fn: string; body: Record<string, unknown> }[];
};

async function mockSupabase(page: Page, lab: Lab) {
  await page.route('http://127.0.0.1:54321/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const path = url.pathname;

    if (path.startsWith('/auth/v1/user')) return json(session().user);
    if (path.startsWith('/auth/v1/otp')) return json({});
    if (path.startsWith('/rest/v1/members')) {
      return json([{ account_id: ACCOUNT_ID, user_id: USER_ID, role: 'owner', initials: 'KL', accounts: { name: "Kyle's Lab" } }]);
    }
    if (path.startsWith('/rest/v1/strains')) {
      const s = { id: STRAIN_ID, account_id: ACCOUNT_ID, name: 'Blue Oyster', species: 'Pleurotus ostreatus', notes: null, created_at: MADE_ON };
      return json(single ? s : [s]);
    }
    if (path.startsWith('/rest/v1/items')) {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      if (single && id) return json(lab.items.find((i) => i.id === id) ?? {}, lab.items.some((i) => i.id === id) ? 200 : 406);
      return json([...lab.items].reverse());
    }
    if (path.startsWith('/rest/v1/events')) {
      if (req.method() === 'POST') {
        const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
        lab.inserts.push({ table: 'events', body });
        const row = { id: `ev-${lab.events.length + 1}`, occurred_at: new Date().toISOString(), contam_type: null, deleted_at: null, ...body };
        lab.events.push(row);
        return json(single ? row : [row], 201);
      }
      const itemId = url.searchParams.get('item_id')?.replace(/^eq\./, '');
      return json(lab.events.filter((e) => e.item_id === itemId && !e.deleted_at).reverse());
    }
    if (path.startsWith('/rest/v1/recipes')) {
      const family = url.searchParams.get('family_id')?.replace(/^eq\./, '');
      return json(lab.recipes.filter((r) => !family || r.family_id === family));
    }
    if (path.startsWith('/rest/v1/relabels')) {
      if (req.method() === 'PATCH') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
        lab.inserts.push({ table: 'relabels:update', body: { id, ...body } });
        lab.relabels = lab.relabels.filter((r) => r.id !== id);
        return json([]);
      }
      return json(lab.relabels);
    }

    // Sterilization runs and media batches: list, and insert with an automatic code.
    for (const [table, rows, prefix] of [
      ['sterilization_runs', lab.runs, 'SR'],
      ['media_batches', lab.batches, 'MB'],
    ] as const) {
      if (!path.startsWith(`/rest/v1/${table}`)) continue;
      if (req.method() === 'POST') {
        const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
        lab.inserts.push({ table, body });
        const run = lab.runs.find((r) => r.id === body.sterilization_run_id);
        const row = {
          id: `${prefix.toLowerCase()}-${rows.length + 1}`,
          code: `${prefix}-${String(rows.length + 1).padStart(3, '0')}`,
          created_at: new Date().toISOString(),
          ...body,
          ...(table === 'media_batches'
            ? {
                sterilization_runs: run ? { code: run.code } : null,
                recipes: (() => {
                  const r = lab.recipes.find((x) => x.id === body.recipe_id);
                  return r ? { name: r.name, version: r.version } : null;
                })(),
              }
            : {}),
        };
        rows.unshift(row);
        return json(single ? row : [row], 201);
      }
      const kind = url.searchParams.get('kind')?.replace(/^eq\./, '');
      return json(rows.filter((r) => !kind || r.kind === kind));
    }

    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice('/rest/v1/rpc/'.length);
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      lab.rpcCalls.push({ fn, body });

      if (fn === 'item_lineage') return json(lineage(lab.items, String(body.p_item_id)));
      if (fn === 'strain_tree') return json(lineage(lab.items, 'o-tbg'));
      if (fn === 'contamination_trace') return json(TRACE_ROWS);
      if (fn === 'save_recipe') {
        const family = (body.p_family_id as string | null) ?? `fam-${lab.recipes.length + 1}`;
        const version = lab.recipes.filter((r) => r.family_id === family).length + 1;
        const row = {
          id: `rc-${lab.recipes.length + 1}`, account_id: ACCOUNT_ID, family_id: family, version, name: body.p_name,
          kind: body.p_kind, volume_ml: body.p_volume_ml, ingredients: body.p_ingredients, steps: body.p_steps,
          created_at: new Date().toISOString(), deleted_at: null,
        };
        lab.recipes.push(row);
        return json(row);
      }
      if (fn === 'archive_recipe') {
        lab.recipes.filter((r) => r.family_id === body.p_family_id).forEach((r) => (r.deleted_at = new Date().toISOString()));
        return json(null);
      }
      if (fn === 'edit_note') {
        const e = lab.events.find((x) => x.id === body.p_id);
        if (!e) return json({ message: 'Note not found' }, 400);
        if (body.p_delete) e.deleted_at = new Date().toISOString();
        else e.note = body.p_note;
        return json(e);
      }
      if (fn === 'lookup_code') {
        const q = String(body.p_query);
        return json(
          lab.items
            .filter((i) => i.code.startsWith(q))
            .map((i) => ({ ...i, strain_name: 'Blue Oyster', exact: i.code === q })),
        );
      }
      if (fn === 'create_transfers' || fn === 'create_backups') {
        const parent = lab.items.find((i) => i.id === body.p_parent_id)!;
        const backup = fn === 'create_backups';
        const siblings = lab.items.filter((i) => i.parent_id === parent.id && (i.kind === 'backup') === backup).length;
        const made = Array.from({ length: Number(body.p_count) }, (_, n) => {
          const k = siblings + n + 1;
          const code = backup ? `${parent.code}(${k})` : `${parent.code}${/[0-9]$/.test(parent.code) ? String.fromCharCode(64 + k) : k}`;
          return item(`${parent.id}-${backup ? 'b' : 't'}${k}`, code, backup ? 'backup' : 'transfer', String(body.p_medium), Number(parent.generation), parent.id);
        });
        lab.items.push(...made);
        return json(made);
      }
      return json({ message: `Unmocked RPC ${fn}` }, 404);
    }
    return json({ message: `Unmocked ${req.method()} ${path}` }, 404);
  });
}

/**
 * `lab`: the fake lab for this test.
 * `signedIn`: a page with a saved session, so the app opens past sign-in.
 */
export const test = base.extend<{ lab: Lab; signedIn: Page }>({
  lab: async ({}, use) => {
    await use({ items: seedItems(), ...seedRecords(), recipes: seedRecipes(), events: seedEvents(), relabels: [], inserts: [], rpcCalls: [] });
  },
  page: async ({ page, lab }, use) => {
    await mockSupabase(page, lab);
    await use(page);
  },
  signedIn: async ({ page }, use) => {
    // supabase-js stores the session under sb-<first part of the host>-auth-token.
    await page.addInitScript((s) => localStorage.setItem('sb-127-auth-token', s), JSON.stringify(session()));
    await use(page);
  },
});

export { expect } from '@playwright/test';
