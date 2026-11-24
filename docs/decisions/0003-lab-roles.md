# 0003: Lab roles: owner, tech, viewer

**Decided:** 2026-11-24 (Kyle). Design: [docs/design/lab-sharing.md](../design/lab-sharing.md).

**Choice.** Three roles per lab, enforced by row-level security:

- **owner:** everything, including lab settings, members and renaming the lab
- **tech:** records work: strains, cultures, notes, growth checks, runs, batches, recipes
- **viewer:** reads everything, changes nothing except their own initials

Reads use `private.is_member()`, writes `private.can_write()`, lab-wide settings
`private.is_owner()`. People join by a one-time invite code, can belong to several
labs, and owners and techs can share a read-only link to one strain's lineage
(30 days by default).

**Why.** Growers sharing a lab need their own sign-in and initials on labels, and
viewers ("friends") shouldn't be able to change records. Enforcing roles in the
database means every path (app, offline sync, MCP server) gets the same rules.

**Gave up.** Per-record permissions (e.g. "only the tech who made it can edit") and
email invites (they'd need custom SMTP). Both can be added later without
reworking the roles.
