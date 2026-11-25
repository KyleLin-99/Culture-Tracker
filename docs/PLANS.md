# Plans, limits and the user cap

Three separate ideas, so they never get tangled:

- **Lab role** (owner, tech, viewer): what you may do inside one lab. Unchanged.
- **Plan** (`profiles.tier`: `standard`, `paid1`, `paid2`, `special`): how much you may create. Set by the back office (or, later, billing), never by the person.
- **Early access** (`profiles.early_access`): may switch to the staging release channel.

## Limits (table `plan_limits`; empty = unlimited)

| Limit | Standard | Paid 1 | Paid 2 | Special |
|---|---|---|---|---|
| Labs owned | 1 | 2 | 5 | unlimited |
| Labs joined | 3 | 10 | 25 | unlimited |
| Members per lab | 5 | 15 | 50 | unlimited |
| Strains | 25 | 150 | 1,000 | unlimited |
| Cultures (all time, removed ones count) | 2,000 | 20,000 | 100,000 | unlimited |
| Media batches + sterilization runs | 200 | 2,000 | 10,000 | unlimited |
| Recipes | 20 | 100 | 500 | unlimited |
| Active share links | 3 | 25 | 100 | unlimited |
| Pending invites | 5 | 25 | 100 | unlimited |

How they are enforced (`supabase/migrations/*_plans_and_limits.sql`):

- A lab's limits come from the **lab owner's** plan (first owner); labs owned/joined come from the **person's own** plan. A paid person who joins a standard owner's lab gets that lab's limits there.
- `before insert` triggers refuse the new row with `limit_reached:<key>:<value>` (SQLSTATE `LM001`). The app turns that into a sentence (`src/domain/errors.ts`). Existing rows are never touched, so lowering a limit can't break a lab.
- Not enforced yet: writes per hour, feedback per day (added with feedback).

Change a limit with SQL (the back office will do this later):

```sql
update plan_limits set value = 50 where tier = 'standard' and limit_key = 'strains';
```

## The 25-user cap and the waitlist

- `app_settings`: `max_users` (25), `signups_open`, `min_app_version`, `maintenance_message`.
- A trigger on `auth.users` refuses a **new** person (SQLSTATE `LM002`) when signups are closed or the count of users has reached `max_users`, unless their email is on the waitlist with `approved_at` set. People who already have an account sign in as usual.
- The sign-in screen shows "We're full right now" with a waitlist form when that happens. `join_waitlist(email)` is callable signed out (capped at 5,000 rows; add CAPTCHA before opening to the public).
- `signup_status()` (callable signed out, `security definer`, reads settings only) also feeds the "Please update" gate and the notice banner.

## One-time SQL for you (run in the Supabase SQL editor)

Make your own account Special and a platform admin (replace the email):

```sql
update public.profiles set tier = 'special', early_access = true
 where user_id = (select id from auth.users where email = 'you@example.com');
insert into public.platform_admins (user_id)
 select id from auth.users where email = 'you@example.com' on conflict do nothing;
```

Approve someone from the waitlist (until the back office exists):

```sql
update public.waitlist set approved_at = now() where email = 'person@example.com';
```

## Back office

Home → **Back office** (shown only to platform admins; `am_i_admin()`). Online only; nothing is kept on the phone.

- **Overview**: people vs cap, labs, waitlist, people per plan.
- **Settings**: open/close sign-ups, most people, oldest app version allowed, a notice shown to everyone.
- **Users**: search by email; set plan, give or remove early access. Shows plan, joined, last sign-in and lab *counts*; never lab records.
- **Waitlist**: approve an email so it can sign up even when full.
- **Feature flags**: off / early access / everyone. The app reads `my_flags()`.
- **Audit log**: every change above, with who and when.

Every `admin_*` function is `security definer`, checks `private.is_platform_admin()` first and writes `admin_audit`. Who is an admin is changed only by SQL (see above), never from the app. Limits per plan can be changed with `admin_set_limit(tier, key, value)` (no screen yet).

## Feedback

Home → **Send feedback** (bug / idea / question, optional app version and device type; never lab records). `send_feedback()` saves it first, so nothing is lost, and enforces `feedback_per_day` (Standard 5, Paid 1 10, Paid 2 20, Special 50). The app then asks the `send-feedback` Edge Function to email it; the back-office **Feedback inbox** shows everything, including anything that was not emailed.

Your address is kept only in the function's secrets, never in the app or the database. One-time setup (needs a Resend account and a verified sending domain):

```bash
npx supabase secrets set RESEND_API_KEY=re_... FEEDBACK_TO=you@example.com FEEDBACK_FROM="Culture Tracker <feedback@yourdomain.com>"
npx supabase functions deploy send-feedback
```

Until that is done the function answers "Email is not set up yet" and feedback still lands in the inbox.

## Your account: export and deletion

Home → **Your account**.

- **Export**: the whole lab (including removed items) as JSON, or the cultures as a CSV (`export_lab()`; emails are never included, members appear by initials). On the web it downloads; on a phone it opens the share sheet.
- **Delete my account** (`request_account_deletion()`), a documented exception to "never hard-delete":
  - Labs shared with others: you leave at once; your records stay with your initials.
  - Only owner of a lab with other people: refused until someone else is made an owner (or the others are removed).
  - Labs only you use: kept for **30 days** (you can cancel on the next sign-in), then deleted with the account.
  - During the grace period the app shows only "Keep my account / Sign out".
- The purge (`private.purge_due_accounts()`) runs daily at 04:17 UTC through pg_cron where available; otherwise run **Back office → admin_purge_due_accounts()** (callable by admins) by hand. A lab that gained members during the grace period passes to its longest-standing member instead of being deleted.
