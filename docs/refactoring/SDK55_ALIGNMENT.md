# SDK 55 alignment preflight

Status on 2026-10-16: research only. RF-008 is pending and unapproved. No application dependency, lockfile, patch, native configuration or root toolchain change has been applied.

## Candidate patch set

Keep Expo SDK 55, RN 0.83 and React 19.2.0. Expo's SDK 55 matrix and public package metadata produced these candidate ranges. These are not installation instructions or an approved task. Check current metadata and resolve the complete peer graph before approval.

| Package            | Installed lock version | Candidate range |
| ------------------ | ---------------------- | --------------- |
| expo               | 55.0.26                | ~55.0.31        |
| expo-asset         | 55.0.17                | ~55.0.20        |
| expo-audio         | 55.0.14                | ~55.0.18        |
| expo-clipboard     | 55.0.9                 | ~55.0.17        |
| expo-constants     | 55.0.16                | ~55.0.17        |
| expo-dev-client    | 55.0.34                | ~55.0.40        |
| expo-haptics       | 55.0.9                 | ~55.0.18        |
| expo-image-picker  | 55.0.20                | ~55.0.24        |
| expo-linking       | 55.0.7                 | ~55.0.17        |
| expo-router        | 55.0.3                 | ~55.0.18        |
| expo-sharing       | 55.0.20                | ~55.0.24        |
| expo-splash-screen | 55.0.21                | ~55.0.25        |
| expo-sqlite        | 55.0.10                | ~55.0.20        |
| expo-status-bar    | 55.0.4                 | ~55.0.6         |
| expo-web-browser   | 55.0.9                 | ~55.0.20        |
| react-native       | 0.83.2                 | 0.83.10         |
| jest-expo          | 55.0.18                | ~55.0.22        |

Direct expo-modules-core has no authored caller in app, components, lib, scripts or tests. Expo 55.0.31 depends on exact core 55.0.26. Removal of the direct declaration is a candidate, subject to autolinking and native build verification. Keep the existing CSS interop patch and Gradle fix. Do not change Quran inputs or generate a new database.

Sources: [SDK 55 compatibility](https://docs.expo.dev/versions/v55.0.0/), [official upgrade procedure](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/), [Expo 55.0.31 metadata](https://registry.npmjs.org/expo/55.0.31), [Router 55.0.18 metadata](https://registry.npmjs.org/expo-router/55.0.18), [SQLite patch history](https://github.com/expo/expo/blob/sdk-55/packages/expo-sqlite/CHANGELOG.md). Exact package metadata and integrity values are saved in ignored .refactor-baseline/sdk55-selected-registry.json.

## Resolution evidence

All resolution experiments ran in new ignored directories with lifecycle scripts disabled. The original manifest, lock and node_modules remain unchanged. No force, legacy-peer-deps, diagnostic exclusion or billing change was used.

- The unchanged manifest and lock pass npm 11.16 strict peer resolution.
- The full candidate with the original lock fails ERESOLVE. npm attempts an Expo 58 and React 19.3 peer set while the root still requires Expo 55 and React 19.2.0. Explicit package arguments, prefer-dedupe and a direct SDK 55 Metro runtime constraint do not resolve it.
- A fresh candidate lock fails because the existing react-test-renderer caret range selects 19.3.1 against React 19.2.0. Do not replace the root lock with this bulk refresh.
- npm 11.21.0 was installed only into an ignored isolated tools directory. It moves past the first conflict, then encounters optional DOM type peers. A matching DOM type constraint and an exact renderer pin move to a virtualized-lists conflict that attempts RN 0.88. A scoped native peer constraint does not resolve it. None of these experimental manifest constraints is approved.
- The RN 0.83.10-only candidate also fails strict resolution through virtualized-lists selecting RN 0.88. This prevents assuming that splitting only RN automatically makes the update safe.

Evidence and exact argv are under .refactor-baseline/sdk55-resolution. Preserve these failures. Diagnose the peer solver and optional peer behavior before selecting another installation strategy. Do not treat a failed proposed graph as proof that the currently installed app cannot build. The lint preset's separate maintenance and rule-coverage gaps remain recorded in TECH_STACK.md.

## Native dependency gate

Run `node scripts/ralph/check-expo-native.cjs`. It resolves Expo's actual autolinking CLI and checks Android and iOS dependency graphs separately. It requires the expected Expo, SQLite and RN entries, rejects malformed output, duplicate groups and direct expo-modules-core. It reuses the official scanner because the raw verify command returns zero even when it reports duplicates. A merged native scan can also hide a missing module on one platform.

The gate currently fails as expected: both graphs contain duplicate @expo/log-box and the root declares expo-modules-core. Android reports 38 modules and iOS reports 39. Evidence .refactor-baseline/native-gate-before-sdk55.log. Keep autolinking exclusions/configuration unchanged so filtering cannot hide a failure. A dependency graph check does not compile Android or iOS.

Before RF-008 can pass, require strict compatible resolution, preserved security overrides, the existing native patches, this native gate, targeted and full Expo diagnostics, types, unit tests, web export, browser smoke and Android debug compilation. Report iOS compilation as unavailable on this Linux host. Keep the lint and native configuration findings visible until their actual repairs or reviewed decisions are complete.
