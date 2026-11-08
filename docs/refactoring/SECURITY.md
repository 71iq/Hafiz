# Dependency security decisions

RF-007 passed controller verification and independent evaluation on 2026-10-16, local commit `e9598a8`. The primary engineer accepted the two-package lock diff. Evidence is under `.ralph/runs/RF-007-1-1792107834166140763`.

## Critical dependency paths

Before RF-007, package-lock.json recorded these paths:

| Parent                                          | Dependency  | Before | Installed now |
| ----------------------------------------------- | ----------- | ------ | ------------- |
| React Native 0.83.2 / react-devtools-core 6.1.5 | shell-quote | 1.8.4  | 1.12.0        |
| Supabase CLI 2.98.2, a dev dependency           | tar         | 7.5.13 | 7.5.22        |

The shell-quote advisory affects quoting a string containing a line terminator after a comment token. It identifies 1.11.0 as the patched minimum. The tar advisory covers unbounded archive decompression and identifies 7.5.19 as the patched minimum. [shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), [tar advisory](https://github.com/advisories/GHSA-23hp-3jrh-7fpw).

The public registry reports stable shell-quote 1.12.0 and tar 7.5.22. Tar requires Node 18 or newer; this worktree uses Node 24. These updates stay within the installed major versions. [shell-quote metadata](https://registry.npmjs.org/shell-quote/1.12.0), [tar metadata](https://registry.npmjs.org/tar/7.5.22).

## Selected change

The manifest records exactly two parent-scoped overrides: `react-devtools-core > shell-quote` at 1.12.0 and `supabase > tar` at 7.5.22. Keep direct dependency versions fixed. The devtools range already allows the newer shell-quote. The CLI pins tar exactly, so its override requires an installer API compatibility check.

The current Supabase CLI installer fetches published GitHub release archives, gunzips them, and calls `extract({ cwd }, [binName])`. The new check resolves tar through the CLI dependency, loads its ESM import entry, and exercises that API using a tiny local text archive. It makes no backend request and downloads no CLI binary.

The registry's current Supabase CLI is 2.121.0 with a different dependency set. A CLI upgrade needs its own compatibility review. This task keeps CLI 2.98.2 and the application's Supabase JS client version fixed. [CLI metadata](https://registry.npmjs.org/supabase/2.121.0).

Remove an override when a reviewed parent update requires a patched dependency minimum and the resolved lock remains safe. Run the dependency check and critical audit when changing either parent or override. Updating the exact selected versions also requires updating the check's assertions.

## Reachability and verification limits

The dependency graph establishes installation, not application exploitability. The inspected application code does not directly call shell-quote. This review has not demonstrated remote command execution in Hafiz. The CLI's archive dependency participates in development installation. Its selected patch passed the recorded installer API check.

The quoting check calls the library with a fixed string and requires rejection. It never executes the result. The archive check uses a tiny fixture and never runs an exhaustion proof of concept.

RF-007's controller ran local npm resolution with lifecycle scripts disabled. Only shell-quote and tar changed in the lockfile. Their versions and integrity values match the selected public registry metadata. Parent-resolved version/API checks, critical-level npm audit, strict typecheck, all 60 unit suites and 276 tests, and static web export passed. The audit reports zero critical findings and 77 remaining findings, comprising one low, 16 moderate and 60 high. Those findings still require triage and remediation.

These checks do not prove every platform's CLI installation, browser interaction, native runtime behavior or absence of all security findings. Noncritical audit findings and Expo dependency alignment remain separate backlog work. No production system, database policy, migration or deployed function belongs to RF-007.
