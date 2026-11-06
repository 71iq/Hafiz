# Modernization progress

The mission is active. All work stays local on the isolated modernization branch. Current policy is in RUNBOOK.md.

## Current status

At the RF137 baseline refresh, 114 tasks were accepted. See backlog.json for the current totals and unfinished work.

RF137 accepted on 2026-11-06. Baseline allocated storage fell from 23,701,917,696 to 86,016 bytes. Removed 864 old root entries and accepted-task run logs; kept only the fresh dependency-analysis baseline and the RF104 tafsir-loss reproduction/result. The obsolete RF025 probe is covered by accepted permanent tests. The event log is preserved. No app, protected input, original checkout or production change.

Full current-source controller checks, independent review and primary acceptance pass. Direct implementation replaces copy handoffs and worker-command audits. Keep one commit per accepted task, small notes and baseline storage below2GB. Dev/build-only advisories remain low priority.

## Next work

Prioritize account isolation and tafsir data safety, then performance and accessible bilingual UX. RF090 groups dev/build-only dependency advisories at low priority. No further vendor patch without shipped-app impact. Android device and iOS verification remain distinct from JavaScript exports. Hardware/account/payment needs are recorded as blockers while other work continues.

## Accepted tasks

| Task   | Result                                                                          | Local commit |
| ------ | ------------------------------------------------------------------------------- | ------------ |
| RF-001 | Reuse startup language in profile routes                                        | ea90700      |
| RF-002 | Remove unused chrome auto-hide API                                              | 831d76c      |
| RF-003 | Reuse the shared theme opacity helper in review session                         | d26dcc9      |
| RF-004 | Triage every measured clone group                                               | 74d6022      |
| RF-005 | Replace the brittle progress RTL source assertion                               | 9a3ece1      |
| RF-006 | Classify and test the decorative theme swatch                                   | 019b4ef      |
| RF-007 | Patch critical transitive tool dependencies                                     | e9598a8      |
| RF-008 | Resolve native configuration ownership with explicit policy and drift checks    | 963d2d8      |
| RF-009 | Calibrate native and web unused-code roots                                      | be56d6c      |
| RF-010 | Remove the verified unused AuthGate component                                   | 01b5401      |
| RF-011 | Declare the already-used bottom-tabs dependency                                 | f5d1dc0      |
| RF-012 | Establish native dependency-boundary analysis                                   | ba3d256      |
| RF-013 | Repair ayah-marker preference hydration                                         | 8cc5fea      |
| RF-014 | Characterize and share tafsir-selection transaction                             | 17b30d3      |
| RF-015 | Characterize Hifz progress transitions                                          | 8fe6dfe      |
| RF-016 | Extract tested Mushaf geometry calculations                                     | 72e6037      |
| RF-017 | Share juz range matching while preserving fallback policies                     | d9feabe      |
| RF-018 | Cancel obsolete search results and pending debounce work                        | 2414b20      |
| RF-019 | Extract text-surah and root-lemma result grouping                               | 9686c8f      |
| RF-101 | Characterize and extract root-candidate query matching                          | 4cfe5bc      |
| RF-020 | Characterize review-session orchestration                                       | 4462fee      |
| RF-021 | Extract ordered review persistence behind the tested session boundary           | a94642b      |
| RF-022 | Characterize smart-deck and queue query invariants                              | 7341c08      |
| RF-023 | Audit account-dependent query keys and auth lifecycle                           | 1cef8aa      |
| RF-024 | Introduce feature-local query keys where shared callers need them               | 17a1519      |
| RF-027 | Audit remaining manual remote fetches for Query ownership                       | 228eba8      |
| RF-035 | Label and test reading settings steppers                                        | 5889b4e      |
| RF-036 | Share reading stepper presentation without changing behavior                    | e76e760      |
| RF-037 | Measure settings subscription commit effects                                    | f9f9c15      |
| RF-038 | Respect live reduced motion in repeating loading placeholders                   | f2e410c      |
| RF-051 | Share startup database-error presentation                                       | 196cc65      |
| RF-052 | Characterize home deck-card presentation differences                            | 6eaa917      |
| RF-053 | Share the account-sync callout presenter                                        | bb6e978      |
| RF-054 | Reuse the existing strings object for OAuthButtons                              | a58d6d1      |
| RF-055 | Extract the duplicated DueDateSheet                                             | 9828164      |
| RF-056 | Share Qiraat block rendering                                                    | c347afb      |
| RF-057 | Share characterized auth startup theme lookup                                   | 5d9057e      |
| RF-058 | Characterize shared deck-review settings drafts                                 | f8221d0      |
| RF-059 | Share the review-setting help sheet                                             | b97eb47      |
| RF-060 | Share surah-name font readiness lifecycle                                       | a7f24e4      |
| RF-061 | Characterize journey ayah preview branches                                      | de17216      |
| RF-062 | Consolidate the JSON-record parser with boundary tests                          | 71805f6      |
| RF-063 | Share local review-date aggregation and streak rules                            | 15ab2fc      |
| RF-064 | Share missing public-review aggregate error classification                      | ebd1a0d      |
| RF-065 | Share validated weekly and all-time leaderboard reduction                       | cbbb74f      |
| RF-066 | Characterize auth startup theme fallbacks                                       | a0629e6      |
| RF-067 | Align verified SDK 55 runtime patches                                           | f863a2b      |
| RF-068 | Characterize route sign-in callouts before presentation reuse                   | efb82c9      |
| RF-069 | Characterize the deck-card due-date editor before reuse                         | 9044125      |
| RF-070 | Characterize the session due-date editor before reuse                           | 6e21066      |
| RF-071 | Restore default accessibility semantics in shared Button                        | a6e0d9a      |
| RF-072 | Show session date-save failures inside the active editor                        | 369ea19      |
| RF-073 | Expose direct session card-action failures before Reveal                        | 8618270      |
| RF-074 | Show card confirmation failures inside the active dialog                        | 8e2f9a1      |
| RF-075 | Show answer-save failures inside the active editor                              | 2620a8c      |
| RF-076 | Stabilize the session fixture with a fresh Jest cache                           | 82ae45a      |
| RF-077 | Expose deck date-save failures in the active editor                             | 50cbc3c      |
| RF-078 | Expose deck confirmation failures in the active dialog                          | 189cb4b      |
| RF-079 | Clarify implementation and evaluator ownership in Ralph prompts                 | historical   |
| RF-080 | Strengthen existing revealed-phase regression evidence                          | 61e8716      |
| RF-081 | Clear outdated date validation when a valid save starts                         | 882817c      |
| RF-082 | Keep implementation-only helpers and review type private                        | 100c5b7      |
| RF-083 | Remove the unreachable retention-card helper cluster                            | 80ad8f5      |
| RF-084 | Remove the unused RTL registry lookup index                                     | 104c7c0      |
| RF-085 | Remove the unused Locale type alias                                             | e1c4fc5      |
| RF-086 | Await completed persistence in the deck-card modal fixture                      | 4e6892d      |
| RF-087 | Resolve the manual icon generator tooling dependency                            | 0d1b499      |
| RF-088 | Resolve the security probe through the React Native dependency owner            | historical   |
| RF-089 | Patch compatible brace-expansion copies and guard nested input                  | 9cb438a      |
| RF-091 | Patch nanoid and preserve Unicode in native bundles                             | 68f526a      |
| RF-092 | Bound YAML parsing work on both installed legacy lines                          | f1bb169      |
| RF-093 | Keep generated loop evidence out of Jest module discovery                       | 2b101a4      |
| RF-094 | Preserve the React Native clock during due-date fixture resets                  | fb9c892      |
| RF-095 | Format review-setting editors and their RTL registry before extraction          | 2281e25      |
| RF-096 | Investigate and correct repeated-marker Qiraat body loss                        | 7496575      |
| RF-097 | Block overlapping tafsir selections in settings                                 | 6113e52      |
| RF-098 | Investigate incomplete tafsir replacement atomicity                             | 7ce6a10      |
| RF-099 | Block overlapping ayah tafsir selections                                        | 605436e      |
| RF-100 | Separate copy-only Ralph handoffs from implementation                           | ea0163a      |
| RF-102 | Respect live reduced motion in Switch thumb movement                            | 0592dba      |
| RF-103 | Respect reduced motion in shared busy indicators and close bounded UI inventory | 0a73bcb      |
| RF-105 | Respect live reduced motion and interruption in OfflineBanner                   | 2b1fea6      |
| RF-106 | Respect live reduced motion and session lifetime in Toast                       | bda9de8      |
| RF-107 | Respect live reduced motion in the existing Sheet                               | 4fd1365      |
| RF-108 | Respect live reduced motion and Modal activation in DropdownMenu                | cd27580      |
| RF-109 | Respect live reduced motion in ResponsiveOverlay                                | 90e913b      |
| RF-110 | Audit AppNavigation motion ownership and prepare three exact repairs            | 94eb72e      |
| RF-111 | Respect live reduced motion in bottom navigation visibility                     | a5d1680      |
| RF-112 | Respect live reduced motion in floating navigation progress                     | 607bd13      |
| RF-113 | Respect live reduced motion in bottom tab press feedback                        | 55095ab      |
| RF-114 | Align SDK55 lint preset while preserving current React Hooks coverage           | 36358b3      |
| RF-115 | Correct Router dependency declaration without changing installed packages       | d42d6db      |
| RF-116 | Align SDK55 patches and repair BusyIndicator registry integration               | ab20950      |
| RF-117 | Move the existing review step-text codec to a domain module                     | 68a06b1      |
| RF-118 | Share the four tested review-setting numeric clamps                             | f0beb91      |
| RF-119 | Isolate reflection section state by viewer and ayah                             | 8fe47da      |
| RF-120 | Repair DST-sensitive local calendar day indexes                                 | b389e65      |
| RF-121 | Validate daily leaderboard rows and normalize nullable scores                   | 658d8c7      |
| RF-122 | Ignore stale profile read and ensure completions across session owners          | 2327c04      |
| RF-123 | Publish session identity and profile ownership atomically                       | be58382      |
| RF-124 | Audit password recovery ownership against actual auth SDK notifications         | 2ae78d3      |
| RF-125 | Guard password recovery ownership and preserve SDK continuity                   | ece140a      |
| RF-126 | Isolate Hadith pages and late work by verse and language                        | 9caf020      |
| RF-127 | Guard profile saves and their editor continuations                              | f0ea6ac      |
| RF-128 | Repair the legacy XML parser without changing its consumers                     | 6f30aa8      |
| RF-129 | Own auth startup and reject obsolete session snapshots                          | c9df320      |
| RF-130 | Guard account stats continuations with the captured owner                       | bbd7f0e      |
| RF-131 | Serialize same-owner account stats refreshes                                    | dbafda7      |
| RF-132 | Preserve newer profile edits during stats reads and replies                     | 9b4615a      |
| RF-133 | Clear viewer Query results at auth lifecycle boundaries                         | 42955fa      |
| RF-134 | Bound external WebSocket fragments and buffers                                  | 51de9ea      |
| RF-135 | Repair external indexed source-map parsing                                      | d7dfe34      |
| RF-136 | Repair Tailwind bundled source-map parsing.                                     | 8695b6c      |
| RF-137 | Trim evidence and simplify verification.                                        | 3c53f19      |

