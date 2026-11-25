# Launch setup: what only you can do

The code for versions, plans and limits, the back office, feedback and account deletion is in pull requests #32–#36 (stacked, merge in that order). These are the steps that need your accounts. Do them roughly in this order; each says what it unlocks.

## 1. After merging the PRs

```powershell
git checkout main; git pull; npm install; npx supabase db push --remote
```

Then, **before anyone else signs in**, run this once in the Supabase SQL editor (your email) so your own account is Special and an admin (otherwise you are Standard: 1 lab owned):

```sql
update public.profiles set tier = 'special', early_access = true
 where user_id = (select id from auth.users where email = 'you@example.com');
insert into public.platform_admins (user_id)
 select id from auth.users where email = 'you@example.com' on conflict do nothing;
```

Home now shows **Back office**.

## 2. Two Supabase projects (unlocks safe testing)

- Make a second project for **staging**; keep the current one as **production**.
- Production: upgrade to Pro (backups; the free plan pauses after a week idle).
- Point `.github/workflows/db-backup.yml` at production's database URL secret.
- In **both**: Auth → set a custom SMTP sender (see 3). The built-in email sender is for testing only and is rate limited.

## 3. Domain and email (unlocks real sign-in codes and feedback email)

1. Buy a domain; add it to Cloudflare.
2. Resend: add the domain, verify DNS, make an API key.
3. Supabase → Auth → SMTP: use Resend's SMTP details. Keep the email template containing `{{ .Token }}`.
4. Feedback email: `npx supabase secrets set RESEND_API_KEY=... FEEDBACK_TO=you@... FEEDBACK_FROM="Culture Tracker <feedback@yourdomain>"` then `npx supabase functions deploy send-feedback`.

## 4. Website (unlocks the link people open)

Cloudflare Pages, build command `npx expo export --platform web`, output `dist`. Set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `EXPO_PUBLIC_WEB_URL` (the app's address, for share links). Use `app.<domain>` for the app. Still to write: the landing page with `/privacy`, `/terms` and `/support` (the stores require them).

## 5. Expo / EAS (unlocks store builds and over-the-air updates)

Steps are in `docs/RELEASING.md`: `eas login`, `eas init`, `eas update:configure`, add `EXPO_TOKEN` to GitHub secrets, then one development build (`eas build --profile development`) because the app now includes `expo-updates`.

## 6. App stores

- **Apple Developer Program** ($99/year). The app has in-app account deletion (required). Apple's reviewer can't receive emailed codes, so **reviewer password sign-in for one allow-listed account is still to be built**; tell me when you have the account and I will add it.
- **Google Play** ($25). A personal account made after Nov 13, 2023 needs a **closed test with 12+ testers for 14 days** before production. Recruit 15 to 20 testers early.
- Store listing needs: privacy policy URL, support URL, screenshots, a data-safety form (email address, notes you type; no tracking).

## 7. Nice to have before opening up

- **Sentry** (crash reports): make a project, then I wire in the DSN.
- **CAPTCHA** on sign-up/waitlist (Supabase Auth → Attack protection) before the waitlist form is public.
- Billing (RevenueCat/Stripe) later; plans are already in the database.

## Checklist for validation Run 3 (the new features)

Test on web first, then on a phone development build.

1. **About**: Home → About shows `vX.Y.Z · no channel` on web (a build number and channel on a store/dev build).
2. **Plans**: as a Standard test user, creating a second lab says "plan's limit for labs you own (1)". As you (Special) you can make more.
3. **Cap**: in Back office set "Most people" to the current number; signing in with a brand-new email shows "We're full" and Join the waitlist. Existing people still sign in. Approve the email in Back office → Waitlist; the new email can now sign in. Put the cap back.
4. **Close sign-ups** toggle in Back office blocks new people the same way; reopen it.
5. **Update gate**: set "Oldest app version allowed" to 99.0.0; the app shows "Please update". Set it back to 0.0.0. Set a notice; it appears above every screen; clear it.
6. **Back office**: change a test user's plan and early access; the Audit log shows both. A normal user sees no Back office button, and opening `/admin` shows a refusal.
7. **Feedback**: Home → Send feedback; it appears in Back office → Feedback inbox (and in your email once step 3 is done). Mark it done. Sending more than 5 in a day as a Standard user is refused.
8. **Export**: Your account → Export cultures (CSV) opens in a spreadsheet with the right codes and parents; JSON downloads.
9. **Delete account** (use a throwaway user): it leaves shared labs, shows "set to be deleted" with a date, "Keep my account" brings everything back. To test the purge, set that user's `purge_after` into the past in SQL and run `select public.admin_purge_due_accounts();` as the admin (or wait for the 04:17 UTC job).
