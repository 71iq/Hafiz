# Ralph copy-only handoff investigation

RF-099's code passed every controller gate and independent review, but its generator violated the mechanical handoff scope. The command log records redundant hashes, transform/diff/path checks and full test dumps. A mistaken literal case count and a later regex probe failed before correction. Those were worker-process failures, not application regression failures. Original evidence is `.ralph/runs/RF-099-1-1792432503673389735/generator.jsonl` and its `review-result.json`.

## Root cause

The generic prompt told the worker to inspect callers and tests and use adaptive-coding engineering guided. The task simultaneously supplied exact artifacts and prohibited that extra work. The generic prompt also embedded all controller verification argv, although this worker did not own them. The task-specific instruction was already explicit; repeating it alone did not resolve the competing workflow.

## Change and ownership

The primary engineer prepared `scripts/ralph/control.py` and its runner regressions under both leases, following RF-079's primary-only workflow. That patch is committed as ab5c28c582d5297a7696890f001dac1d04a926c1. It remains subject to review with this task. Normal Ralph workers still cannot edit the hard-denied runner paths.

Tasks may now declare `implementation_mode` as `copy-only`. The worker receives only installation instructions and a verification-command count. The full argv remain unchanged in the backlog and are executed by the controller. Project instructions and readiness/reuse metadata reads remain allowed. Verification, source inspection, full source/test dumps, redesign and self-certification are excluded from this installation role. The worker reports installed paths and pending controller verification.

Tasks with no mode, or explicit `implementation`, keep the previous full implementation prompt. Unknown modes fail before the controller increments attempts or changes task status. The new copy-only evaluator instruction requires review of the original generator command log and rejection of prohibited checks or source dumps, even when copied bytes are correct. Checkpoint recovery points the evaluator at the original generation evidence.

No model, provider, billing, token/time/memory/retry setting, pinned vendor, protected-path rule, lease, checkpoint or verification mechanism changed. Agent prompts are guidance, not a sandbox. Independent review and primary inspection remain necessary; one successful probe cannot guarantee future compliance.

## Executed preparation checks

The 27 original runner tests pass. Five new regressions fail against the original adapter. All 32 pass with the candidate and again after the primary patch is installed. Python compilation and whitespace checks pass. Preparation records preserve a mistaken reviewer-prefix assumption and a test-log parser fix for unittest stderr. No ordinary Ralph attempt was spent on those preparation errors.

All existing adapter function ASTs except `iteration` remain identical, with one new prompt renderer. Evaluating the default prompt against the frozen original expression produces identical bytes. The existing normal implementation path, protected paths, resource stop/recovery and independent verification tests remain in the suite.

## Required live probe

This report is the harmless artifact for the real pinned Ralph copy-only iteration. Its worker may install only this supplied document. The controller must rerun the frozen hash/ownership checks, all runner tests, actual task prompt rendering and whitespace validation. A fresh stronger evaluator must inspect the complete primary patch diff from its parent through ab5c28c582d5297a7696890f001dac1d04a926c1, the task diff, fresh logs and the original generator command log. It must reject prohibited generator checks or full dumps. Primary acceptance will record the observed command list, result and limits in `.refactor-baseline/rf100-primary-acceptance.json`. This candidate report does not certify that the live probe has passed.

Application unit tests, web/native builds, browser/device tests and production checks were not run for this runner-only change. No application source, data or dependency changed.

## Supporting guidance

OpenAI's [prompt and skill guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) describes how broad or conflicting instructions can load irrelevant workflows and recommends contextual reads. The local failure log establishes this defect; the guidance does not guarantee that a prompt change will enforce behavior.
