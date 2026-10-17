# Unused-code analysis

Measured on 2026-10-17 with Knip 6.41.0 after RF-078. This is an analysis calibration. No source, export or dependency is removed by RF-009.

## Roots and exclusions

Expo Router discovers files under `app/`, so those routes and layouts are entries. Tests, root configuration and maintained scripts are entries too. Nested `.cjs` diagnostics under `scripts/ralph/` must participate in dependency analysis.

The installed Metro plugin defaults to a `src/` platform pattern. Hafiz uses root-level `components/` and `lib/`. Four exact entries cover the demonstrated platform resolution paths, without making every component an entry. See [Knip Metro configuration](https://knip.dev/reference/plugins/metro) and [entry configuration](https://knip.dev/overview/configuration).

| Entry                                        | Actual owner                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `components/zayt/ZaytRivePreview.native.tsx` | `app/zayt-preview.tsx` imports the extensionless preview; Metro chooses native. Imports the Rive native package. |
| `components/zayt/ZaytRivePreview.web.tsx`    | The same route resolves the web preview. Imports the Rive web package.                                           |
| `lib/database/native-loaders.web.ts`         | `lib/database/init.ts` imports extensionless native-loaders; web uses these platform stubs.                      |
| `lib/fonts/qpc-v4-tajweed-fonts.web.ts`      | `lib/fonts/loader.ts` imports the extensionless page-font map; web resolves WOFF2 URLs.                          |

Keep the existing exclusions. Each has a specific reason.

| Exclusion                                              | Reason                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `assets/**`                                            | Protected bundled Quran/content/font inputs, outside authored-code deletion analysis.                                              |
| `public/**`                                            | Generated runtime web copies. Inspect the source pipeline separately.                                                              |
| `supabase/**`                                          | Server infrastructure has separate runtime and authorization boundaries. This client analysis does not establish server dead code. |
| `quran.com-frontend-next/**`                           | Excluded external reference project.                                                                                               |
| `lib/database/native-loaders.native.ts`                | Protected generated native require map. Runtime asset selection is not evidence for deleting it.                                   |
| `lib/translations/translation-requires.ts`             | Protected generated translation require map.                                                                                       |
| `scripts/ralph/vendor/**`                              | Pinned third-party runner, preserved unchanged.                                                                                    |
| `@expo/metro-runtime`, `react-dom`, `react-native-web` | Existing Expo-managed web/runtime exceptions remain. This task adds no dependency suppression.                                     |

## Measured findings

Both actual Knip commands return 1 because findings remain. A successful analysis with findings is not a clean result. Configuration or execution errors must still fail verification. The task gate parses the real report and retains `AuthGate` as a negative control. See [Knip exit codes](https://knip.dev/reference/cli).

| Finding category                | Before | Calibrated |
| ------------------------------- | -----: | ---------: |
| Unused files                    |      5 |          1 |
| Unused dependencies             |      3 |          0 |
| Unused development dependencies |      1 |          0 |
| Unused exports                  |      5 |          5 |
| Unused exported types           |      2 |          2 |
| Duplicate-export groups         |      2 |          2 |
| Unlisted dependencies           |      4 |          5 |
| External binaries               |      1 |          1 |
| Unresolved imports              |      0 |          0 |

Rive's two packages and its required Nitro peer become reachable through platform entries. The Supabase CLI becomes reachable through the nested security diagnostic. The same diagnostic exposes `react-devtools-core` as an unlisted direct import. No package was installed or removed.

## Disposition

| Finding                                                                            | Next action                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `components/ui/AuthGate.tsx`                                                       | RF-010 must confirm no native/web caller and remove only this file plus its RTL registry record. It is not approved for deletion by this report alone. |
| `readDefaultDeckFilter`, `MirroredPressableRow`, `ReviewRecord`                    | Used inside their own files. RF-082 must assess removing unnecessary exports, preserving implementations.                                              |
| `isRetentionCardSaved`, `addRetentionCard`, `rtlComponentRegistryByPath`, `Locale` | RF-082 must inspect callers and side effects before preparing exact deletion or visibility tasks.                                                      |
| `TAFSIR_SOURCES`/`AVAILABLE_TAFSIR_SOURCES`                                        | Same registry object with consumers of both names. Retain pending contextual API review; do not duplicate or alter content.                            |
| Husary/default recitation constants                                                | Intentional semantic alias covered by `recitations-contract.test.ts`. Retain both names and recitation IDs.                                            |
| `expo-updates`, `expo-system-ui` in `app.json`                                     | RF-008 owns native/app-config alignment. No dependency install or native regeneration follows from this finding.                                       |
| `@react-navigation/bottom-tabs` in AppNavigation                                   | RF-011 must inspect direct versus transitive ownership before manifest changes. The original checkout's user edit remains outside this worktree.       |
| `sharp` in the manual icon generator                                               | RF-011 must document or declare the development requirement after inspecting its use. Do not run the protected asset generator.                        |
| `react-devtools-core` in security diagnostics                                      | RF-011 must review this intentional inspection of the installed transitive package. Do not add a runtime dependency to silence the report.             |
| `sqlite3` in the Quran database builder                                            | External tool requirement, not an npm dependency. Keep visible; do not regenerate the database.                                                        |

RF-009 depends on accepted SDK alignment RF-067, not the unresolved RF-008 lint/native-ownership decisions. Static root calibration does not require a lint downgrade or native regeneration.

## Reproduction

Run `npm run analyze:unused` from the modernization worktree. It remains a report with a nonzero finding exit. Preserve its JSON and stderr before deciding on removals. The two primary preflight reports are `.refactor-baseline/rf009-current-knip.json` and `rf009-candidate-knip.json`; the frozen task gate writes `rf009-fresh-knip.json`. These ignored files persist in this worktree. No blanket ignore, issue threshold or automatic fix option was introduced.

Application tests/builds, native/device checks and dependency/security scans are not rerun for this configuration/documentation task. Latest application evidence remains RF-078's 374 unit tests and 35 Chrome cases. A calibrated analysis cannot establish behavior on a device.
