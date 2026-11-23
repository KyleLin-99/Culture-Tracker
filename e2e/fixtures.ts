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

export type Lab = {
  items: Row[];
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
    if (path.startsWith('/rest/v1/events')) return json([]);

    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice('/rest/v1/rpc/'.length);
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      lab.rpcCalls.push({ fn, body });

      if (fn === 'item_lineage') return json(lineage(lab.items, String(body.p_item_id)));
      if (fn === 'strain_tree') return json(lineage(lab.items, 'o-tbg'));
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
    await use({ items: seedItems(), rpcCalls: [] });
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
