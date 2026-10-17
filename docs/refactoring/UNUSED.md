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

| Finding                                                                            | Next action                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/AuthGate.tsx`                                                       | RF-010 removes the unused component and its RTL registry entry after caller, route and platform analysis. The RF-009 snapshot retains its original negative control. |
| `readDefaultDeckFilter`, `MirroredPressableRow`, `ReviewRecord`                    | RF-082 keeps all three implementations/types inside their owning modules and removes only their unnecessary exports.                                                 |
| `isRetentionCardSaved`, `addRetentionCard`, `rtlComponentRegistryByPath`, `Locale` | RF-083 owns the unreachable retention-helper cluster; RF-084 owns the unused registry index; RF-085 owns the unused Locale alias. Each needs its own approved scope. |
| `TAFSIR_SOURCES`/`AVAILABLE_TAFSIR_SOURCES`                                        | Same registry object with consumers of both names. Retain pending contextual API review; do not duplicate or alter content.                                          |
| Husary/default recitation constants                                                | Intentional semantic alias covered by `recitations-contract.test.ts`. Retain both names and recitation IDs.                                                          |
| `expo-updates`, `expo-system-ui` in `app.json`                                     | RF-008 owns native/app-config alignment. No dependency install or native regeneration follows from this finding.                                                     |
| `@react-navigation/bottom-tabs` in AppNavigation                                   | RF-011 must inspect direct versus transitive ownership before manifest changes. The original checkout's user edit remains outside this worktree.                     |
| `sharp` in the manual icon generator                                               | RF-011 must document or declare the development requirement after inspecting its use. Do not run the protected asset generator.                                      |
| `react-devtools-core` in security diagnostics                                      | RF-011 must review this intentional inspection of the installed transitive package. Do not add a runtime dependency to silence the report.                           |
| `sqlite3` in the Quran database builder                                            | External tool requirement, not an npm dependency. Keep visible; do not regenerate the database.                                                                      |

RF-009 depends on accepted SDK alignment RF-067, not the unresolved RF-008 lint/native-ownership decisions. Static root calibration does not require a lint downgrade or native regeneration.

## Reproduction

Run `npm run analyze:unused` from the modernization worktree. It remains a report with a nonzero finding exit. Preserve its JSON and stderr before deciding on removals. The two primary preflight reports are `.refactor-baseline/rf009-current-knip.json` and `rf009-candidate-knip.json`; the frozen task gate writes `rf009-fresh-knip.json`. These ignored files persist in this worktree. No blanket ignore, issue threshold or automatic fix option was introduced.

Application tests/builds, native/device checks and dependency/security scans are not rerun for this configuration/documentation task. Latest application evidence remains RF-078's 374 unit tests and 35 Chrome cases. A calibrated analysis cannot establish behavior on a device.

## RF-010 source cleanup, 2026-10-17

The calibrated report identified only `components/ui/AuthGate.tsx` as an unused file. The private Expo Router app discovers routes under `app/`; it does not discover components as routes. AuthGate has no authored import, re-export, dynamic-module or platform-specific caller. Its only non-documentation reference was the RTL registry entry. The live compact sign-in callouts remain unchanged.

RF-010 removes that complete unused module and its single registry entry. Fresh Knip analysis must report zero unused files with the same four live platform entries, exclusions and dependency exceptions. The five export, two type, two duplicate-export, five unlisted-dependency and one external-binary findings remain open. No package, runtime UI, content or generated data changes.

The focused three-case RTL registry suite checks complete coverage, uniqueness, ordering and existing paths. Strict typecheck checks remaining imports; scoped registry lint and this document's formatting also run. No new browser, native build, device or iOS verification is needed for an unreachable module deletion or claimed here.

The RF-009 gate is a historical calibration check and intentionally expects its original AuthGate negative control. Keep its evidence unchanged. RF-010 uses `.refactor-baseline/rf010-verify.py` and writes `rf010-fresh-knip.json`; do not rerun the old task gate and treat its changed snapshot as a regression. Current general analysis remains `npm run analyze:unused`, which still exits 1 for the other open findings.

## RF-082 internal export visibility, 2026-10-17

Primary caller inspection distinguishes unused exports from unused implementations. `readDefaultDeckFilter` still supplies three internal filter paths. `MirroredPressableRow` still implements `DisclosureRow`, including ref forwarding, callback styles and direction handling. `ReviewRecord` remains the local type of the exported `ReviewTransition.reviewRecord` field. None has an external authored caller or barrel export in this private Expo application.

RF-082 removes only the `export` keyword from those three declarations. All function bodies, types, runtime bindings, JSX, styles, refs, service behavior and public APIs used by existing callers remain identical. No wrapper, abstraction, test or dependency is added.

The current Knip report must retain zero unused files, reduce unused exports from five to three and unused exported types from two to one. The remaining exports are `isRetentionCardSaved`, `addRetentionCard` and `rtlComponentRegistryByPath`; the remaining type is `Locale`. Two intentional alias groups, five unlisted dependencies and one external binary remain visible. No analysis configuration, exclusion or exception changes.

The two unchanged nearest suites cover real RTL primitives and review transitions. Their pre-change run passes all 20 cases. Strict typecheck, scoped lint, real Knip verification, documentation formatting and separate review accompany this slice. No browser, app/native build or device/iOS verification is required or claimed for export visibility with unchanged implementation bytes.

Further source candidates stay separate. RF-083 must recheck the two unused retention functions and their two private ID builders before removal, preserving all live query, migration and synchronization behavior. RF-084 concerns only an unused test-registry lookup map. RF-085 concerns only the unused Locale type declaration and cannot change either language dictionary. Retain both tafsir registry names and both recitation constants with their current values and consumers.

Completed task gates describe their own historical snapshots. Use `npm run analyze:unused` for current general analysis and the selected task's gate for its acceptance. A deliberate later cleanup can change an earlier snapshot without reopening that completed task.

## RF-083 unreachable retention cluster, 2026-10-17

Primary inspection finds no authored caller, re-export or dynamic discovery of `isRetentionCardSaved` or `addRetentionCard`. Their private `retentionCardId` and `mutashabihatCardId` builders have no other consumers. RF-083 deletes exactly those four functions, 122 lines. It adds no replacement abstraction.

All live queries remain byte-identical. This includes word saves, study-card materialization, marking, soft deletion, review scheduling, legacy retention migration and sync queue writes. `MUTASHABIHAT_DECK_ID` remains in use by session parsing. The shared creation, normalization, migration and sync imports remain needed by live functions. Schema, migration, queue, IDs, datasets and production state are unchanged.

Fresh Knip must retain zero unused files and reduce unused exports from three to one, `rtlComponentRegistryByPath`. `Locale` remains the one unused type. Two intentional alias groups, five unlisted dependencies and one external binary remain visible. No configuration or suppression changes. RF-084 and RF-085 own the remaining source declarations after separate primary preparation.

Verification includes the unchanged full unit suite, strict types, scoped query-module lint, web export, documentation formatting and real analysis, followed by separate stronger review and primary acceptance. Existing unit callers mock several query operations; they do not prove database execution. The exact deletion-only byte comparison establishes that every live implementation is unchanged. No database command, native build, device or iOS check is run or claimed for this deletion.

## RF-084 unused registry index, 2026-10-17

`rtlComponentRegistryByPath` has no authored caller. RF-084 removes only its unused derived lookup allocation and unsafe cast. The typed registry array, entries, helper, imports and existing inventory suite stay byte-identical. No runtime UI or data changes.

Current Knip must report zero unused files and exports, with `Locale` still the one unused exported type. The two deliberate alias groups, five unlisted dependencies and one external binary remain visible. Real analysis, the unchanged three-case registry suite, strict types, scoped lint and document format run, followed by independent review and primary acceptance. No new browser, app/native build or device/iOS check is claimed.

## RF-085 unused Locale alias, 2026-10-17

RF-085 removes only `export type Locale = keyof typeof strings;`. No authored code consumes that alias. Both language dictionaries and the used `UIStringKey` and `UIStrings` declarations remain byte-identical. No translation, language behavior, content, dependency or runtime change.

Current Knip must report zero unused files, exports and exported types. Two deliberate alias groups, five unlisted dependencies and one external binary remain open for their separate workstreams. Finding exit 1 remains expected and is not a clean overall analysis. The unchanged UI-string contract, strict types, scoped lint, document format and real analysis run with independent review and primary acceptance. No new browser, app/native build or device/iOS check is claimed.
