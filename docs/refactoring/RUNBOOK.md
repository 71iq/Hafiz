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

A completed generation now has a controller-owned checkpoint at `.ralph/generation-checkpoint.json`. When a batch ends before verification or review, resume can reuse that generation only if the task specification, configuration, Git HEAD, index and exact candidate files still match. The next batch reruns every controller verification command and starts a fresh independent evaluator. Changed input returns to the generator. A failed command or rejected review invalidates the checkpoint and preserves its record in the failed run directory. A checkpoint never marks a task complete.

For a blocked task, inspect its evidence, current Git diff and failure first. The primary engineer repairs or narrows the task, records the diagnosis, changes only that item's status to retry and resets attempts when justified, then runs refactor:resume. No reset, clean, forced checkout, blind deletion or automatic discard occurs. Other tasks proceed only after the worktree is coherent.

The controller requires an active batch identity and the dedicated branch for direct iterations. It stages only selected task files and its own progress records, checks staged paths and the complete diff, runs task commands itself and requires a separate read-only evaluator to pass. Agent self-reported success cannot complete a task.

The initial first four ready items are intentionally small. The remaining workstream items need the primary engineer to choose the next exact file set and acceptance evidence. That is engineering preparation under the existing authorization, not a request for user permission on every change.

## Budget-aware continuation

The active thread heartbeat `hafiz-modernization-supervisor` checks hourly at 45 minutes past the hour. It inspects account usage and writer locks first. It starts at most one bounded Ralph iteration only when five-hour usage is below 95 percent and weekly usage is below 90 percent. Unknown usage or an active writer prevents a new batch. Routine unchanged/budget-blocked checks remain quiet. No reset credits, purchases or provider switching are authorized.

The supervisor reads current progress and scopes later work as primary engineer. It never replaces the Ralph implementation/evaluation loop. Pause the supervisor only when the mission actually meets its documented completion criteria or the user requests a stop.

Read backlog.json and the matching generation checkpoint to identify unfinished work. Do not infer current task state from an older progress entry. The user raised the five-hour threshold to 95 percent on 2026-10-16. The weekly threshold remains 90 percent.

## SDK 55 verification slice

RF-067 changes only package.json; the controller resolves package-lock.json and runs 15 frozen commands. SDK55_ALIGNMENT.md records the selected versions and preflight. The default-resolution step is followed by strict installation and full npm graph validation. No force or legacy-peer option is used. Native fixes and the CSS interop patch run explicitly with lifecycle scripts disabled.

This Ubuntu host uses the installed Chrome channel. The smoke command sets CI=1, PLAYWRIGHT_CHROMIUM_CHANNEL=chrome, PLAYWRIGHT_PORT=8193 and PLAYWRIGHT_BASE_URL=http://127.0.0.1:8193. CI requires a fresh server. PLAYWRIGHT_CHROMIUM_CHANNEL is optional; existing behavior stays unchanged when absent. A bundled Chromium download failed on ubuntu26.04-x64. Do not replace the user's Chrome installation.

The Android command compiles debug only with JDK 21 and SDK 36. Keep existing time/retry limits and inspect real Gradle children and locks after any termination. iOS builds, device installation, production and deployment remain outside this slice. RF-008 still owns remaining full-project diagnostics.

## Android memory recovery

The first RF-067 native pass reached the 6 GiB systemd limit and ended with oom-kill. It passed all fourteen earlier gates. Gradle's two-worker setting did not constrain Ninja's separate compiler jobs. The actual AGP 8.13 model invokes Ninja without a job flag. No source compile failure was reported.

`python3 scripts/ralph/build-android-debug.py` now selects the first two CPUs allowed by Linux process affinity, uses one Gradle worker and execs the real assembleDebug command with JDK 21/SDK 36. All configured ABIs remain. The actual installed Ninja probe observed 12 parallel harmless jobs normally and three with two-CPU affinity. Evidence .refactor-baseline/ninja-affinity-probe/results.json. No native project, signing configuration, memory cap or deadline changed.

The kernel resource interruption is retained under RF-067 resource_failures and does not spend an implementation retry. The earlier handoff failure still counts. A fresh generation is required because installation changed the lock; fresh controller gates and independent review remain mandatory. Inspect real locks and Gradle children before resuming.

The bounded retry avoided OOM and compiled Nitro Modules, Worklets and Reanimated for all four ABIs. It then reached the 900-second deadline during app arm64 compilation. The controller previously treated this as an implementation failure and invalidated generation. A real-subprocess regression now verifies resource accounting, checkpoint retention, repeated verification, independent review and escalation after two timeouts. All 25 runner tests pass. The historical timeout is recorded as resource_timeouts=1, leaving one bounded continuation with the existing incremental build output. Another timeout blocks RF-067 for a smaller verification plan. Memory, deadline, ABI coverage and all fifteen acceptance commands remain unchanged. Native success is still pending.
