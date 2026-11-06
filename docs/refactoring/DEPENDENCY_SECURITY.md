# Dependency security

Prepared 2026-10-18 for Hafiz on the isolated modernization branch. Source baseline `4ca7c36`. RF-089 is the selected brace-expansion patch; controller verification and independent review still decide acceptance.

## Current audit

The fresh baseline has 74 package findings, including 59 high, 14 moderate, one low and zero critical. It contains 44 advisory source records across 35 distinct GHSA URLs. Package counts include propagation through affected parents; they are not distinct application vulnerabilities. Other families remain for RF-090. No deployed external-input path is established by this inventory.

## Original vulnerability

Nested patterns reach recursive brace expansion without a depth bound. In the installed ESLint copy, `node_modules/eslint/node_modules/brace-expansion/index.js:129` contains the recursive call below. The local 6.4 KB fixture produces a caught RangeError.

```js
n = expand(n[0], max, false).map(embrace);
```

The vendor identifies a depth-bound fix. The later rewrite-loop fix requires 1.1.21 and 5.0.12, which also cover the earlier stack failure. Both stay inside the installed major lines. [Nested-input advisory](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [rewrite-loop advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr).

## Search method

| Step                | Exact predicate against the full lock   | Matches | Failing | Patched control |
| ------------------- | --------------------------------------- | ------: | ------: | --------------: |
| Known instance      | ESLint's brace-expansion 1.1.15         |       1 |       1 |               0 |
| Same major line     | Every brace-expansion 1.x path          |       7 |       6 |               1 |
| Full package family | Every path ending in `/brace-expansion` |       8 |       7 |               1 |

The package/version inventory led to real API checks for every installed copy, not a source-text assumption. No broader parser-family generalization was needed for this slice. Other audit packages remain separate.

## Findings and negative control

| Installed path                                                   | Before | Deep-input result | Classification                 |
| ---------------------------------------------------------------- | ------ | ----------------- | ------------------------------ |
| `node_modules/@eslint/config-array/node_modules/brace-expansion` | 1.1.15 | stack overflow    | high, confirmed local failure  |
| `node_modules/@eslint/eslintrc/node_modules/brace-expansion`     | 1.1.15 | stack overflow    | high, confirmed local failure  |
| `node_modules/brace-expansion`                                   | 5.0.6  | stack overflow    | high, confirmed local failure  |
| `node_modules/eslint-plugin-import/node_modules/brace-expansion` | 1.1.15 | stack overflow    | high, confirmed local failure  |
| `node_modules/eslint-plugin-react/node_modules/brace-expansion`  | 1.1.15 | stack overflow    | high, confirmed local failure  |
| `node_modules/eslint/node_modules/brace-expansion`               | 1.1.15 | stack overflow    | high, confirmed local failure  |
| `node_modules/glob/node_modules/brace-expansion`                 | 1.1.21 | bounded input     | informational, patched control |
| `node_modules/test-exclude/node_modules/brace-expansion`         | 1.1.15 | stack overflow    | high, confirmed local failure  |

Each path is consumed by a minimatch instance. The seven minimatch 3.1.5 parents allow `^1.1.7`; the minimatch 10.2.4 parent allows `^5.0.2`. Existing ranges already accept the selected patches. These are installed Node-tooling paths; remote production exploitability is not established. Upstream rates the availability issue high. Local reproduction confidence is high. The glob copy at 1.1.21 is a patched negative control, not another unresolved match.

## Selected change

Use a named `npm update brace-expansion` with strict peers, lifecycle disabled and the existing offline cache. Do not upgrade majors, add direct dependencies or add overrides. Six copies move from 1.1.15 to 1.1.21 and one from 5.0.6 to 5.0.12. The eighth copy stays at 1.1.21. Every other lock entry and existing override remains identical in preflight.

The candidate lock has 71 package findings, including 56 high, 14 moderate, one low and zero critical. It removes 12 advisory source records, leaves 29 distinct GHSA URLs and introduces no new source record. There is no remaining brace-expansion finding. These are preflight results until the actual controller reruns the audit. They do not resolve the other 71 findings.

## Regression and verification

`npm run test:dependency-security` runs the new Node tool suite against every locked installed copy. Its child process uses a 128 MB heap and five-second timeout. Four normal patterns must keep their outputs. A 3,200-level nested pattern must return a string array without stack failure. The exact proposed test source reports one pass/one failure on current modules and two passes/zero failures on the patched isolated fixture, with no skips. Initial reporter/formatting helper errors remain recorded separately; no test assertion or time bound was relaxed.

This directly tests the nested-input issue. Coverage of other advisories uses vendor patched ranges and a fresh audit, not an assertion that every published attack was exercised. The patched fixture contains only the selected module links, so it does not prove a full application installation.

Actual acceptance requires named installation, existing Gradle/CSS-interop fixes, full installed graph and source/lock checks, fresh audit and Knip, the Node suite, both native dependency graphs, strict types, full lint, the unchanged Jest suite, web export, Chrome smoke and formatting. No native compilation, iOS build, physical-device or production operation is claimed for this JavaScript tooling patch. RF-086's intermittent Reset fixture remains open.

Future dependency verification must run `npm run test:dependency-security` along with fresh audit. RF-090 must triage remaining findings into compatible small scopes. Remove or change a security guard only after its replacement proves the same input and installed-copy coverage.

## RF-089 acceptance, 2026-10-18

The controller-installed graph matches the exact seven-entry preflight, and its fresh audit confirms 71 package findings, including 56 high and zero critical. No brace-expansion finding or new advisory source remains. Both Node cases, all 374 Jest cases, strict types, full lint, both native dependency graphs, web export and all 28 Chrome smoke cases pass. All 12 frozen commands and separate Astra review pass. Primary accepts the final hashes and scope after lease release, local commit `9cb438a`. The 71 remaining audit findings and RF-086 remain open. No native compilation, physical-device, iOS build or production check ran.

## RF-091 nanoid invalid-size guards, prepared 2026-10-18

The full lock contains one nanoid copy, 3.3.12. React Navigation native 7.5.1 and routers 7.6.5 allow ^3.3.11, Expo Router 55.0.18 allows ^3.3.8, and PostCSS 8.5.15 allows ^3.3.12. Their existing ranges all accept 3.3.20. Authored app/components/lib code has no direct nanoid import. Installed navigation consumers generate route/history keys with the default positive size; PostCSS uses the fixed size six. This establishes installed runtime/build ownership, without an identified attacker-controlled size path.

The vendor documents infinite loops for negative non-secure sizes and zero custom-generator sizes. The selected same-major patch includes both fixes, the later large-size repair and corrected async types. Registry and actual installed tarball inspection find no new runtime dependencies. Node engines, browser/react-native mappings, runtime exports and condition order remain identical. Only the async TypeScript declaration paths now point to their async files. [Negative-size advisory](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [zero-size advisory](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [3.3.19 release](https://github.com/ai/nanoid/releases/tag/3.3.19), [3.3.20 release](https://github.com/ai/nanoid/releases/tag/3.3.20).

### Actual variants and controls

The search expands from the Node customRandom loop to all ten published synchronous/asynchronous, CommonJS/ESM, browser and non-secure entry files. Every file preserves valid default and positive-size output in the before probe. All eight secure/custom-generator variants request RNG for zero-size customAlphabet. The four synchronous secure variants also request the supplied RNG for zero customRandom. The two non-secure files already return an empty string for zero, a negative control, but request RNG for negative nanoid/customAlphabet sizes. The patched real package returns an empty string without RNG for every tested invalid size.

The regression runs 44 API/input children per locked copy. Each child starts with a fresh module/random pool, a 128 MB heap and five-second timeout. For invalid sizes, a throwing RNG detects entry into the old branch and prevents an unbounded loop. It executes vendor code and restores state by process exit. Normal cases use real RNG and check default/explicit lengths, alphabets and a deterministic customRandom result. The exact proposed suite reports one pass/two failures before, then three passes/zero failures on the isolated real 3.3.20 fixture, zero skips. This tests the faulty input path without deliberately exhausting the machine. It does not claim a deployed denial-of-service reproduction or coverage of every possible invalid number.

The initial probe reused a warmed Node random pool, bypassed its RNG guard and hit its existing five-second timeout. Preflight stopped before approval. Source and failure remain recorded; the final protocol isolates every input without changing the time/memory bounds, assertions or package implementation. The first metadata check also stopped on the async type correction; primary reviewed those exact two type-only paths before approval.

### Resolution and audit scope

A named `npm update nanoid` changes only `node_modules/nanoid`, from 3.3.12 to 3.3.20. No new direct dependency, override, major upgrade or other resolved entry is allowed. The nanoid update leaves app source, native packages, protected content and the brace-expansion guard unchanged. The separately diagnosed minifier change below is the only added source configuration scope.

Compare audit results within the same graph scope. The installed-tree baseline has 71 package findings, 56 high and zero critical. The virtual lock baseline has 73 findings/58 high; the candidate virtual lock has 72/57, removing nanoid and its two advisory source records without adding any source. In these preflight snapshots, two additional parent flags propagate existing Tailwind findings to NativeWind and CSS interop. Fresh controller snapshots later reverse the count difference: installed analysis reports 72/57 high and lock-only reports 70/55. Both contain the same 30 advisory source records across 27 GHSA URLs, with nanoid and brace-expansion absent and no new source. Counts therefore vary between runs/options; the audit option alone does not establish the cause. Preserve each labeled snapshot and compare advisory identities and exact lock entries. Those parent flags are not new package code or new advisory records. RF-090 retains all remaining advisory families. Never apply audit's incompatible downgrade/major suggestions automatically.

The first controller run passes nine commands, then simultaneous Android/iOS export reaches the 6 GB systemd cap and reports oom-kill. No native export, browser or review pass is claimed. Original candidate, logs and failure remain. Primary refunds this resource-only interruption and splits both platform exports into sequential one-worker processes with a 2 GB Node heap, preserving the 6 GB scope, 900-second command deadlines, retry limits and both platform checks. A changed specification requires fresh generation and all 13 commands. A second memory failure needs primary diagnosis before another reset.

The controller must rerun actual installation and lifecycle fixes, full installed graph, both audit scopes, calibrated Knip, exact source/lock checks, all five dependency-security cases, both native dependency graphs, strict types, all existing Jest cases, web export, Android/iOS JavaScript exports, Chrome smoke and formatting. Separate Astra review and primary final acceptance follow. Native JavaScript exports do not verify APK compilation, iOS native compilation or device behavior. No production operation is authorized. RF-086 stays open on any recurrence.

## RF-091 native export diagnosis and revised scope, 2026-10-18

The second native check hits the deliberately configured 2 GB V8 heap limit. A bounded 4 GB, one-worker Android probe then exposes Metro's actual `bundleToString` failure. Its graph contains 1,386,612,833 JavaScript UTF-16 units, including 1,379,576,859 from 1,183 data modules alone. Node permits 536,870,888 units in a string. The input data and loader mappings are unchanged by the nanoid patch, so those existing modules already exceed the limit without nanoid. This is a size-bound inference from the actual graph, not a claim that an old-package full install was rerun. The iOS ASCII-output probe also exhausts its heap. Both original failures and diagnostic runs remain preserved.

Metro's default minifier format sets `ascii_only: true`, which expands Arabic characters into six-character escapes. The revised scope sets only `config.transformer.minifierConfig.output.ascii_only = false`. Minification, other options, source data, require maps and loading behavior stay unchanged. Terser documents this as an output-format option. [Terser format options](https://terser.org/docs/options/#format-options).

The new `test:metro-unicode` command loads the actual configured minifier through Expo's Metro worker owner. It checks parsed string equality for Arabic, combining marks, astral/private-use characters, separators and escapes, and requires literal Unicode output. It also compares canonical parsed-content hashes for the complete Quran data, glyph data and the largest Zilal dataset. Exact final source reports two passes/one failure before and three passes/zero failures after, zero skips. Initial module-export interop harness failure remains preserved. No protected source is edited or reformatted.

Both full preflight JavaScript exports now succeed. Android contains 312,347,248 UTF-16 units in 530,437,311 UTF-8 bytes; iOS contains 312,263,927 units in 530,353,990 bytes. Each uses one Metro worker and a 4 GB V8 heap under the unchanged 6 GB process-group cap, with zero OOM events. Both reach the cap and report memory pressure. These are preflight measurements, not fresh controller acceptance. The roughly 530 MB payload and cold-start/runtime memory still need RF-039 profiling, with offline content preserved.

Primary retains the second failed ordinary attempt count at one. No additional retry refund is granted. The remaining attempt must use a fresh generation, all 15 frozen commands and separate Astra review. The new contract adds the minifier regression and full lint to all previous checks, and raises only the internal per-process heap from the unsuccessful 2 GB setting to 4 GB while keeping the original group/time/batch limits. A pinned manifest guards 2,421 protected assets and loader inputs. No checkpoint is manually restored. No bytecode compilation, native APK/iOS build, device runtime or production operation is claimed here.

## RF-091 acceptance, 2026-10-18

All 15 fresh controller commands and separate Astra review pass. Primary accepts local commit `68f526a` after lease release, exact six-artifact and one-lock-entry inspection, a fresh hash pass over all 2,421 protected inputs and native bundle comparisons against successful preflight. Both Android/iOS JavaScript exports match those preflight bytes. All five dependency-security cases, three minifier cases, 374 Jest cases and 28 Chrome cases pass, zero skips. Full lint retains 71 warnings and zero errors. Record `.refactor-baseline/rf091-primary-acceptance.json`.

The final installed audit reports 72 package findings, including 57 high, 14 moderate, one low and zero critical. Lock-only reports 70 findings, including 55 high, 14 moderate, one low and zero critical. Both contain the same 30 advisory sources across 27 GHSA URLs, without nanoid, brace-expansion or a new source. These are labeled snapshots, not a claim that the app is free of vulnerabilities. RF-090 remains open. RF-039 owns the large native payload/runtime profile, and RF-086 remains unresolved. No bytecode/native compilation, device runtime, new manual rendered check or production operation ran in this task.

## RF-092 YAML parser CPU limits, prepared 2026-10-18

The installed lock has three js-yaml copies. Coverage configuration uses root 3.14.2 through @istanbuljs/load-nyc-config with range ^3.13.1. ESLint legacy configuration uses nested 4.2.0 through @eslint/eslintrc with range ^4.1.1. Expo xcpretty uses a separate 4.3.2 control with range ^4.1.0. Parent-relative resolution confirms these actual paths. Authored app/components/lib code has no direct js-yaml import. The identified consumers read local build/configuration files; no app network-input path is established. Upstream availability advisories are high severity, while this isolated tooling repair has medium project risk.

Official registry tags select maintained legacy 3.15.2 and 4.3.2. Latest 5.5.0 is a different major and is not selected. Existing parent ranges accept both choices. Runtime exports, ESM conditions, dependencies, engine declarations, CLI mapping and license stay identical within each installed major. The host is Node 24.18.0 with npm 11.16.0. Named offline strict lock resolution changes exactly two entries, root 3.14.2 to 3.15.2 and nested ESLint 4.2.0 to 4.3.2. The Expo control and every other resolved entry stay identical. No direct dependency, override, peer bypass or incompatible major is introduced. [3.15.2 release](https://github.com/nodeca/js-yaml/releases/tag/3.15.2), [4.3.2 release](https://github.com/nodeca/js-yaml/releases/tag/4.3.2).

### Root causes and variant search

Merge chains repeatedly enumerate inherited keys. The vendor bounds total merge work by default, and its later repair also charges each empty source mapping. Ordered-map uniqueness previously scanned a growing array for each key; the patched resolver uses own-key lookups. The default merge budget is 10,000. Extremely large legacy configurations can now be rejected; do not disable this protection to make a fixture pass. [Repeated aliases](https://github.com/advisories/GHSA-h67p-54hq-rp68), [merge chains](https://github.com/advisories/GHSA-52cp-r559-cp3m), [ordered maps](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), [empty sources](https://github.com/advisories/GHSA-2883-xcg3-v3hh).

| Search                                                         | Actual result                           | Disposition                                                         |
| -------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| Exact `indexOf(pairKey)` in root ordered-map resolver          | One hit                                 | Vulnerable root copy                                                |
| Same expression across all three locked copies                 | Two hits                                | Root and ESLint copy confirmed, high upstream availability severity |
| Lock inventory and parent-relative module resolution           | Three copies and three declared parents | Separate Expo 4.3.2 copy is already repaired, informational control |
| Authored app/components/lib imports                            | No direct import                        | No app entry point demonstrated; no blanket exploitability claim    |
| Published CJS, UMD, minified UMD and supported ESM entry files | Eleven variants                         | Real API regression checks each, including legacy safe APIs         |

The root resolver contains `objectKeys.indexOf(pairKey)`. The patched source instead checks `_hasOwnProperty.call(objectKeys, pairKey)`. Both vulnerable versions lack the total merge budget. The Expo control includes source and key charging and constant-time ordered-map membership. No failed or noisy search pattern was used to suppress a finding.

### Bounded real regression

The proposed Node suite runs eleven fresh children against the actual locked packages. Each child has a 128 MB heap and five-second timeout. All 67 API checks use small inputs. Normal coverage includes Arabic strings, anchors and override precedence, dump/load and multi-document behavior, ordered-map special keys and duplicate rejection. The legacy safe functions remain covered.

The merge guard checks accepted/rejected boundaries for one keyed source and three empty aliases, plus a 160-mapping chain against the default limit. Ordered-map coverage counts actual Array.indexOf receiver lengths during a 64-key parse, then restores the method in finally. Both old copies scan 2,016 entries per API; the work limit is 256. This detects the observed quadratic mechanism without timing thresholds, vendor replacement or large denial-of-service input. It is not a proof of every parser complexity case. The unchanged final suite is red with one pass/three failures on the installed tree, then green with four passes/zero failures on real registry archives in an isolated fixture, zero skips. The already-patched control passes throughout.

### Audit and acceptance boundary

Paired lock-only snapshots report 70 package findings/55 high before and 72/54 high after, both zero critical. Seven direct YAML advisory source records across four GHSA URLs disappear, with no new source. Parent propagation adds moderate coverage/Babel flags from the existing sprintf-js to argparse to legacy YAML chain. Thus the package count rises while direct YAML findings are removed. The residual YAML entry is moderate and inherited through argparse, not a remaining direct YAML advisory. RF-090 retains that family and every other advisory. Preserve labeled snapshots and compare source identities, not only totals. Do not adopt audit's Expo/Jest major upgrades or downgrade suggestions automatically.

The real controller must perform installation, lifecycle fixes, exact source/lock/installed graph checks, both fresh audit scopes, unchanged Knip and protected-input guards, all nine security cases, both native dependency graphs, strict types, full lint, all Jest cases, web export, Chrome smoke and formatting. Separate stronger evaluation and primary final scope/hash acceptance follow. Source implementation is limited to the new guard, one existing npm command and this report; the controller owns package-lock resolution. No app code, native package, Metro option, protected input, loader map or existing test changes. No native/bytecode compilation, fresh native JavaScript export, physical-device verification, production or backend operation is claimed by this preparation. RF-086 stays unresolved.

## RF-092 acceptance, 2026-10-18

All 12 fresh controller gates and separate Astra review pass. Primary accepts local commit `f1bb169` after lease release, exact four-artifact/two-lock-entry inspection and a fresh hash pass over all 2,421 protected inputs. The existing Expo YAML control and every other resolved package stay unchanged. Nine security cases, 374 Jest cases and 28 Chrome cases pass, zero skips. Full lint retains 71 warnings and zero errors. Record `.refactor-baseline/rf092-primary-acceptance.json`.

Both final audit scopes report 72 package findings, including 54 high, 17 moderate, one low and zero critical. They contain the same 23 advisory sources across 23 GHSA URLs. Seven direct YAML source records disappear; inherited moderate argparse/sprintf debt remains. RF-090 stays open. The reviewer independently verifies hashes and actual controller evidence; its own test rerun encountered sandbox child-process EPERM. No fresh native export, bytecode/native compilation, manual UI, device or production operation ran.

The controller Jest run passes despite a module collision between unpacked YAML preflight archives. Primary preserves the archives under node_modules with identical bytes and original paths retained as symlinks. A cold default run then passes all 374 cases and reveals an older copied hafiz manifest collision. RF-093 owns that generated-evidence module boundary. Its candidate preserves all 66 test files and passes 374 cold cases without collision, while the actual source configuration remains unchanged. Original logs and the failed primary warning postcondition remain visible. No test assertion or source ignore rule was changed within RF-092.

## RF-128 XML parser repair, prepared 2026-11-06

Fresh installed and lock-only audits each report 39 package findings, 10 high and zero critical. The omit-dev graph has 29 findings, 9 high, and still includes Expo build tools. It does not identify shipped code. The full snapshots contain 12 direct advisory families and 24 distinct GHSA URLs.

Primary selects the legacy `@xmldom/xmldom` update from 0.8.13 to 0.8.15. The standard targeted strict-peer resolver changes one lock record, including upstream MIT license metadata. Dependency declarations, overrides and the separate patched `plist` copy at 0.9.12 stay exact. Expo plist accepts the legacy patch through its existing range. The [release](https://github.com/xmldom/xmldom/releases/tag/0.8.15) repairs namespace allocation, parser and DOM complexity, and XML validation defects. Official advisories describe the [end-tag whitespace defect](https://github.com/advisories/GHSA-x4fp-j954-r2f4) and [malformed-input recovery defect](https://github.com/advisories/GHSA-93r5-fhx6-vmg9).

The new Node tests extend the existing dependency-security command. Both installed parser copies must preserve XML entities, Arabic text, namespace inheritance, serialization and actual Android manifest parsing. The actual Expo plist consumer must retain its null-prototype parse result and build/parse round trip. The namespace fixture checks output semantics. It does not measure memory growth.

Three bounded probes exercise real vendor code in fresh children with a 128 MB heap and five-second timeout. The old parser stalls on a one-MiB malformed end tag. For 512 embedded tag delimiters, a public String.charAt counter records 131844 scans before and 1028 after. A public normalize call on 512 adjacent text nodes copies 131327 accumulated characters before and 512 after. The tests assert bounded work and preserved text, node identity, comments and sibling order. They restore instrumentation before child exit. These local synthetic inputs establish the faulty mechanisms, not an exploited production endpoint. The exact final XML file passes 8 cases and fails 5 on the original tree, then passes all 13 on a clean isolated strict-peer installation.

The initial nine-case suite missed the second malformed recovery mechanism. Separate preparation review found that gap. Both operation-count regressions were added before approval. Earlier constructor-option, plist-prototype, malformed-fixture and temporary symlink graph failures remain in the evidence directory. A mistaken Node invocation discovered tests instead of reading stdin, so primary stopped its owned process tree and used an explicit isolated test path. No failed result was counted as acceptance.

The selected package version passes the full 119-suite, 1684-case application test run, strict types, web export and 28 real Chrome smoke cases. The final added test file still requires its own focused diagnostics and all fresh controller checks. Source and original installed parser restore exactly after preflight. Both after audits report 38 package findings, 9 high and zero critical. Exactly ten direct XML advisory URLs disappear, with no new advisory source. RF-090 retains all other families.

Fresh controller installation must execute the existing project lifecycle scripts and preserve the frozen lock. Full installed graph, both audit scopes, all 22 dependency-security cases, source hashes, scoped diagnostics, platform dependency graphs, calibrated Knip, types, unit tests, web build and browser smoke must pass. A separate stronger review and primary acceptance follow. No app source, protected content, database, native source, production operation or deployment belongs to this scope. Browser smoke does not verify native compilation or device behavior.

## RF-134 WebSocket fragment and buffer limits

The proposed repair selects external root `7.5.13` and the realtime/jsdom declared dependencies at `8.21.1`, retaining Expo `8.22.1`. Every parent already accepts the selected patch. Only three lock records change version, archive URL and integrity. No dependency declaration or override is added. Official registry SHA512 values pin both archives.

[GHSA-96hv-2xvq-fx4p](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p) affects the installed root `7.5.10`. Its fix was `7.5.11`; [7.5.13](https://github.com/websockets/ws/releases/tag/7.5.13) also fixes a fragment counter reset regression in `7.5.12`. The existing `8.21.0` copies are outside this reviewed advisory and the reviewed uninitialized memory advisory. The separate [unreviewed empty-fragment report](https://github.com/advisories/GHSA-73jw-fp74-p77x) has no formal affected range. [8.21.1](https://github.com/websockets/ws/releases/tag/8.21.1) counts empty fragments and lowers default fragment and chunk limits. Its observed behavior is tested independently of npm advisory classification.

All four external installed instances receive bounded controls. Tiny direct Receiver inputs exercise frame and chunk limits, empty fragments, successive message resets, disabled limits, Unicode and binary data. Local HTTP upgrades exercise client/server forwarding, compressed and uncompressed messages, and close code 1008. A nonzero chunk option is checked on each actual connection Receiver. Compression uses a zero threshold and counts real decompression calls, including the legacy major. TCP packet boundaries are not used to assert chunk limits. Seven parent-relative resolution checks establish declared dependency resolution only.

Metro and native development middleware import the external root package. jsdom imports its nested copy. React Native and browsers use platform WebSocket APIs. The realtime SDK uses the global/platform API, with explicit caller-supplied transport required on older Node. The nested package check does not prove automatic SDK fallback or application transport lifecycle coverage. No live service or app exploitability is certified.

`react-devtools-core/dist/standalone.js` embeds a separate WebSocket implementation without the observed fragment/chunk guards. Resolving its declared external dependency does not replace that bundled code. RF-090 retains this residual for a supported parent or separately reviewed repair. This task does not claim whole-family remediation.

Fresh installed and virtual-lock audits before the candidate both report 38 package findings, 9 high and 0 critical. Candidate snapshots both report 37 findings, 8 high and 0 critical, with the direct WS advisory removed. Residual findings remain. Preparation review found that negotiation alone did not prove legacy compression and direct Receiver checks did not prove public chunk-option forwarding. Those test gaps are corrected before readiness, with the earlier artifacts and evidence preserved. Fresh controller gates, independent evaluation and primary acceptance remain pending. RF-090 stays open.

## RF-135 source-map parser preparation

The proposed external source-map-js patch moves 1.2.1 to 1.2.2 through PostCSS's existing compatible range. No direct dependency, override or parent major changes. The official registry archive is integrity-checked. The published file set and dependency/engine/license contracts remain unchanged. Source changes cover offset validation, cumulative nested limits, repeated source getters, short generated input, mapping serialization and sorting under denied string code generation.

The [reviewed advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) describes resource exhaustion from indexed offsets. The [release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) adds an inclusive ten-million limit on cumulative section-offset lines. This is not a global serialization or memory bound. Proposed tiny constructor cases test exact boundaries without serializing huge line gaps. Actual PostCSS object/JSON previous-map paths, ordinary Unicode mapping controls and bounded source-getter counts distinguish behavior from version checks. Sorting in a strings-disabled VM covers the additional compatibility change; the library still attempts a caught initialization probe, so no zero-eval or browser CSP-diagnostic claim is made.

Tailwind's peers bundle retains a separate older consumer and serializer. Its CLI first resolves installed PostCSS, but a lock update does not replace the bundled fallback. That residual remains RF-090, separate from external-package remediation. No application-input exploitability is established. The final 54-case suite fails 46 cases and passes 8 controls on the original external package, then passes all 54 on the real archive. All 125 dependency-security cases, scoped lint/format and the installed graph pass. Real Tailwind loadPostcss selects the external instance. Preparation review corrected the earlier owner-resolution-only proof. A 163-byte previous map confirms the embedded fallback still accepts the excessive offset while external parsing rejects it; neither path serializes an expanded map. Both audit scopes move from 37 findings and 8 high to 36 and 7 high, zero critical. Only direct source-map-js advisory 1241209 disappears; all other complete direct advisory records match. Raw computed parent metadata may differ. Fresh controller checks, web/native JavaScript exports, independent review and primary acceptance remain pending. No native compilation, device or live-service verification is claimed.

## RF-136 bundled source-map repair preparation

Tailwind 3.4.19 embeds older source-map-js modules. Its public parser and two direct css-tree generator callers need the same reviewed guards as the external copy. The proposal backports only the official repair hunks inside four original module bodies. All eleven existing require bindings, exports and wrapper caches remain. Exact reversal proves all other bytes unchanged. The full upstream BSD notice remains in the patched module. A larger whole-body proposal is preserved as preparation evidence and is not selected.

Shared API cases are extracted intact from the external regression, then registered for both independent implementations. Additional real-bundle tests cover public lazyPostcss, both direct css-tree source-map callers, separate constructor identities, generator/consumer/SourceNode interoperability and sorting in a strings-disabled VM without host-library delegation. A test-only export is appended when compiling the complete installed bundle; its algorithms are not replaced. Small cssnano output and maps provide a valid-data control. Independent preparation review found that output assertions alone did not detect the old per-line generator loop. One shared tiny line-nine case now counts reads from the actual stored mapping, restores its descriptor, and checks exact encoding and the public round trip. The prior 97-case artifacts and results remain preserved. No huge map serialization or memory exhaustion is used.

The current v3 LTS remains 3.4.19. NativeWind's stable guide targets Tailwind v3, so a v4 migration is a separate compatibility decision. No dependency/version/lock/app/protected-content change belongs to this backport. The final 99-case fixture fails 34 cases and passes 65 controls on the original bundled copy, then passes all 99 after actual patch-package application. All 170 dependency-security cases, scoped zero-warning lint, formatting and the installed graph pass. Every source and vendor file restores exactly after the trials. Both fresh audit scopes retain 36 findings, 7 high and zero critical, with all 12 complete direct advisory records unchanged. Computed parent metadata differs and is retained. npm does not inspect the embedded repair. Fresh controller checks, separate stronger evaluation and primary acceptance remain pending.

The first controller attempt passed application tests, web/native JavaScript exports and all 28 Chrome cases, then the unchanged Knip baseline rejected a new direct test import of transitive source-map-js. A first preparation correction still resolved PostCSS directly and failed the same check because PostCSS is also transitive. The final test follows the complete declared Tailwind to PostCSS to source-map-js ownership chain, matching the existing external regression. No dependency declaration, scanner exclusion or expected finding is added. The actual failure and prior artifacts remain preserved. All controller checks and a new independent review must run again.
