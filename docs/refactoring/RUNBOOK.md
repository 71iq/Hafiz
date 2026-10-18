# Ralph operations

Run commands from the isolated worktree `/home/ehab/.codex/worktrees/hafiz-modernization/Hafiz`. The branch must be `codex/hafiz-modernization`. The original checkout is not a loop target.

## Installed runner and skills

The actual loop is SantanderAI/ralph, pinned at `0b710b21802913fea395b7db7fa9b886518eee1b`. Its official installer copied the unmodified script into scripts/ralph/vendor with `--no-skills`. The local controller is an adapter around its configurable Codex command. It supplies task selection, independent review, machine-run checks, scoped commits and recovery. Every generator and evaluator invocation is a new `codex exec` session.

The original snarktank script documents Amp/Claude. ralphctl 0.26.0 was installed and inspected because it supports Codex and an evaluator, but that release exposes its implement flow through the interactive TUI, not a documented headless command in CLI help. It is not the unattended runner. [Santander installation/configuration](https://github.com/SantanderAI/ralph), [original Ralph](https://github.com/snarktank/ralph), [ralphctl](https://github.com/lukas-grigis/ralphctl).

Codex CLI 0.160.1 is installed and reports an authenticated ChatGPT session. It uses the existing user authentication; no key was copied or purchased. Config uses the available gpt-5.6-luna for bounded mechanical implementation and the current configured gpt-6-astra for independent evaluation, both at high effort. The primary engineer retains architecture and acceptance. Tooling and model selections must be rechecked before changing them.

Official Codex marketplace installs added `expo` and `superpowers`. They become available in fresh sessions. The curated Expo plugin currently contains older skill names than upstream main; inspect its installed catalog instead of assuming a name. Vercel React Native and composition skills were installed into `.agents/skills` using Codex's skill installer. The official `ai-agent-standards init` command installed reuse-first-authoring and its reference docs. The Claude copy is part of that install but the runner uses Codex. amragl/codebase-review is Claude-oriented; its evidence, modularization and audit checklists informed AUDIT.md, while execution uses the native Codex evaluator and installed verification skill. jscpd is a pinned analysis CLI, not an agent skill.

Review upstream instructions before adopting them. The mission and Hafiz constraints remain authoritative. No deployment plugin or paid EAS operation runs as part of this setup.

## Commands

```sh
npm run test:refactor-runner
python3 scripts/ralph/control.py smoke
npm run refactor:start -- --iterations 3
npm run refactor:status
npm run refactor:stop
npm run refactor:resume -- --iterations 3
```

`stop` is graceful. It writes a controller-owned stop.md, lets the current iteration settle, and prevents the next one. `resume` removes only a controller-owned stop marker. It never clears an arbitrary user stop file. To inspect live logs, use `tail -f .ralph/logs/iteration-*.log`, `.ralph/events.jsonl`, the batch log named by status and task directories under `.ralph/runs/`. Status reports metadata from the last batch; a recorded PID or start time alone is not proof it is still alive. Use `ps -p PID` or the writer lock to verify process state.

For persistence beyond a shell session, launch in tmux and inspect the session separately:

```sh
tmux new-session -d -s hafiz-modernization -c /home/ehab/.codex/worktrees/hafiz-modernization/Hafiz 'npm run refactor:start -- --iterations 3'
tmux capture-pane -pt hafiz-modernization -S -80
```

A tmux session can exit when its bounded batch finishes. Do not describe it as running after it has exited. The primary engineer can launch the next bounded batch after checking status and refining ready tasks. No cron or limitless restart policy is installed.

## Limits and recovery

Defaults in scripts/ralph/config.json allow at most three iterations, two attempts per task, 15 minutes per agent/check and 90 minutes per batch. A 600,000 reported-token admission limit stops additional sessions after a completed turn crosses it. Codex reports token usage after a turn, so one turn can exceed the threshold. This is not a hard dollar cap. Unknown usage after termination exhausts the batch rather than counting as zero. No credits or paid resources are purchased automatically.

The upstream runner requests a 6 GiB process memory scope. If systemd user scopes are unavailable it prints a warning; then time/iteration limits still apply, but the kernel RAM limit does not. Batch logs record the actual enforcement result. Tool rotation is disabled, avoiding silent switching to another account/provider.

The controller and each worker acquire file locks that descendants inherit. This prevents a second writer while a surviving child still owns the worktree. SIGTERM writes a stop signal and reaps the child before releasing its lease. A SIGKILL can leave a child running, so inspect process state and lock ownership before restarting. Never delete lock files to bypass an owner.

State writes use atomic replacement. An interrupted running/retry task resumes before new work. Startup reconciles an uncommitted verified record against the committed backlog and re-verifies it. Retry exhaustion preserves the diff, records an exact failure and stops. A path/controller invariant violation stops immediately. Resource exhaustion ends the batch without spending an implementation retry. Command timeouts have a separate cumulative limit of two per task, configured by max_resource_timeouts. The second timeout blocks the task for primary diagnosis. Batch token/time admission stops do not consume that timeout allowance. Each completed verification command persists its evidence before the next command starts.

A completed generation now has a controller-owned checkpoint at `.ralph/generation-checkpoint.json`. When a batch ends before verification or review, resume can reuse that generation only if the task specification, configuration, Git HEAD, index and exact candidate files still match. The next batch reruns every controller verification command and starts a fresh independent evaluator. Changed input returns to the generator. A command returning a failing exit code or a rejected review invalidates the checkpoint and preserves its record in the failed run directory. A checkpoint never marks a task complete.

The observed Codex account-limit failure now stops the batch without spending an implementation retry or discarding completed generation. Recognition requires the last terminal JSONL event to be turn.failed with the observed usage-limit message prefix. Tool output, generic error events, other failures and a later completed turn cannot trigger this exception. Unknown usage still exhausts the batch. This handles a resource stop, never a passing review. Recheck live account usage and writer locks before resuming. No purchase, reset-credit use or provider switch occurs. The JSONL event types are documented in [official OpenAI documentation](https://learn.chatgpt.com/docs/non-interactive-mode). The exact error prefix comes from the installed CLI's preserved failure, not a documented stable error code.

For a blocked task, inspect its evidence, current Git diff and failure first. The primary engineer repairs or narrows the task, records the diagnosis, changes only that item's status to retry and resets attempts when justified, then runs refactor:resume. No reset, clean, forced checkout, blind deletion or automatic discard occurs. Other tasks proceed only after the worktree is coherent.

The controller requires an active batch identity and the dedicated branch for direct iterations. It stages only selected task files and its own progress records, checks staged paths and the complete diff, runs task commands itself and requires a separate read-only evaluator to pass. Agent self-reported success cannot complete a task.

The initial first four ready items are intentionally small. The remaining workstream items need the primary engineer to choose the next exact file set and acceptance evidence. That is engineering preparation under the existing authorization, not a request for user permission on every change.

## Budget-aware continuation

The active thread heartbeat `hafiz-modernization-supervisor` checks hourly at 45 minutes past the hour. It inspects account usage and writer locks first. It handles one work item per heartbeat when five-hour usage is below 93 percent and the provider still allows account usage. A checkpoint continuation or diagnosed retry of that same item can start another bounded batch after fresh usage and lease checks. Keep every batch, timeout, token and ordinary retry limit unchanged; do not advance a second work item in that heartbeat. There is no reserved weekly percentage. Unknown usage, exhausted provider allowance or an active writer prevents a new batch. Routine unchanged/budget-blocked checks remain quiet. No reset credits, purchases or provider switching are authorized.

The supervisor reads current progress and scopes later work as primary engineer. It never replaces the Ralph implementation/evaluation loop. Pause the supervisor only when the mission actually meets its documented completion criteria or the user requests a stop.

Read backlog.json and the matching generation checkpoint to identify unfinished work. Do not infer current task state from an older progress entry. The user removed the 10 percent weekly reserve on 2026-10-16 and lowered the five-hour stop to 93 percent on 2026-10-17. Use remaining weekly capacity until the provider exhausts it. Keep the five-hour stop, bounded batches and existing prohibition on purchases, reset credits and provider switching.

## SDK 55 verification slice

RF-067 changes only package.json; the controller resolves package-lock.json and runs 15 frozen commands. SDK55_ALIGNMENT.md records the selected versions and preflight. The default-resolution step is followed by strict installation and full npm graph validation. No force or legacy-peer option is used. Native fixes and the CSS interop patch run explicitly with lifecycle scripts disabled.

This Ubuntu host uses the installed Chrome channel. The smoke command sets CI=1, PLAYWRIGHT_CHROMIUM_CHANNEL=chrome, PLAYWRIGHT_PORT=8193 and PLAYWRIGHT_BASE_URL=http://127.0.0.1:8193. CI requires a fresh server. PLAYWRIGHT_CHROMIUM_CHANNEL is optional; existing behavior stays unchanged when absent. A bundled Chromium download failed on ubuntu26.04-x64. Do not replace the user's Chrome installation.

The Android command compiles debug only with JDK 21 and SDK 36. Keep existing time/retry limits and inspect real Gradle children and locks after any termination. iOS builds, device installation, production and deployment remain outside this slice. RF-008 still owns remaining full-project diagnostics.

## Android memory recovery

The first RF-067 native pass reached the 6 GiB systemd limit and ended with oom-kill. It passed all fourteen earlier gates. Gradle's two-worker setting did not constrain Ninja's separate compiler jobs. The actual AGP 8.13 model invokes Ninja without a job flag. No source compile failure was reported.

`python3 scripts/ralph/build-android-debug.py` now selects the first two CPUs allowed by Linux process affinity, uses one Gradle worker and execs the real assembleDebug command with JDK 21/SDK 36. All configured ABIs remain. The actual installed Ninja probe observed 12 parallel harmless jobs normally and three with two-CPU affinity. Evidence .refactor-baseline/ninja-affinity-probe/results.json. No native project, signing configuration, memory cap or deadline changed.

The kernel resource interruption is retained under RF-067 resource_failures and does not spend an implementation retry. The earlier handoff failure still counts. A fresh generation is required because installation changed the lock; fresh controller gates and independent review remain mandatory. Inspect real locks and Gradle children before resuming.

The bounded retry avoided OOM and compiled Nitro Modules, Worklets and Reanimated for all four ABIs. It then reached the 900-second deadline during app arm64 compilation. The controller previously treated this as an implementation failure and invalidated generation. A real-subprocess regression verifies resource accounting, checkpoint retention, repeated verification, independent review and escalation after two timeouts. The historical timeout is recorded as resource_timeouts=1. Another timeout blocks RF-067 for a smaller verification plan. Memory, deadline, ABI coverage and all fifteen acceptance commands remain unchanged.

The next real run passed all fifteen commands. Android assembleDebug succeeded in 14m 5s with all configured ABIs. Its independent evaluator then received an account usage-limit failure and returned no verdict, leaving RF-067 unaccepted at that boundary. Evidence .ralph/runs/RF-067-2-1792131849249493778. The account-limit regression and existing safeguards pass all 27 runner tests. Recovery retained the ordinary handoff failure and the one command-timeout count; only the account resource interruption was refunded. The changed controller/HEAD required fresh generation, all checks and a separate review.

The subsequent run passed all fifteen fresh commands and independent Astra evaluation, local commit f863a2b. Primary accepted exact hashes, reviewed scope and the debug APK's four ABIs. SDK55_ALIGNMENT.md records current diagnostics. RF-067 is verified; do not reopen it based on the older recovery entries. No iOS/device runtime check passed here.

## Implementation and evaluation ownership

The implementation worker edits one approved task and reports its own checks. It does not start subagents or reviewers. The controller runs every frozen verification command and starts the separate stronger evaluator. Primary retains architecture, security and final acceptance.

Task-specific verification ownership applies when the implementation sandbox cannot bind a browser server. A documented sandbox restriction alone does not make controller verification unavailable. The worker reports the pending command and restriction without claiming a pass. Missing infrastructure at the assigned verifier remains a blocker. This changes no task gate, independent review, retry, checkpoint, admission limit, model or provider setting.

## Native JavaScript export memory

RF-091 first ran both platforms together with two Metro workers. Its systemd scope reached 6 GB and reported oom-kill after nine successful gates. The candidate and failure remain preserved. Primary records that resource interruption and refunds only its ordinary attempt. That recovery required fresh generation and all 13 commands. Android and iOS exports ran in separate processes with one worker and NODE_OPTIONS=--max-old-space-size=2048. Both platforms, the 6 GB scope and 900-second command deadline remain. A second memory failure needs primary diagnosis before another refund. JavaScript export is separate from native compilation and device verification. Evidence .refactor-baseline/rf091-native-oom-recovery.json.

The second RF-091 export hit its 2 GB V8 heap limit. Primary diagnosis then found a separate ASCII-output serialization failure, with data modules alone exceeding Node string length. Both full Unicode-output preflights pass with one worker and a 4 GB heap inside the unchanged 6 GB group cap. Both reach the cap with pressure and zero OOM, so do not claim memory headroom. Attempt 1 remains spent, with no second refund. The revised 15-command plan requires fresh generation, every gate and separate evaluation. The data files and loader mappings remain untouched and hash-pinned. Evidence .refactor-baseline/rf091-unicode-readiness.json. Native JavaScript export does not prove bytecode, native compilation or device runtime.

RF-091 subsequently passes all 15 fresh controller commands, independent Astra and primary scope/hash acceptance, local commit 68f526a. Current native JavaScript verification runs Android then iOS with one worker and NODE_OPTIONS=--max-old-space-size=4096. The minifier preserves literal Unicode, and both output hashes match successful preflight. Keep the 6 GB group cap, 900-second deadlines, ordinary retry count and all original failure evidence. RF-039 still owns the roughly 530 MB native payload and runtime profiling. No bytecode/native compilation or device runtime is implied.

## Formatting controller state and proposed files

The controller writes backlog.json with Python JSON serialization and indent=2. Preserve that serialization when preparing a task; a whole-file Prettier rewrite creates unrelated changes. Validate JSON, task dependencies, semantic scope and the diff. The baseline backlog already differs from Prettier output.

Prettier ignores .refactor-baseline. For a proposed artifact there, use --ignore-path /dev/null with only the exact named source/document files, or format through stdin with the intended source filename. Check --file-info if a formatting pass reports no change unexpectedly. Run the exact final regression after formatting and pin those final bytes. Never apply the override to protected assets or broad directories.

The RF-092 cold check also found that Jest scans ignored preflight package manifests. Preserve real registry archives under an evidence subdirectory containing node_modules, with original paths retained as symlinks when existing receipts reference them. Git/Prettier ignore rules do not define Jest module lookup. Original warning logs remain; RF-093 owns the source-level generated-evidence boundary and must preserve the full test inventory.

Jest module ignore strings are regular expressions. Escape literal directory dots and check both positive generated paths and negative source/lookalike paths. RF-093's original exact artifact passed its inventory/full suite and independent review but failed primary boundary checks. The corrected configuration is checkpointed. Its recovery scope requires fresh generation, all six gates and a new independent review, with the first ordinary attempt still spent.

RF-086 is verified and accepted, local commit 4e6892d, after seven fresh controller gates and independent Astra. Primary has diagnosed RF-093's second failure as that pre-existing fixture blocker and credits exactly one attempt after the repair is accepted. The original wildcard specification failure still consumes one attempt; max_attempts stays two. The original failed runs and source checkpoint remain preserved. Record .refactor-baseline/rf093-primary-recovery.json. No automatic additional credit or generation-checkpoint edit is authorized.

RF-093 is now verified and accepted, local commit 2b101a4, after all six fresh controller gates and new independent Astra. Its permanent regression passes two cases, unchanged discovery contains 66 source test files and the cold suite passes 374 cases without skips or collision. The config checkpoint, lock and RF-086 fixture remain unchanged. Record .refactor-baseline/rf093-primary-acceptance.json. Both historical failures and the single diagnosed credit stay preserved. This heartbeat completes RF-093 only. Prepare the next exact unapproved scope before another capacity-checked heartbeat; do not launch a second distinct item.
