# Releasing

One version number, `expo.version` in `app.json` (semver), is shared by iOS, Android and web. The store build numbers (`ios.buildNumber`, `android.versionCode`) are kept by EAS (`appVersionSource: "remote"`, `autoIncrement`), so never edit them by hand.

## Channels

| Channel | Who gets it | Built by |
|---|---|---|
| `development` | dev builds | `eas build --profile development` |
| `staging` | testers, early-access users | `eas build --profile staging` |
| `production` | everyone | `eas build --profile production` |

`runtimeVersion` follows the app version (`policy: appVersion`): an over-the-air update only reaches builds with the same `version`. Bump `version` whenever native code changes (a new native module, an SDK upgrade); JS-only fixes ship as updates with `eas update --channel <channel>`.

## Cutting a release

1. Bump `version` in `app.json` in a PR; merge it.
2. Tag the merge commit: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The **Release** workflow checks the tag matches `app.json`, runs `npm run check`, queues EAS production builds for both platforms and drafts a GitHub Release with generated notes. Edit and publish the draft.
4. Submit to the stores with `eas submit` once the builds finish (first time: set up credentials interactively).

The **About** screen shows `vX.Y.Z (build N) · channel`, so a tester can say exactly what they run.

## One-time setup (needs your Expo account)

- `npx eas-cli@latest login`, then `eas init` (links the project) and `eas update:configure` (adds `updates.url` to `app.json`).
- Add the repository secret `EXPO_TOKEN` (expo.dev → Access tokens).
- Because `expo-updates` and `expo-application` are native modules, make a new development build once (`eas build --profile development`); Expo Go can't run them all. The About screen still works in Expo Go and on web.

## Database changes and old phones

Phones keep an offline outbox, so an old app may talk to a newer database. Use expand/contract migrations: add the new thing first, ship the app, remove the old thing in a later release.
