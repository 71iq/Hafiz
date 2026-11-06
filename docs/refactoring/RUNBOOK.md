# Modernization operations

The 2026-11-06 user instructions below supersede older task descriptions and retained Git history. Historical artifact paths in accepted backlog records are retired evidence links, not required inputs or instructions to restore a handoff.

## Scope and ownership

Work only in `/home/ehab/.codex/worktrees/hafiz-modernization/Hafiz` on `codex/hafiz-modernization`. Preserve the original checkout, protected Quran/content/font/database inputs and offline behavior. No push, merge, deployment, production operation, credit purchase or billing-provider change.

Primary owns architecture, privacy/security, ambiguous data behavior and final acceptance. Use a bounded worker for implementation and a separate stronger reviewer. Read the current task and inspect its callers/tests before editing. Implement in the working source, without copy-only handoffs, frozen artifacts or hash-pinned verification scripts.

## Task cycle

1. Check the actual branch, source changes, controller/writer locks and surviving children. Only one writer may own the worktree. Never delete lock files to bypass an owner.
2. Choose a small task from actual backlog status, adding discovered app issues when justified. Prefer bugs/data safety, performance, accessibility/UX, then features. Keep dev/build-only advisories in RF090 at low priority. Vendor patches require an affected shipped-app path.
3. Implement directly, or let the bounded worker implement. Use focused tests, typecheck and changed-file lint during iteration. Preserve meaningful regression assertions.
4. When ready, run the full controller task checks once. If a check fails, fix it and rerun. Environment warnings, unrelated output and worker command history are not acceptance gates. Do not fail or retry for Codex plugin, watcher, skills or sandbox log lines.
5. Obtain independent code review and primary final acceptance. Review findings concern the implementation, behavior, tests and actual check results. A passing build is not device verification.
6. Make one local commit for the accepted task and its short PROGRESS note. No preparation, evidence, retry or diagnostic commits. Report the task, user effect and passed checks.
7. Delete the accepted task's baseline directories and per-run logs, then start the next task immediately. A bounded batch ending is not project completion.

Record a decision or unavailable device, iOS host, account or payment as a blocker and continue independent app work. Never claim an unavailable platform was verified.

## Runner and safeguards

The pinned SantanderAI Ralph loop remains the unattended runner; its vendor script stays unchanged. Use the existing configured models, authentication and provider. The primary may implement a task and invoke the same controller verification/review functions directly for protected controller-owned changes.

```sh
npm run refactor:status
npm run refactor:resume -- --iterations 1
npm run refactor:stop
npm run test:refactor-runner
```

Use normal implementation mode for future tasks. Required task metadata can be prepared without a separate commit. The controller retains its two-attempt diagnosis window, at most three iterations per invocation, 900-second child deadlines and 90-minute batch limit. These bound failures, not the mission. After a concrete correction, continue another bounded attempt rather than stopping on attempt count alone.

Keep the 6 GiB process scope, zero swap and inherited nonblocking orchestrator/writer leases. Terminate only owned process groups. Inspect surviving children after interruption. Matching source checkpoints may resume after interruption, but checks and independent review remain mandatory. Checkpoint identity is recovery bookkeeping, not a worker-command audit.

The user removed usage-percentage, unknown-telemetry and token-admission stops. Do not buy credits, use reset credits or switch billing providers. Record actual provider refusal and continue when execution becomes available.

## Full checks

Each ready task keeps its full verification commands in backlog.json. Use ordinary project checks rather than old artifact verifiers: typecheck, lint, full Jest and relevant tooling regressions, native-config/boundary checks, scoped formatting, production web export and real Chrome smoke. Retain applicable dependency/lifecycle and Android/iOS JavaScript export checks. Build native targets and exercise device flows where the task needs them and infrastructure permits.

Use sanitized public configuration for builds and preview writes. Browser smoke uses the installed Chrome channel and a fresh local server. Native JavaScript exports run separately with one worker, no bytecode and the established Android 4096 MiB / iOS 3072 MiB heap under the 6 GiB scope. Write temporary exports under `.expo`, and remove each immediately after its check. Exports do not establish native compilation, startup, runtime memory or device behavior.

Known lint warnings, Knip findings and dependency advisories stay visible. The small `dependency-analysis/knip.json` input calibrates current existing unused-code findings; it is not a clean report. Never disable a rule/test or hide a new issue to get green output. Dev/build advisory reports are low-priority work, not proof of a shipped exploit.

## Evidence and storage

Keep `.refactor-baseline` below 2,000,000,000 bytes. Keep only current shared check inputs and small reproductions read by unfinished tasks. Runtime fixtures create their own directories and do not need historical output. Remove task artifacts and logs as soon as the task is accepted. Keep `.ralph/events.jsonl`, current config/locks and unfinished-task logs. Keep only a few lines of outcome, check results and blockers per task in docs.

On 2026-11-06 cleanup reduced allocated baseline storage from 23,701,917,696 to 86,016 bytes. Kept only the current dependency-analysis baseline and the RF104 SQLite tafsir-loss reproduction/result in its historical RF098 directory. The old RF025 diagnostic is covered by permanent accepted tests. All17current-source checks and independent review pass. Accepted-task run logs were deleted; the event log and live configuration/leases remain. Installed dependencies have no links into removed evidence.
