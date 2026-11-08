# Project Skill Template for AI Agents

Use project skills to hold focused operating knowledge that would make a root `AGENTS.md` noisy or irrelevant to most tasks. The audience is repository maintainers designing reusable agent workflows for a framework, application, domain, or tool boundary.

## Progressive-Disclosure Model

Keep each layer responsible for one job:

1. **Root `AGENTS.md`** — states short triggers and repository-wide hard constraints.
2. **`SKILL.md`** — defines the outcome, required workflow, decisions, and checks for one class of task.
3. **References and scripts** — provide detailed domain rules, examples, or repeatable automation only when a workflow step needs them.
4. **Source code and configuration** — remain authoritative for current APIs, commands, schemas, and behavior.

Do not require every skill or reference for every change. Load the smallest focused set that covers the task.

## Good Uses

- a package or application with distinct conventions and product risks
- generated API, schema, migration, release, or deployment boundaries
- domain-specific rules such as permissions, payments, records, trading, logistics, or compliance
- repeated workflows such as adding a page, form, endpoint, background job, or state transition
- a focused authoring or review gate that applies only to particular files or changes

Avoid skills that merely duplicate the linter, list every file, preserve volatile package inventories, or force one application's harmless preferences onto another.

## Skill Shape

The exact metadata format depends on the agent platform. When the platform supports name and description metadata, put specific trigger conditions in the description.

```markdown
---
name: application-ui-authoring
description: |
  Author and review React UI for the application package.
  Use when creating, replacing, or substantially changing its screens,
  components, hooks, or interaction behavior.
---

# Application UI Authoring

This skill supplements the root instructions and shared coding standards.

## Outcome

Implement cohesive UI that follows the application's semantic contracts,
preserves behavior and accessibility, and introduces no unjustified shared API.

## Required sources

- Read the shared component guideline before authoring UI.
- Inspect the affected package's configuration and nearby code.
- Load the API-boundary reference only if the change touches remote data.

## Workflow

1. State the semantic responsibility and required behavior.
2. Search project-owned semantic components, feature/domain candidates, hooks,
   helpers, and services.
3. Inspect the strongest candidate and at least one representative usage.
4. If project code does not own the responsibility, inspect the approved vendor
   library before using a lower-level primitive.
5. Record `reuse`, `extend`, `feature-local`, or `shared` and the reason.
6. Implement the smallest cohesive change.
7. Run the verified checks for the affected package.

## Hard gates

- Use an explicitly established canonical semantic primitive when its
  responsibility matches.
- A direct vendor or platform primitive requires a stated semantic or behavioral
  gap in the canonical owner.
- Preserve generated-code, accessibility, i18n, and test conventions documented
  by the owning package.

## Contextual review

- Evaluate domain reuse by responsibility, behavior, data assumptions, ownership,
  and likely change direction; similar markup alone is insufficient.
- Treat file size as a prompt to review cohesion, not a split requirement.
- A private single-use extraction is valid when it clarifies a responsibility.
  Do not generalize it into a shared abstraction without independent consumers
  and a stable contract.
- Memoize only for a specific computation cost or identity requirement.

## Verification

- Run the package's type, lint, and focused test commands as defined in current
  package configuration or CI.
- Report failed checks and checks that could not run.
```

Replace generic names and references with facts verified in the current repository. Do not invent scripts or commands to make the template look complete.

## Authoring Evidence Template

An authoring skill can require this compact record for non-trivial new or replacement UI:

```text
Responsibility: [semantic job and required behavior]
Candidates: [project code and library options examined]
Representative usage: [usage inspected and what it established]
Decision: reuse | extend | feature-local | shared — [reason]
Canonical deviation: [semantic/behavioral gap, or not applicable]
```

Keep the evidence in the plan, work log, pull-request summary, or another place the reviewer can see. The record is a decision aid, not paperwork; scale it down for low-risk changes.

## Separate Hard Gates From Review Judgment

Skills should label the distinction explicitly.

Use hard enforcement for stable, discoverable contracts such as:

- generated or read-only boundaries
- an explicitly documented canonical semantic primitive
- required validation at an untrusted-data boundary
- security, permissions, accessibility, or i18n requirements
- commands or tests required by the owning package or CI

Use contextual review for choices that depend on local evidence:

- whether two domain components actually share a responsibility
- whether a private extraction improves comprehension
- whether a cohesive file should be split
- whether a hook is the clearest owner for screen-specific behavior
- whether memoization has a meaningful cost or identity benefit

This prevents a reviewer from treating a common domain component as mandatory while still making bypasses of a true project primitive visible and enforceable.

## Recommended Skill Types

### Framework Skill

Include shared UI, form, routing, data, i18n, testing, and generated-code boundaries only where the framework or monorepo establishes them. Route package-specific exceptions to package skills.

### Application Or Package Skill

Include the package's purpose, product risks, stable semantic owners, local conventions, boundary rules, and verified checks. Link to representative code instead of copying a route tree or component inventory.

### Workflow Skill

Define one repeatable outcome and the decisions required to reach it. Keep the main file procedural; move detailed variants, examples, and troubleshooting branches to on-demand references.

### Tool Or Boundary Skill

Identify the source of truth, generated or read-only paths, verified sync command, supported access pattern, fallback boundary, and checks. Explain when manual work is allowed rather than silently bypassing the tool.

### Review Gate Skill

Separate blocking violations from contextual signals, define severity, and end with a short self-review. Keep it limited to issues worth changing the outcome over.

## Design Rules

- Give each skill a concrete outcome and narrow trigger.
- Put the essential workflow and hard gates in `SKILL.md`; do not hide required steps in an optional reference.
- Route to detailed references at the step where they become relevant.
- Prefer "search and inspect these owners" over a static inventory.
- Link to schemas, generated configuration, and package scripts instead of duplicating volatile facts.
- Include failure modes and a safe fallback when the workflow has one.
- Use examples as evidence of a pattern, not templates to transplant blindly.
- Remove stale instructions. Missing guidance is safer than authoritative-looking misinformation.

## Short Root Trigger

The corresponding root `AGENTS.md` entry should remain brief:

```markdown
## Reuse-first authoring

- Before non-trivial implementation or refactoring, invoke the reuse-first
  authoring skill (`$reuse-first-authoring` in Codex or
  `/reuse-first-authoring` in Claude Code).
- If project skills are not discovered automatically, read
  `.agents/skills/reuse-first-authoring/SKILL.md` directly.
- Load the matching project skill before package-specific or repeated workflow work.
```

The root trigger routes the task. The focused skill owns the workflow.
