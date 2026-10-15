---
name: reuse-first-authoring
description: Discover and reuse existing project capabilities before creating React, React Native, or TypeScript components, hooks, helpers, services, or abstractions. Use before non-trivial implementation or refactoring when work may overlap project UI primitives, app wrappers, domain components, hooks, utilities, generated clients, or established workflow patterns, and use again during final review to justify every new abstraction.
---

# Reuse-First Authoring

Optimize for the smallest understandable change surface. Reuse behavior and ownership, not merely similar syntax.

## Discover before writing

1. Identify each responsibility the change needs: visual primitive, interaction, data access, state ownership, validation, formatting, navigation, or domain policy.
2. Read repository instructions and any project capability catalog.
3. Search for existing exports and nearby implementations that own each responsibility.
4. Inspect the implementation or public contract of each serious candidate.
5. Inspect at least one representative usage to learn intended variants, state handling, accessibility, and composition.

Directory listings and name matches are leads, not completed discovery.

Use this precedence when responsibilities match:

1. An established project semantic component, adapter, generated client, or domain boundary.
2. An existing feature or domain implementation with the same behavior and ownership.
3. An extension to an existing local boundary when the new behavior fits its responsibility.
4. An installed library primitive when no project boundary owns that responsibility.
5. A new feature-local implementation.
6. A new shared abstraction only after real consumers demonstrate a stable shared contract.

Do not bypass a project wrapper to use the lower-level primitive it owns. Do not copy a legacy exception merely because it is nearby.

## Record the reuse decision

Before the first write on a non-trivial change, produce a short reuse map in a reviewer-visible plan, work log, PR summary, or final handoff:

| Need | Candidate and usage inspected | Decision | Reason |
| --- | --- | --- | --- |
| Semantic responsibility | Existing export plus representative caller | `reuse`, `extend`, `feature-local`, or `shared` | Contract match or concrete gap |

For every new abstraction:

- list the relevant candidates considered;
- name the semantic, behavioral, lifecycle, accessibility, or ownership gap;
- prefer feature-local scope unless multiple real consumers share the contract;
- explain why extending the canonical boundary would make it less coherent.

A small visual difference is normally a reason to use a supported variant or extend the canonical component, not create a parallel implementation.

If the workflow has no persistent plan or work log, include the compact reuse map in the final handoff so the decision can be reviewed.

## Choose the code shape

Keep code together when it changes together and extraction would add navigation without creating a meaningful boundary.

Extract locally when a responsibility has an independent name, lifecycle, dependency boundary, test boundary, or reason to change.

Promote code to shared infrastructure only when consumers share semantics and ownership. Similar markup or hypothetical future reuse is insufficient.

Treat line count as a review signal. Do not split mechanically to satisfy a target, and do not move a large coordinator into a screen-specific mega-hook.

## Apply enforcement at the right level

Use deterministic project checks for stable, mechanically decidable boundaries such as:

- canonical component imports and prohibited raw primitives;
- generated clients and generated-file ownership;
- semantic theme tokens and styling escape hatches;
- package or layer import boundaries;
- verified public export paths.

Use contextual review for domain-level reuse where semantic equivalence cannot be proven statically. Do not force unrelated workflows through one abstraction to satisfy a reuse metric.

When the repository provides a readiness schema, preparation receipt, scaffold, or changed-file gate, use it. Treat a receipt as evidence that discovery ran only when it also records or validates the selected reuse decisions.

## Verify after implementation

1. Re-read the diff and list new files, exports, components, hooks, helpers, and direct primitive imports.
2. Confirm each selected boundary is actually imported or composed where planned.
3. Confirm every new abstraction still has the stated gap and the narrowest appropriate scope.
4. Run the repository's targeted checks, tests, and canonical-boundary rules.
5. Exercise behavior-bearing states. For visible UI, use the project's visual or device-verification workflow when available.
6. Report any intentional reuse exception and its residual maintenance cost.

Do not claim reuse merely because a candidate appeared in discovery. The implementation and verification must close the loop.
