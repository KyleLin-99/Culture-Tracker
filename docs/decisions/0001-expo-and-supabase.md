# 0001: Expo + Supabase, hosted, free tiers

**Decision:** One TypeScript codebase with Expo (iOS, Android, web) on hosted Supabase (Postgres, Auth, row-level security).

**Why:** Developing on Windows, Expo builds and tests iOS without a Mac and renders a real web dashboard. Supabase gives Postgres (recursive lineage queries, SQL functions for contamination tracing) with auth and per-account security, at $0 for one user.

**Gave up:** Flutter's pixel-perfect custom drawing; self-hosting on Kubernetes. Everything is standard Postgres + Supabase, so a later move to self-hosting changes one URL.
