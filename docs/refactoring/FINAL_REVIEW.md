# Final review

RF049, 2026-11-08, at commit 68cf75e. An independent high-effort reviewer read the branch against AGENTS.md, the decisions in this folder and the backlog, sampling the riskiest diffs. It ran no builds; the primary engineer ran the gates and device checks.

## Result

No blockers. The branch merges into main without conflicts.

Checked and sound:

- **Protected content.** `git diff main...HEAD -- assets/` is empty; NOTICE.md and app.json are unchanged. All 1,158 native dataset loaders map one to one to existing `assets/data` files, the same count as main.
- **Sync.** The server trigger keeps the newer row on the 8 synced tables and matches the client rule. Deletes only remove rows no newer than the delete time, account restore runs in one transaction, and every step checks the signed-in owner and expected user id. Old queue entries pass the new decoders.
- **Policies.** Likes keep insert and delete only, the counter functions run as their owner with a fixed search path, and the client works before the migrations are applied.
- **Secrets and patches.** No secrets in the diff; patched package versions match the lock and apply on install.

## Findings and dispositions

| Severity | Finding                                                                                                                                                                                                         | Disposition                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | AGENTS.md and RUNBOOK.md carry the branch-only "Autonomous modernization branch" rules (local commits only, no push or deploy). Merged as is, they would contradict main's commit-and-push and deploy guidance. | Merge preparation: remove that section and RUNBOOK's copy when merging. Reconcile with the uncommitted AGENTS.md and CLAUDE.md in the original checkout. |
| Medium   | Four committed symlinks under `.agents/skills` and `.claude/skills` point to `/home/ehab/.codex/skills/...`.                                                                                                    | Committed deliberately for this checkout (0520c7e). Merge preparation: drop them from the merge or keep them local.                                      |
| Medium   | Loop tooling and ledgers (scripts/ralph, refactor npm scripts, backlog.json, PROGRESS.md, analysis summaries) and hardcoded home paths in RUNBOOK, BASELINE, TOOLING and one script.                            | They run this branch's workflow. Merge preparation: decide which docs stay (ARCHITECTURE, CONVENTIONS, TECH_STACK, decisions) and move the ledgers out.  |
| Low      | Stale Gradle comment about inlined datasets.                                                                                                                                                                    | Fixed in dfdd4c8.                                                                                                                                        |

## Risks to keep in mind

- Strict decoders fail closed: one malformed remote row stops that table's pull and later tables, and account restore. This protects local data from bad rows but will surface as a sync error until the row is fixed on the server.
- Signing out keeps local data and the pending queue, and the next account with no remote rows adopts it. Main behaves the same; it follows the "local data belongs to the device" decision (RF025).
- A push to main deploys production through `.github/workflows/hetzner-deploy.yml`. The three migrations from this branch are already applied to the Hetzner database (2026-11-07, after backup 20261107T205118Z).

## Not verified by the reviewer

Tests and builds (run separately by the gate), iOS (RF042 deferred), device or EAS builds of the native data mirror beyond the QA APK, production data against the strict decoders, and the multi-tab web database handoff code beyond sampling.
