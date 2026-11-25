# Going to production

Status: **plan**, written Nov 24 2026 from Kyle's requirements. Nothing here is built yet.
Items marked **Decision** need Kyle's answer; each has a recommended default so work
isn't blocked.

## Goal

Put Culture Tracker on a real website and in both app stores, for a small closed
group first (25 people), with:

- limits so nobody can flood the database (users, labs, rows, writes),
- plans (Standard, Paid 1, Paid 2, Special) and an Early access cohort,
- a back office to see users and change their plan,
- a feedback form that emails Kyle,
- versions on the website and the apps, with safe releases and rollback.

## 1. Who can do what: four separate ideas

Kyle's six roles mix four different things. Keeping them separate means a paid
user can also be an early tester, and a back-office admin can never be created by
editing a plan.

| Idea | Values | Lives in | Answers |
|---|---|---|---|
| **Lab role** (exists today) | owner, tech, viewer | `members.role` | What can this person do *inside one lab*? |
| **Plan** | `standard`, `paid1`, `paid2`, `special` | `profiles.tier` | How much can they create, and which features do they get? |
| **Flag** | `early_access` | `profiles.early_access` | Do they see features still being tested? Stacks on any plan. |
| **Platform admin** | yes / no | `platform_admins` | Can they use the back office? |

Mapping Kyle's list:

| Kyle's role | How it's modeled |
|---|---|
| Standard (unpaid, limited) | plan `standard` (the default for everyone) |
| Paid 1 | plan `paid1`. Set by hand now; later by a payment webhook. |
| Paid 2 | plan `paid2`. Same. |
| Early access | flag `early_access` on top of any plan |
| Special (people Kyle trusts) | plan `special`: no limits, or very high ones |
| Owner (back office) | `platform_admins` row. Seeded by SQL for Kyle; no screen can add admins. |

Billing is deliberately not built. The plan is just a column an admin edits today
and a payment webhook edits later, so nothing else changes when subscriptions arrive.

### Data model (one migration, `profiles` and friends)

- `profiles(user_id pk, tier, early_access, disabled_at, limit_overrides jsonb, created_at, last_seen_at)`. A row is created by a trigger when a user signs up.
- `platform_admins(user_id pk, created_at)`. No API grants; only `private.is_platform_admin()` reads it.
- `plan_limits(tier, limit_key, value)`; a null value means unlimited. Editable without a deploy.
- `feature_flags(key, enabled, tiers text[], early_access_only, rollout_pct)`.
- `app_settings(key, value jsonb)`: `max_users`, `signups_open`, `min_app_version`, `maintenance_message`.
- `admin_audit(id, admin_id, action, target_user, before, after, at)`.
- `feedback(...)` and `waitlist(...)` (sections 3 and 2).

Every new table keeps the repo rules: RLS, `account_id` where it belongs to a lab
(these are platform tables, so they use `user_id`), new RPCs are `security invoker`
unless they are the admin or signup functions, which are `security definer` with an
explicit check as the first line.

## 2. Limits and the 25-user cap

**Limits are enforced in the database, never only in the app.** The app only shows
them. Triggers run `before insert` and compare the count of live (not deleted) rows
to the limit.

Whose plan applies: the **lab owner's** plan sets that lab's limits, so a tech or
viewer in a Plus lab gets Plus limits. A person's own plan decides how many labs
they can *own* and *join*.

Suggested starting values (all tunable in `plan_limits`; `-` = unlimited):

| Limit | Standard | Paid 1 | Paid 2 | Special |
|---|---|---|---|---|
| Labs owned | 1 | 2 | 5 | - |
| Labs joined (shared with you) | 3 | 10 | 25 | - |
| Members per lab | 5 | 15 | 50 | - |
| Strains per lab | 25 | 150 | 1,000 | - |
| Cultures per lab (all time) | 2,000 | 20,000 | 100,000 | - |
| Batches + runs per lab | 200 | 2,000 | 10,000 | - |
| Recipes per lab | 20 | 100 | 500 | - |
| Active share links | 3 | 25 | 100 | - |
| Pending invites | 5 | 25 | 100 | - |
| Feedback messages per day | 5 | 10 | 20 | 50 |
| Writes per hour per user (all tables) | 600 | 3,000 | 6,000 | - |