## Pending workstreams

| Task   | Scope                                                                  |
| ------ | ---------------------------------------------------------------------- |
| RF-025 | Verify auth cache isolation and late requests                          |
| RF-026 | Test community mutation rollback and pagination                        |
| RF-028 | Integrate native Query online and focus lifecycle                      |
| RF-029 | Characterize sync partial failure and status                           |
| RF-030 | Validate web database bridge messages and SQL values                   |
| RF-031 | Validate sync payloads at entry                                        |
| RF-032 | Consolidate only matching local sync/query helpers                     |
| RF-033 | Audit local schema and remote migration parity offline                 |
| RF-034 | Standardize one inconsistent multi-field form                          |
| RF-039 | Profile reader and review performance before optimizing                |
| RF-040 | Prepare an isolated Android QA package and Maestro flow                |
| RF-041 | Run Android regression verification                                    |
| RF-042 | Run iOS regression verification on supported infrastructure            |
| RF-043 | Audit remaining TypeScript escapes by boundary                         |
| RF-044 | Resolve lint warnings through small behavioral checks                  |
| RF-045 | Assess the supported Expo SDK upgrade path                             |
| RF-046 | Repeat static and dependency audits after the first workstreams        |
| RF-047 | Replace remaining brittle source tests where behavior can be exercised |
| RF-048 | Verify responsive and bilingual UI across changed features             |
| RF-049 | Perform independent final architecture and repository review           |
| RF-050 | Publish the local final modernization report                           |
| RF-090 | Triage and resolve remaining dependency audit findings                 |
| RF-104 | Make incomplete tafsir-source replacement atomic                       |

