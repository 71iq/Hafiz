# SDK 55 alignment preflight

Status on 2026-10-16: RF-067 is approved for the bounded runtime alignment below. RF-008 remains pending and unapproved for full-project diagnostics and lint/native configuration decisions. No application dependency, lockfile, patch, native configuration or root toolchain change has been applied yet.

## Candidate patch set

Keep Expo SDK 55, RN 0.83 and React 19.2.0. Expo's SDK 55 matrix and public package metadata produced these candidate ranges. RF-067 owns exactly these manifest ranges and the existing Babel preset declaration below. Its controller gates must still verify the actual installed graph, web app and Android build. The isolated preflight does not establish application compatibility by itself.

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
| babel-preset-expo  | 55.0.22, transitive    | ~55.0.25        |

Direct expo-modules-core has no authored caller in app, components, lib, scripts or tests. Expo 55.0.31 depends on exact core 55.0.26. RF-067 removes the direct declaration, subject to autolinking and native build verification. Keep the existing CSS interop patch and Gradle fix. Do not change Quran inputs or generate a new database.

Sources: [SDK 55 compatibility](https://docs.expo.dev/versions/v55.0.0/), [official upgrade procedure](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/), [Expo 55.0.31 metadata](https://registry.npmjs.org/expo/55.0.31), [Router 55.0.18 metadata](https://registry.npmjs.org/expo-router/55.0.18), [SQLite patch history](https://github.com/expo/expo/blob/sdk-55/packages/expo-sqlite/CHANGELOG.md). Exact package metadata and integrity values are saved in ignored .refactor-baseline/sdk55-selected-registry.json.

## Initial strict-resolution failures

All resolution experiments ran in new ignored directories with lifecycle scripts disabled. The original manifest, lock and node_modules remain unchanged. No force, legacy-peer-deps, diagnostic exclusion or billing change was used.

- The unchanged manifest and lock pass npm 11.16 strict peer resolution.
- The full candidate with the original lock fails ERESOLVE. npm attempts an Expo 58 and React 19.3 peer set while the root still requires Expo 55 and React 19.2.0. Explicit package arguments, prefer-dedupe and a direct SDK 55 Metro runtime constraint do not resolve it.
- A fresh candidate lock fails because the existing react-test-renderer caret range selects 19.3.1 against React 19.2.0. Do not replace the root lock with this bulk refresh.
- npm 11.21.0 was installed only into an ignored isolated tools directory. It moves past the first conflict, then encounters optional DOM type peers. A matching DOM type constraint and an exact renderer pin move to a virtualized-lists conflict that attempts RN 0.88. A scoped native peer constraint does not resolve it. None of these experimental manifest constraints is approved.
- The RN 0.83.10-only candidate also fails strict resolution through virtualized-lists selecting RN 0.88. This prevents assuming that splitting only RN automatically makes the update safe.

Evidence and exact argv are under .refactor-baseline/sdk55-resolution. Preserve these failures. The resolved-graph check below now distinguishes speculative optional-peer failures from the selected lock. Do not treat a failed proposed graph as proof that the currently installed app cannot build. The lint preset's separate maintenance and rule-coverage gaps remain recorded in TECH_STACK.md.

## Resolved-graph preflight

Installed npm 11.16 resolves the candidate through its existing default policy without warnings or bypass flags. `npm ls --all --package-lock-only --json` then passes. A strict reinstall of that resolved lock also passes and leaves its bytes unchanged. Isolated npm 12.2.0 produces the same successful sequence; no npm toolchain upgrade is needed or adopted. Evidence .refactor-baseline/sdk55-resolution/npm11-standard/results.json and npm12-standard/recheck-strict.json.

The selected lock keeps Expo 55.0.31, Router 55.0.18, RN 0.83.10 and React/DOM/renderer 19.2.0. RSC and DOM types remain absent. This indicates that the initial strict failures occurred while considering absent optional peer candidates, not because the final selected graph has those packages. No project rule, peer range or diagnostic was disabled. RF-067 repeats both strict installation and full graph validation against the actual root installation.

Primary review identified one real undeclared dependency: babel.config.js imports babel-preset-expo, but the original 17-target lock would keep it only under Expo. Declare the already-used preset as devDependency ~55.0.25, matching Expo's dependency. A fresh 18-target preflight also passes default resolution, full graph validation and an unchanged strict reinstall. Evidence .refactor-baseline/sdk55-resolution/sdk55-with-declared-preset/results.json. The existing NativeWind JSX configuration stays unchanged. [Preset metadata](https://registry.npmjs.org/babel-preset-expo/55.0.25).

The lock review permits the required Expo/Metro/RN family changes and existing Router web dependencies. React Navigation resolves from 7.1.31 to 7.5.1, within its existing major/range, because updated bottom-tabs/native-stack require ^7.5.1. Other direct resolved versions stay fixed. Existing shell-quote/tar overrides remain. The earlier runtime/type/peer constraints remain unadopted. No root dependency installation has run yet.

## Native dependency gate

Run `node scripts/ralph/check-expo-native.cjs`. It resolves Expo's actual autolinking CLI and checks Android and iOS dependency graphs separately. It requires the expected Expo, SQLite and RN entries, rejects malformed output, duplicate groups and direct expo-modules-core. It reuses the official scanner because the raw verify command returns zero even when it reports duplicates. A merged native scan can also hide a missing module on one platform.

The gate currently fails as expected: both graphs contain duplicate @expo/log-box and the root declares expo-modules-core. Android reports 38 modules and iOS reports 39. Evidence .refactor-baseline/native-gate-before-sdk55.log. Keep autolinking exclusions/configuration unchanged so filtering cannot hide a failure. A dependency graph check does not compile Android or iOS.

Before RF-008 can pass, require strict compatible resolution, preserved security overrides, the existing native patches, this native gate, targeted and full Expo diagnostics, types, unit tests, web export, browser smoke and Android debug compilation. Report iOS compilation as unavailable on this Linux host. Keep the lint and native configuration findings visible until their actual repairs or reviewed decisions are complete.

## Browser and build gates

The bundled Chromium installer rejects this host as unsupported ubuntu26.04-x64. The existing Google Chrome channel works through Playwright. playwright.config.ts now permits PLAYWRIGHT_CHROMIUM_CHANNEL explicitly while preserving the default choice. CI=1 still requires a fresh web server and does not reuse an unrelated process. No browser installation was replaced. [Playwright browser channels](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge).

The pre-upgrade smoke command passed all 28 tests in 39 seconds at 390 by 844, including the Arabic dark-theme verse deep link. It used installed Chrome, CI=1 and the explicit loopback URL/port from RF-067. Evidence .refactor-baseline/rf067-browser-before-sdk.json. These are desktop browser checks with a phone viewport, not physical-device tests. RF-067 reruns them after installation and web export.

Android verification uses the existing debug keystore, JDK 21 and SDK 36 with assembleDebug only. Never install the APK, clear device state, generate signing material or regenerate the native project. Keep the 900-second per-check limit. If a native timeout occurs, inspect actual Gradle/Java children and writer leases before resuming. iOS compilation remains unavailable on this Linux host.