How it works with what exists:

- **"1 lab per user, with 3 shares"** becomes *labs owned = 1, labs joined = 3*. A
  viewer who has their own lab and is invited to up to 3 others stays within the
  rule. `create_account()` and `accept_invite()` both check.
- A write refused by a limit comes back as a clear message ("This lab has reached its
  limit of 25 strains on the Standard plan"). Phones that made the change offline see
  it under "Couldn't save", the same as any refused change.
- The write-rate limit stops create/delete loops (we never hard-delete, so counting
  live rows alone isn't enough).
- Anything else that can grow gets a limit when it's built (photos, AI calls).

### The 25-user cap

- `app_settings.max_users = 25`; Kyle can change it in the back office.
- Counted against non-disabled profiles. A `before insert` trigger on `auth.users`
  refuses a new signup at the cap (the backstop).
- The sign-in screen first asks `signup_status()` (callable signed out, returns only
  open/closed) so people at the cap see "We're full right now" and a **waitlist**
  email box instead of a confusing error.
- `signups_open = false` makes it invite-only. Existing users are never blocked.
- Also turn on CAPTCHA for sign-in in Supabase Auth and keep its rate limits.

## 3. Feedback to Kyle's email

- **Send feedback** in Settings: type (bug, idea, question), message (up to 2,000
  characters), and an "include diagnostics" box (app version, platform, OS, lab id,
  screen). Reply-to is the user's own email.
- Saved in `feedback` first, so nothing is lost if email fails. Authenticated users
  can insert (rate limited, 5 a day on Standard); only admins can read.
- A database webhook calls an Edge Function that emails Kyle through a mail service
  (Resend has a free tier). **Kyle's address lives only in the function's secrets**,
  never in the app, so it can't be scraped.
- The back office shows the inbox with new / seen / done.

## 4. Back office

A web-first `/admin` route in the same app, shown only to platform admins. Every
action goes through an `admin_*` `security definer` function that checks
`private.is_platform_admin()` on its first line and writes `admin_audit`.

Version 1:

- **Users:** email, plan, early access, labs owned, last seen, created. Search.
- **User detail:** change plan; toggle early access; disable or enable; set limit
  overrides; usage counts (strains, cultures, writes this week). Disabling signs them
  out and blocks sign-in.
- **Feedback inbox** and **waitlist** (approve = raise the cap or send an invite).
- **Settings:** max users, signups open, minimum app version, maintenance banner.
- **Flags:** turn features on for a plan, for early access, or a percentage.
- **Audit log.**

Principles:

- The back office shows **counts, not culture data**. Lab contents (cultures, notes)
  belong to the lab; admins don't browse them by default. Support access, if ever
  needed, would be an explicit, audited action.
- The first admin is inserted by SQL. No screen can promote an admin.
- Require two-step sign-in (Supabase TOTP) for admin accounts before launch.
- Until it exists, plans can be edited in the Supabase dashboard; the audit log is
  what makes the screen worth building.

## 5. Hardening, before anyone outside the group uses it

**Critical**

1. **Separate staging and production.** Today one Supabase project holds Kyle's real
   lab and test data. Create a second project: production runs only released code.
   The free plan pauses a project after a week of inactivity and has no backups; the
   Pro plan ($25/month) doesn't pause and keeps daily backups for 7 days.
   Migrations apply to staging on merge and to production on release, with approval.
2. **Backups.** Keep the weekly dump already in `.github/workflows/db-backup.yml`
   (point it at production) on top of Pro's daily backups, and test one restore. Lab
   records are irreplaceable. Point-in-time recovery is an optional paid add-on.
3. **Custom email (SMTP).** Supabase's built-in email is for testing and is heavily
   rate limited. Sign-in codes need a real sender on Kyle's domain (SPF and DKIM set
   up) and a branded template.
4. **Account deletion and data export** (the stores require deletion, section 7).
5. **Privacy policy, terms, support contact**, on the website and linked in the app.
6. **Old apps keep working.** Phones hold an offline queue of changes, so a phone
   that hasn't updated can send changes the day after a release. Rules: migrations
   *expand* first and *contract* a release later (never rename or drop in the same
   release); the server accepts the previous app version's calls; and
   `app_settings.min_app_version` makes a too-old app show "Please update" on launch
   and sync instead of failing mysteriously.
7. **Crash and error reporting** (Sentry has a free tier) and an uptime check on the
   website.

**Account deletion rules (Decision)**

- A member deletes their account: they leave their labs, their records keep their
  initials (like `remove_member`), and the sign-in is deleted.
- An owner whose lab has other members must hand over ownership first.
- A sole owner: the lab is soft-deleted, with a 30-day grace period, then purged by a
  scheduled job. That is a documented exception to "never hard-delete": it applies
  only to accounts that asked to be deleted.
- Offer "Download my data" (CSV and JSON) first.

## 6. Versions and releases

- **One version number** (`expo.version` in `app.json`, e.g. 1.0.0) shared by iOS,
  Android and web. Build numbers (`buildNumber`, `versionCode`) are bumped
  automatically by EAS (`appVersionSource: "remote"`, `autoIncrement`).
- **Runtime version policy `appVersion`**, so over-the-air updates only reach apps
  built for that version. Expo's docs recommend a different runtime version for each
  binary version. Native changes (a new module) need a store release; JavaScript-only
  fixes can go out as an update.
- **Channels:** `production` and `staging`. Test builds (TestFlight, Play internal)
  use `staging`; store builds use `production`. An update is published to `staging`,
  tested, then published to `production`. Per-update rollouts send it to a percentage
  of users first.
- **Release = a git tag** (`v1.2.0`). The release workflow runs CI, builds iOS and
  Android, submits to the stores, publishes the update, deploys the web build, and
  creates a GitHub Release with the PR titles as notes. `CHANGELOG.md` is kept from
  those.
- **Show the version:** Settings > About shows `v1.2.0 (build 34) · production`; the
  website footer shows the same. Feedback includes it.
- **Early access / canary:** the same production app can switch to the `staging`
  channel at runtime for users with the `early_access` flag ("channel surfing"), so
  testers get new code first without a separate app.
- **Website rollback:** deployments are immutable and named. Rolling back is pointing
  `production` at the previous one.

## 7. Website

The web app is a static export (`npx expo export --platform web`), so any static host
works.

| Option | Good | Watch out |
|---|---|---|
| **Cloudflare Pages** (recommended) | Free; custom domain included; one-click rollback; preview URL per PR | Separate from the Expo tools |
| **EAS Hosting** | Same tools as the app builds; deployments and aliases | A custom domain is a paid-plan feature, one per project |

Setup: buy a domain (about $12 a year). `app.<domain>` is the app; the root is a
simple landing page (what it is, screenshots, store links, waitlist box) plus
`/privacy`, `/terms` and `/support`. Set `EXPO_PUBLIC_WEB_URL` to the app address so
shared lineage links become normal web links.

**Decision:** host and domain name.

## 8. App stores

**Apple (iOS)**

- Apple Developer Program, $99 a year. TestFlight: internal testers right away;
  external testers need a short Beta App Review.
- Account deletion must be possible **inside the app** for any app with account
  creation (guideline 5.1.1(v)); a link to a web page isn't enough.
- Needed: privacy policy URL, the App Privacy answers (what's collected), age rating,
  screenshots, export-compliance answer (`ITSAppUsesNonExemptEncryption`), the camera
  permission text (already set for QR scanning), support URL.
- **Reviewer login problem:** App Review must sign in, but our sign-in is an emailed
  code they can't receive. Plan: a password sign-in that works only for an
  allow-listed review account, with its details in the review notes.
- `supportsTablet` is `true`, which requires iPad screenshots. Set it to `false` for
  v1 unless the iPad layout is checked.

**Google (Android)**

- Play Console, $25 once. A **personal** account created after Nov 13, 2023 must run a
  closed test with **at least 12 testers opted in continuously for 14 days** before it
  can apply for production access. Organization accounts are exempt but need a
  D-U-N-S number. **Start this clock first**: the 25-user cap fits, but recruit 15 to
  20 testers because dropouts reset the count.
- Needed: Data safety form, content rating, privacy policy, and a way to request
  account deletion (Google asks for a web link as well as in-app; check the form at
  submission).

**Paid plans later:** Apple and Google require their own in-app purchase for digital
subscriptions sold inside the app (and take a share). Web purchases are different.
Decide when paid plans are real; the plan-column design keeps that open (a billing
service like RevenueCat or Stripe would set `profiles.tier`).

## 9. Other things worth doing

**Strongly recommended**

- **Backups-due push notifications.** The most useful feature for a lab: "3 backups
  are due this week". Needs `expo-notifications` and a daily job.
- **First-run guide and sample data** so a new person isn't looking at empty screens.
- **"What's new"** after an update; a **maintenance banner** from `app_settings`.
- **Data export (CSV)** per lab, also a trust builder.
- **Usage dashboard in the back office** (new users, active labs, cultures logged a
  week) to see whether anyone uses it.

**Nice to have**

- Invite codes that grant a plan or early access (hand a friend "special").
- Status page, announcements, in-app help links with diagnostics.
- Install-to-home-screen web app (PWA), dark mode, an accessibility pass.
- Lab ownership transfer; "leave lab" for members.

## 10. Build order

Each is a stacked PR with tests and docs, as before.

**Phase 0: accounts (Kyle)**: domain, Apple Developer, Google Play, second Supabase
project, mail service, Sentry.

**Phase 1: foundation**
1. Staging and production environments; CI applies migrations.
2. Versioning and release pipeline, About screen, `min_app_version` check.
3. Error reporting and custom email.

**Phase 2: access control**
4. Profiles, plans, flags, limits, enforcement, the 25-user cap and waitlist, labs
   owned/joined limits.
5. Back office v1 and admin audit log.
6. Feedback.
7. Account deletion and data export.
8. Legal pages and the landing site.

**Phase 3: private beta**: web live on the domain; TestFlight and Google closed test
(start the 14-day clock); the 25 people; a human validation run covering all of it.

**Phase 4: store launch**: listings, review, v1.0.0.

**Phase 5: after launch**: paid plans, notifications, photos, AI features.

## Decisions for Kyle (recommended default first)

| # | Decision | Default |
|---|---|---|
| 1 | Who gets in once 25 is reached | Waitlist; Kyle approves from the back office |
| 2 | Standard plan limits | The table above |
| 3 | Sole owner deletes their account | Export offered, then 30-day grace, then purge |
| 4 | Website host | Cloudflare Pages |
| 5 | Google Play account type | Personal, with 15 to 20 testers for the 14 days |
| 6 | iPad support in v1 | Off (`supportsTablet: false`) |
| 7 | Reviewer sign-in | Password sign-in for one allow-listed account |
| 8 | Changelog | GitHub auto-generated release notes |

## Sources

- Google Play testing requirements for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- Apple, offering account deletion in your app: https://developer.apple.com/support/offering-account-deletion-in-your-app
- Expo, EAS Update deployment, channels and runtime versions: https://docs.expo.dev/eas-update/deployment
- Expo, EAS Update rollouts: https://docs.expo.dev/eas-update/rollouts/
- Expo, EAS Hosting custom domain: https://docs.expo.dev/eas/hosting/custom-domain/
- Supabase pricing: https://supabase.com/pricing
