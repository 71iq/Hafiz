# How to Write Effective AGENTS.md Files

A task-oriented guide for repository maintainers. Use `AGENTS.md` as a short, always-visible routing layer: establish the few invariants that apply broadly, then point agents to focused standards or skills when the task matches.

## What AGENTS.md Should Do

An effective root file answers four questions quickly:

- What is this project and which terms are easy to misunderstand?
- Which safety or ownership rules apply to nearly every change?
- What task or path triggers a focused document, skill, or workflow?
- Which verified commands or sources tell an agent whether the change is correct?

It should not contain the full implementation handbook. Long instructions consume attention on unrelated tasks and become stale as the repository changes.

## Use Progressive Disclosure

Organize guidance in layers:

1. **`AGENTS.md` trigger** — short project context, hard constraints, and conditions that route the task.
2. **Focused standard or skill** — the workflow and decision rules needed for that class of work.
3. **On-demand references** — detailed domain models, API generation steps, examples, or checklists loaded only when the workflow calls for them.
4. **Code and configuration** — the source of truth for current behavior, scripts, schemas, and local patterns.

This structure lets an agent discover detail when it becomes relevant without loading every rule before every task.

## A Minimal Structure

```markdown
# Project Name

One paragraph describing the product, users, and main risk.

## Terms

- "record" = the persisted business entity, not a log entry
- "operator" = a staff user of the internal application

## Required workflow

- Before non-trivial implementation or refactoring, invoke the reuse-first
  authoring skill (`$reuse-first-authoring` in Codex or
  `/reuse-first-authoring` in Claude Code).
- If project skills are not discovered automatically, read
  `.agents/skills/reuse-first-authoring/SKILL.md` directly.
- For package-specific or repeated workflow work, load the matching project skill
  before editing.

## Hard constraints

- Do not edit generated files; use the generator documented by the owning package.
- Do not add dependencies without approval.

## Verification

- Use the commands defined by the affected package and CI configuration.
- Report failed or unavailable checks.
```

Adapt this structure to the repository. Replace generic references with paths and commands verified from the current checkout.

## Write Effective Triggers

A trigger should say **when** to load guidance, not summarize all of it:

```markdown
- Before non-trivial implementation or refactoring, invoke the reuse-first
  authoring skill using this agent's supported syntax.
- If skill discovery is unavailable, read `.agents/skills/reuse-first-authoring/SKILL.md`.
- When changing generated API usage, load the API-boundary skill.
- When touching a package, follow its scoped instructions and verification commands.
```

Keep the detailed lookup sequence, decision rubric, examples, and failure handling inside the referenced standard or skill. If a rule affects only one repeated workflow, it is usually too specific for the root file.

## What Belongs in the Root File

Include:

- a brief product purpose and high-impact risks
- a compact glossary for domain terms whose ordinary meaning would mislead
- hard constraints that apply across the repository
- trigger conditions for framework, app, boundary, or review guidance
- verified entry points for build, test, lint, and type checks
- precedence rules when local conventions can differ safely

Keep hard constraints genuinely hard. An explicitly established canonical semantic component can be a hard UI rule because it owns stable accessibility and behavior. Reusing a domain component is usually a contextual decision and belongs in the focused authoring workflow, not a blanket root mandate.

## What Belongs Elsewhere

Move these to focused standards, skills, or references:

- component lookup and reuse-decision workflows
- domain-specific permissions and state transitions
- generated-client or migration procedures
- package-specific architecture and verification
- detailed review checklists
- long examples and troubleshooting branches

The target file should remain useful after common paths or implementations change. Link to the current source of truth instead of copying volatile inventories.

## Anti-Patterns

- **Duplicating the linter or formatter.** Agents can run the configured tool; document only exceptions or commands that are hard to discover.
- **Copying the whole architecture document.** Route to it when a task needs that context.
- **Listing every implementation path.** Keep only stable ownership boundaries and source-of-truth links.
- **Universal layer slogans.** Rules such as "thin screens, fat hooks" move complexity without proving cohesion.
- **Fixed line-count mandates.** A size threshold is a review signal unless the project has a measured, enforced reason for a hard limit.
- **Vendor-first UI rules.** Project canonical semantic components should be considered before lower-level library primitives.
- **Aspirational policy.** Instructions that contradict the code, configuration, or team practice teach agents to ignore the file.

## Maintenance

- Add guidance after a repeated or high-impact failure, not for every personal preference.
- Keep the root file short enough to scan in one pass; use relevance, not an arbitrary line count, as the test.
- Verify linked paths and commands when tooling changes.
- Remove duplicated or stale rules when a skill, check, or configuration becomes the source of truth.
- Check how each supported agent discovers and scopes nested instruction files before relying on nested `AGENTS.md` behavior.

The test: a new agent should know which focused guidance to load and which boundaries it must not cross, while still reading the current code before choosing an implementation.
