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
