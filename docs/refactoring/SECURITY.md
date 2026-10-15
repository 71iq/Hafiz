# Dependency security decisions

The primary engineer reviewed this scope on 2026-10-16. RF-007 owns implementation and acceptance. Its backlog record and controller logs own verification status.

## Critical dependency paths

Before RF-007, package-lock.json records these paths:

| Parent                                          | Dependency  | Installed | Selected patch |
| ----------------------------------------------- | ----------- | --------- | -------------- |
| React Native 0.83.2 / react-devtools-core 6.1.5 | shell-quote | 1.8.4     | 1.12.0         |
| Supabase CLI 2.98.2, a dev dependency           | tar         | 7.5.13    | 7.5.22         |

The shell-quote advisory affects quoting a string containing a line terminator after a comment token. It identifies 1.11.0 as the patched minimum. The tar advisory covers unbounded archive decompression and identifies 7.5.19 as the patched minimum. [shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), [tar advisory](https://github.com/advisories/GHSA-23hp-3jrh-7fpw).

The public registry reports stable shell-quote 1.12.0 and tar 7.5.22. Tar requires Node 18 or newer; this worktree uses Node 24. These updates stay within the installed major versions. [shell-quote metadata](https://registry.npmjs.org/shell-quote/1.12.0), [tar metadata](https://registry.npmjs.org/tar/7.5.22).

## Selected change

Use parent-scoped overrides for react-devtools-core's shell-quote and the Supabase CLI's tar. Keep direct dependency versions fixed. The devtools range already allows the newer shell-quote. The CLI pins tar exactly, so its override requires an installer API compatibility check.

The current Supabase CLI installer fetches published GitHub release archives, gunzips them, and calls `extract({ cwd }, [binName])`. The new check resolves tar through the CLI dependency, loads its ESM import entry, and exercises that API using a tiny local text archive. It makes no backend request and downloads no CLI binary.

The registry's current Supabase CLI is 2.121.0 with a different dependency set. A CLI upgrade needs its own compatibility review. This task keeps CLI 2.98.2 and the application's Supabase JS client version fixed. [CLI metadata](https://registry.npmjs.org/supabase/2.121.0).

Remove an override when a reviewed parent update requires a patched dependency minimum and the resolved lock remains safe. Run the dependency check and critical audit when changing either parent or override. Updating the exact selected versions also requires updating the check's assertions.

## Reachability and verification limits

The dependency graph establishes installation, not application exploitability. The inspected application code does not directly call shell-quote. This review has not demonstrated remote command execution in Hafiz. The CLI's archive dependency participates in development installation, and its selected patch still needs the recorded controller checks.

The quoting check calls the library with a fixed string and requires rejection. It never executes the result. The archive check uses a tiny fixture and never runs an exhaustion proof of concept.

RF-007's first controller command runs local npm resolution with lifecycle scripts disabled. The generator must not hand-edit the lockfile. Review any changed package beyond the selected pair before accepting it. Critical audit, strict typecheck, the full unit suite and static web export must pass afterward.

These checks do not prove every platform's CLI installation, browser interaction, native runtime behavior or absence of all security findings. Noncritical audit findings and Expo dependency alignment remain separate backlog work. No production system, database policy, migration or deployed function belongs to RF-007.
