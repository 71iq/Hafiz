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
