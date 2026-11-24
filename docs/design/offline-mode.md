# Design: offline mode (Milestone 2)

Status: **built**: offline reading (PR #10) and offline writing (`feat/offline-writes`). Decisions: see [Decisions](#decisions).

## Goal

Every action in the lab works with no signal: look up a code, transfer, back up, mark contaminated, add a note. Changes sync when the phone is back online, and nothing is lost or duplicated.

## How it works

```
 screen ──► local SQLite (expo-sqlite) ──► outbox ──► Supabase (when online)
   ▲              ▲                                        │
   └── reads ─────┘◄────────── pull changes since last sync ┘
```

1. **Reads come from the phone.** A local SQLite copy of the lab's rows (strains, items, events, batches, runs). Screens read only from it, so they're instant and work offline.
2. **Writes go to the phone first.** Each action writes local rows and appends an entry to an `outbox` table: the operation and its arguments, with ids generated on the phone (UUIDs).
3. **Push.** When online, the outbox is sent in order. Each entry is idempotent (same id twice = no-op), so a retry after a dropped connection can't duplicate anything.
4. **Pull.** After pushing, fetch every row with `updated_at` newer than the last sync, per table, and upsert locally. Soft deletes (`deleted_at`) come down like any other change.
5. **Status.** A small banner: "Offline · 3 changes waiting" / "Synced 2 min ago".

The schema already supports this: UUIDs, `updated_at` on every table, soft deletes, and one function (`src/lib/api.ts`) per action to reroute.

## The hard part: culture codes offline

Codes come from a culture's position under its parent (`S-2A` is the first child of `S-2`). Offline, the phone works out the next position from its local copy, the same way the server does (`src/domain/cultureCode.ts` already mirrors the rules and is tested against them).

Conflict case: two devices both offline create a child of the same parent, and both pick `S-2C`. The label is already written on a plate.

**Decided: first to sync keeps the code.** The other culture is renumbered (S-2C → S-2D) and flagged "Relabel" on the home screen until you confirm you relabeled the plate. With one person and one phone this should almost never happen.

Rejected: reserving numbers per device (gaps in numbering read oddly on labels) and blocking offline transfers (defeats the purpose in the flow hood).

## Decisions

| Question | Decision | Why |
|---|---|---|
| Two offline devices pick the same code | First to sync keeps it; the other is renumbered and flagged "Relabel" | No gaps in numbering; conflicts are rare |
| History kept on the phone | All strains, active items, and anything from the last 12 months with its events; older records load when online | Small, fast local copy that covers real lab work |
| Web dashboard offline | No: phone only; the web keeps talking to Supabase directly | Avoids expo-sqlite on web and its browser setup |
| Server rejects a queued change | Roll it back on the phone and show the change with the reason in the sync banner | Nothing fails silently; the server's rules stay in charge |

The server's rules stay in charge in every case: the database still validates codes, the 20-character limit and permissions when changes arrive.

## Plan

1. ✅ Local schema + migrations in `src/offline/schema.ts` (mirrors the Supabase tables the app reads).
2. ✅ Pull sync (read-only offline): `src/offline/sync.ts`, `engine.ts`; screens read from SQLite through `src/lib/api.ts`.
3. ✅ Outbox + push for transfers, backups, origins, status changes, notes and strains (`src/offline/outbox.ts`, `writer.ts`). Media batches, sterilization runs and recipes stay online-only for now (the phone keeps a read-only copy for pickers).
4. ✅ Conflict handling per the decision above, with a "Relabel these plates" list (`apply_items` + `relabels` on the server).
5. ✅ Sync status: header badge, home-screen summary with changes waiting.

## Tests

- **Jest**: outbox ordering and retry, idempotency, next-position calculation against a local tree, conflict renumbering.
- **pgTAP**: re-sending the same insert (same UUID) is a no-op; server-assigned position wins on conflict.
- **Device check before merge**: airplane mode, create 10 plates, reconnect, confirm codes and counts on the web dashboard.

## Order relative to sharing and roles

Sharing a lab with other people (roles: owner, tech, viewer) comes after this. Sync has to respect what each role may write, so roles change the push step. Designing both before building either keeps sync from being reworked.

## What step 1 does (built)

- **Local copy:** expo-sqlite on phones (`openDb.native.ts`); none on web (`openDb.ts`).
- **First pull:** all strains, runs and batches; items that are active or made in the last 365 days, plus every ancestor of those (so lineage is complete offline); events from the last 365 days. Pages of 500.
- **Later pulls:** every row changed since the last pull, minus a 5-minute overlap to catch late commits. Soft deletes come down like any change.
- **When it syncs:** on sign-in, when the app returns to the foreground, when the connection comes back, every 2 minutes, and right after each saved change.
- **Reads:** once the first pull finishes, lookups, culture screens, lineage, strain trees, strains, batches, runs and recipes read from the phone. The contamination trace still needs a connection.
- **Status:** an "Offline" badge in the header; a "Synced 4 min ago · works offline" line on the home screen.
- **Sign-out** removes the lab from the phone; a different lab signing in starts a fresh copy.
- **Tests:** `src/offline/__tests__/` run the real sync and queries against SQLite (sql.js) and check the local lineage and tree order match the server functions.

## What step 2 does (built)

- **Saving on the phone:** transfers, backups, new origins, status changes, notes (including edits and removals) and new strains are applied to the local copy at once and queued in an `outbox` table. Editing or removing a note that hasn't been sent yet changes the queued note instead of queueing a second change, so a removed unsent note never reaches the server. Codes are planned locally (`src/offline/planner.ts`) with the same rules as the database, including the 20-character limit.
- **Sending:** each sync sends the queue in order before pulling. Every change carries ids made on the phone, and the server functions (`apply_items`, `apply_status`, `apply_event`) ignore a change they've already applied, so a retry after a dropped connection never duplicates anything. Pulls never overwrite a change still waiting to be sent.
- **Conflicts:** if another device already used a position, `apply_items` takes the next free one and writes a `relabels` row (old code → new code). Children follow their renumbered parent. The home screen lists them under **Relabel these plates** until you tap Done (on phone or web).
- **Refusals:** if the server rejects a change, it's undone on the phone along with any queued change that builds on it, and listed under **Couldn't save** with the reason until dismissed.
- **Online:** the same path runs, then syncs at once, so the screen shows the server's final codes.
- **Tests:** 18 pgTAP tests for the server functions (idempotency, renumbering, cascading relabels, isolation); 11 Jest tests run the whole flow on SQLite against a fake server with the same rules (offline queueing, ordered sending, half-sent retries, conflicts, cascading rollback).