Earlier detailed preparation and diagnostic records are intentionally retired. Git and the retained event log preserve accepted commits; old ignored evidence links are not current check inputs.

Cleanup checks: 1,999 Jest cases, 205 Node tooling/security cases, 38 controller tests, 10 native-config tests and 28 Chrome cases pass. Typecheck, three dependency graphs, native-config guard, reviewed Knip baseline, formatting, lifecycle/installed graph, web and separate Android/iOS JavaScript exports pass. Lint retains zero errors and 68 existing warnings. Exports were removed immediately; no native compilation/device verification is implied.

RF138 accepted, local commit a9e7b35. Wrong-account profile reads and missing/foreign save replies cannot publish or merge private fields. All20controller checks and independent source review pass: 2,004 Jest cases and28Chrome cases, plus tooling, types, lint, analysis and three-platform JavaScript exports. Task logs and temporary exports deleted. Broader profile payload validation remains pending.

## External verification needs

RF042 iOS native compilation/runtime needs a supported Mac and Xcode; this Linux host has neither. Physical-device checks need an attached authorized device. Android emulator work is available locally through the existing AVD and writable KVM, so RF040/RF041 are not blocked by the absent phone. JavaScript exports do not prove native runtime behavior.

RF139 accepted on2026-11-06. Malformed browser database messages are ignored and wrong-host replies cannot consume pending requests. Array/named/variadic/blob bindings remain supported. All20controller checks and independent source review pass: 123suites/2,027Jest cases,205Node cases,38runner cases,10native-config cases and29Chrome cases. Types, lint, analysis, three dependency graphs and web/Android/iOS JavaScript exports pass. Initial unused exports and focused test-harness mistakes were repaired without relaxing checks. Logs and temporary exports are deleted after acceptance. RF030 lifecycle/recovery and RF104 transaction ownership remain open.

RF140 accepted on 2026-11-06. Sync restore, upload and pull share one captured account lifetime. Stale fetched restores cannot clear local data, and obsolete completions cannot start a new-account phase. All 20 controller checks, independent review and primary acceptance pass: 124 suites/2,046 Jest cases, 205 tooling cases, 38 runner cases, 10 native-config cases and 29 Chrome cases, plus types, lint, analysis and web/Android/iOS JavaScript exports. Existing 68 lint warnings and five Knip records remain unchanged. Already-dispatched SQL, transaction ownership and persistent offline data ownership remain separate work. The account-separation policy question is pending; independent fixes continue. Task outputs are deleted after acceptance.

RF141 accepted on 2026-11-06. Invalid live review-card states are rejected before account replacement or incremental page writes. A causal regression first reproduced acceptance of state999; 32 real in-memory SQLite cases now preserve existing rows, supported states, tombstone defaults and timestamp ties. All 20 controller checks, independent review and primary acceptance pass: 125 suites/2,078 Jest cases, 205 tooling cases, 38 runner cases, 10 native-config cases and 29 Chrome cases, plus types, lint, analysis and three-platform JavaScript exports. Full payload validation and partial-sync status remain RF031/RF029 work. Accepted-task logs and temporary exports are deleted.
