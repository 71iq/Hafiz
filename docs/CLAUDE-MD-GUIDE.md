# How to Write Effective CLAUDE.md Files

A task-oriented guide for repository maintainers using Claude Code. Keep `CLAUDE.md` as a concise routing layer: state the context and hard constraints Claude needs on every task, then trigger focused skills or references only when relevant.

## CLAUDE.md And AGENTS.md

If the repository supports several coding agents, use one file as the source of truth for shared guidance and keep the other as a short pointer plus tool-specific instructions. Do not maintain two overlapping handbooks.

Verify how the tools used by the project discover and scope instruction files. Do not assume nested-file or skill discovery behavior is identical across tools.

## Use Progressive Disclosure

Separate guidance by how often it is needed:

1. **`CLAUDE.md`** — brief product context, repository-wide hard constraints, triggers, and verification entry points.
2. **Focused skill** — the required workflow and decision rules for one class of task.
3. **On-demand reference** — detailed domain rules, generation steps, examples, or troubleshooting loaded by the workflow.
4. **Code and configuration** — the source of truth for current behavior, commands, schemas, and APIs.

The root file should route work, not duplicate every standard.

## Minimal Template

```markdown
# Project Name

One paragraph describing the product, its users, and the main correctness risk.

## Terms

- Define only domain terms whose ordinary meaning would mislead.

## Reuse-first authoring

- Before non-trivial implementation or refactoring, use `/reuse-first-authoring`.
- If project skills are not discovered automatically, first read
  `.claude/skills/reuse-first-authoring/SKILL.md`.
- Load additional project skills only when their task or path trigger matches.

## Hard constraints

- Do not edit generated files; use the workflow documented by their owner.
- Do not add dependencies without approval.

## Verification

- Use the commands defined by the affected package and CI configuration.
- Report failed or unavailable checks.
```

Replace the placeholders with facts verified in the repository. Do not invent a build, test, code-generation, or release command to make the file look complete.

## What Belongs In CLAUDE.md

Include:

- short product context and high-impact risks
- a compact glossary when domain language is ambiguous
- repository-wide safety and ownership constraints
- task or path triggers for focused skills
- verified build, test, lint, and type-check entry points
- explicit areas where Claude must ask before making a change

A stable project contract can be a hard rule. For example, an explicitly established canonical semantic component may own accessibility, interaction, theming, and analytics for a responsibility. Context-dependent choices, such as whether two domain components should share an abstraction, belong in the focused authoring workflow.

## What Belongs In A Skill Or Reference

Move these out of the always-loaded file:

- the component, hook, helper, and service discovery procedure
- the `reuse`, `extend`, `feature-local`, or `shared` decision rubric
- package-specific architecture and domain invariants
- generated API, migration, release, or deployment workflows
- detailed review checklists and failure branches
- examples and representative usages

The Claude Code installation lives at `.claude/skills/reuse-first-authoring/SKILL.md` and is directly invocable as `/reuse-first-authoring`. The same source is also installed under `.agents/skills/` for tools that discover the shared Agent Skills location.

## Anti-Patterns

- **Reading every document before every task.** Trigger the smallest relevant skill or reference.
- **Copying the architecture manual.** Link to the source when a matching task needs it.
- **Static component or route inventories.** Require code search and representative-usage inspection instead.
- **Vendor-specific universal rules.** Project canonical semantic owners take precedence when their responsibility matches; vendor primitives remain the fallback where no project owner exists.
- **Layer slogans.** "Thin screens, fat hooks" can move complexity without improving cohesion.
- **Fixed line-count limits.** Treat size as a review signal unless a verified project check enforces a limit for a concrete reason.
- **Duplicating formatter or linter rules.** Document the command and meaningful exceptions, not every mechanical rule.
- **Aspirational commands or policies.** Incorrect guidance is worse than a short omission.

## Maintenance

- Add a rule after a repeated or high-impact failure, not for every style preference.
- Keep the file short enough to scan in one pass; relevance matters more than a numeric limit.
- Re-check triggers, paths, and commands when repository tooling changes.
- Remove detail after a focused skill, script, or configuration becomes the source of truth.
- Keep shared `AGENTS.md` and Claude-specific guidance linked rather than duplicated.

The test: Claude should know which workflow to load and which boundaries are hard, while still inspecting current code and configuration before choosing an implementation.
