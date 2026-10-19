# Ralph copy-only handoff investigation

RF-099's code passed every controller gate and independent review, but its generator violated the mechanical handoff scope. The command log records redundant hashes, transform/diff/path checks and full test dumps. A mistaken literal case count and a later regex probe failed before correction. Those were worker-process failures, not application regression failures. Original evidence is `.ralph/runs/RF-099-1-1792432503673389735/generator.jsonl` and its `review-result.json`.

## Root cause

The generic prompt told the worker to inspect callers and tests and use adaptive-coding engineering guided. The task simultaneously supplied exact artifacts and prohibited that extra work. The generic prompt also embedded all controller verification argv, although this worker did not own them. The task-specific instruction was already explicit; repeating it alone did not resolve the competing workflow.

## Change and ownership

The primary engineer prepared `scripts/ralph/control.py` and its runner regressions under both leases, following RF-079's primary-only workflow. That patch is committed as ab5c28c582d5297a7696890f001dac1d04a926c1. The live probe and complete primary-source review are recorded below. Normal Ralph workers still cannot edit the hard-denied runner paths.

Tasks may now declare `implementation_mode` as `copy-only`. The worker receives only installation instructions and a verification-command count. The full argv remain unchanged in the backlog and are executed by the controller. Project instructions and readiness/reuse metadata reads remain allowed. Verification, source inspection, full source/test dumps, redesign and self-certification are excluded from this installation role. The worker reports installed paths and pending controller verification.

Tasks with no mode, or explicit `implementation`, keep the previous full implementation prompt. Unknown modes fail before the controller increments attempts or changes task status. The new copy-only evaluator instruction requires review of the original generator command log and rejection of prohibited checks or source dumps, even when copied bytes are correct. Checkpoint recovery points the evaluator at the original generation evidence.

No model, provider, billing, token/time/memory/retry setting, pinned vendor, protected-path rule, lease, checkpoint or verification mechanism changed. Agent prompts are guidance, not a sandbox. Independent review and primary inspection remain necessary; one successful probe cannot guarantee future compliance.

## Executed preparation checks

The 27 original runner tests pass. Five new regressions fail against the original adapter. All 32 pass with the candidate and again after the primary patch is installed. Python compilation and whitespace checks pass. Preparation records preserve a mistaken reviewer-prefix assumption and a test-log parser fix for unittest stderr. No ordinary Ralph attempt was spent on those preparation errors.

All existing adapter function ASTs except `iteration` remain identical, with one new prompt renderer. Evaluating the default prompt against the frozen original expression produces identical bytes. The existing normal implementation path, protected paths, resource stop/recovery and independent verification tests remain in the suite.

## Observed live outcome

RF-100 is accepted on 2026-10-20 local date. Primary source preparation is ab5c28c; the real pinned Ralph probe is ea0163a. All four exact fresh controller commands pass, including all 32 runner tests, hash/ownership checks, actual prompt rendering and whitespace validation. A fresh Astra evaluator reviewed both complete Python files, the full primary patch, all five regressions, preparation evidence, current diff and original generator transcript. Primary acceptance after lease release confirms exact source/artifact/protected hashes, argv and task lifecycles. The receipt is `.refactor-baseline/rf100-primary-acceptance.json`.

The first live attempt failed independent review because the worker omitted the four required project documents. Its exact copy and controller gates passed, but that did not satisfy instruction compliance. The retry names those existing requirements explicitly and keeps the spent ordinary attempt. The accepted transcript contains 19 successful commands: 17 instruction/metadata reads, including size and repeated reads, one status/branch command and one exact copy. It includes every required document and all 585 pre-copy progress lines. No prohibited checks, source/test dumps, helpers or unrelated mutation occurred.

The retry generator crossed the unchanged 600000 reported-token admission threshold at 975039 tokens. A checkpoint continuation reran all four checks but its evaluator stopped at the provider account limit without a verdict. Both stops preserved generation and spent no additional ordinary attempt. After capacity returned, the matching checkpoint was reused, all four checks ran fresh again and a new evaluator passed. The final review batch reports 1511972 tokens. Turn totals arrive after completion, so this threshold is not a hard per-turn cap. The earlier provider-stop usage remains unknown, not zero. No purchase, reset credit or provider change occurred.

Review logs preserve a failed JSONL parser probe and an incorrect 20-command expectation. Primary exact-output checks confirm 19 commands. The first primary receipt probe also wrongly expected checkpoint deletion; it stopped before writing a receipt. The retained checkpoint matches the parent HEAD and cannot match the accepted commit. It was preserved. These evidence-probe corrections did not change source, tests or gates.

The accepted report bytes remain recorded at ea0163a. This observed-outcome section and the operational/convention notes are primary documentation updates after source acceptance. No future worker compliance or general token reduction is claimed.

Application unit tests, web/native builds, browser/device tests and production checks were not run for this runner-only change. No application source, data or dependency changed.

## Supporting guidance

OpenAI's [prompt and skill guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) describes how broad or conflicting instructions can load irrelevant workflows and recommends contextual reads. The local failure log establishes this defect; the guidance does not guarantee that a prompt change will enforce behavior.
