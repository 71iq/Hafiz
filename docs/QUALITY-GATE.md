# Quality Gate for AI-Written Code

Use this as a final review pass for non-trivial AI-written changes. For typo fixes and small one-line changes, use judgment.

The goal is code that a human reviewer and a future AI agent can understand quickly:

- strict types at API, form, route, storage, and generated-code boundaries
- cohesive screens, components, hooks, and helpers with responsibilities that are easy to name
- reuse decisions backed by a responsibility, candidate search, and representative usage
- local ownership: feature code stays near the workflow it serves
- focused tests for behavior, mappings, permissions, transforms, and edge states
- no broad rewrites, premature shared abstractions, or mechanical file splitting

Small local duplication and private single-use extraction are acceptable when they keep a workflow clear. Shared abstractions need a stable contract, not just similar markup or a line-count reduction.

---

## Local Consistency Rule

Follow the dominant local project pattern unless it violates a hard gate.

Use this precedence when coding or reviewing:

1. Hard gates in this document: type safety, runtime safety, generated-code boundaries, explicitly established canonical primitives, i18n, testability, and backend-state handling.
2. App/package-specific conventions and nearby code that already handles the same workflow well.
3. Shared project standards.
4. Examples from other apps or projects as quality references, not mandatory style transplants.

Treat these as preferences unless they create a hard-gate issue:

- translation access style when the surrounding file already uses a different local pattern
- folder layout and component naming that is consistent in the app
- small local duplication that keeps a workflow easier to read
- reuse of domain components whose responsibilities only partially overlap
- extraction and file placement when the touched code remains cohesive
- equivalent helper shapes that are typed, tested, and locally understandable

A local pattern becomes a review issue when it creates unsafe types, bypasses a stable canonical contract, repeats complex workflow logic, weakens backend-state handling, misses behavioral tests, or forces readers to open many unrelated files to understand one change.

---

## Non-Negotiable Gates

### Type Safety

- Do not add `any`, `unknown as`, non-null assertions, or `as SomeType` casts. The default exception is `as const`.
- If a type escape is unavoidable, isolate it at the boundary and explain why the safer option does not work.
- Use generated API types, local unions/enums, `Record<...>`, and `satisfies` so invalid domain values fail where maps are declared.
- Validate external or unknown data with Zod, the platform parser, or an existing runtime validator before using it.
- Backend-controlled strings and enum-like values should use generated types, local unions/enums, or typed maps instead of repeated raw strings.

### API And Data Boundaries

- Do not edit generated files. Regenerate them through the project command.
- Do not hand-write API clients when generated endpoints, SDKs, or app wrappers exist.
- Manual API code belongs behind a clear boundary and should explain why generation or the standard client cannot be used yet.
- Query invalidation and refetch logic should stay close to the mutation or event that requires it.
- Mutation and API errors should use the app-level error/snackbar/logger pattern, not a raw lower-level dependency.
- Render optional, empty, or impossible-looking backend states safely with an empty state, explicit `null`, or a typed helper that documents the invariant.

### Reuse Evidence And Canonical UI

- For non-trivial UI authoring, identify the semantic responsibility, plausible project candidates, a representative usage inspected, and the decision: `reuse`, `extend`, `feature-local`, or `shared`.
- Search project-owned semantic components and feature/domain candidates before falling back to the approved vendor library or a lower-level platform primitive.
- When the project explicitly establishes a canonical semantic primitive for the responsibility, use it. A deviation must identify a concrete semantic or behavioral gap.
- Treat canonical status as a hard gate only when the project clearly documents the owner and its supported responsibility. A commonly used domain component is not canonical by default.
- Preserve accessibility, interaction states, analytics, theming, and test conventions owned by a canonical primitive.

### UI And I18n

- New user-facing strings go through the app's i18n system when the project has one.
- Do not render empty strings just to satisfy required props. Make the prop optional or create the right component.
- New interactive UI should use stable test IDs when the project has a test ID convention.
- Prefer accessible labels and semantic controls over fragile selector-only behavior.

### Tests

- New domain helpers, maps, permissions, form transforms, query/event refetch decisions, and mutation behavior need focused tests.
- Bug fixes should get a regression test that fails before the fix when practical.
- Avoid placeholder tests that only assert a component renders.
- Prefer small table-driven tests for mappings, state transitions, and validation cases.
- When a test is not practical in the current change, call out the residual risk and keep the behavior isolated enough to test later.

---

## Contextual Review Signals

These signals require judgment. They are prompts to inspect responsibilities, not automatic reasons to request changes.

### Cohesion And Extraction

- A screen or route may own screen-specific state, orchestration, handlers, derived values, and cohesive layout. It does not need to be a pass-through composer.
- Extract a private component, function, or hook when naming a responsibility improves comprehension, testing, or change isolation.
- Do not move unrelated concerns into one large hook merely to shorten a screen.
- Do not split a cohesive workflow across pass-through files that readers must traverse together.
- Treat a file around 200 lines as a review signal when the repository has no stronger local convention. Shorter code can still mix responsibilities; longer code can still be cohesive.
- Extract multi-part conditions or long branches when a name makes the behavior easier to follow.
- Do not introduce global client state unless it is already the project's established pattern or the new ownership need is justified.

### Ownership And Abstraction

- Evaluate domain reuse by semantic responsibility, behavior, data and permission assumptions, ownership, and likely change direction.
- Similar markup is not enough to force two domain workflows through one component.
- A feature-local private extraction may have one consumer. Keep it narrow rather than adding speculative variants.
- Create a shared abstraction only when independent consumers need the same stable contract and shared ownership removes real repeated complexity.
- Use `useMemo`, `useCallback`, and component memoization only for a specific cost or identity requirement. Do not add them as a blanket convention.

---

## Review Severity

Request changes for:

- new unsafe type escapes
- generated-code edits or manual API code without a boundary reason
- bypassing an explicitly established canonical semantic primitive without a concrete semantic or behavioral gap
- hardcoded user-facing text in an i18n project
- unsafe rendering of optional or empty backend data
- new or touched code that mixes page, form, mutation, event handling, and rendering responsibilities without a clear cohesive owner
- missing focused tests for new behavior that can regress silently
- non-trivial new or replacement UI with no reviewer-visible responsibility, candidate, representative-usage, or ownership-decision evidence

Leave as a note or follow-up for:

- older untouched code that violates the standard but is outside the task
- small local duplication that keeps the current workflow easier to read
- a cohesive screen, hook, or component whose line count merely crosses a guideline
- a feature-local single-use extraction with a clear responsibility
- cosmetic naming improvements that do not affect comprehension or safety
- test gaps that cannot be closed in the current environment but are clearly reported

Do not flag:

- code that follows the dominant local style and does not violate a hard gate
- domain components kept separate after their semantics or behavior were shown to differ
- preference-only rewrites from one app style to another app style
- broad cleanup outside the touched workflow

---

## Before Coding Or Reviewing

Search first instead of inventing:

- explicitly established project semantic primitives and app wrappers
- existing feature/domain components, hooks, helpers, and utilities
- representative usages that demonstrate candidate behavior
- the approved vendor UI library when project code does not own the responsibility
- existing test ID conventions
- feature toggle or rollout conventions
- generated API clients, SDKs, types, and enums
- nearby examples for the same workflow shape

---

## Final Self-Review

Before handing back code, check:

- Did I avoid new unsafe type escapes?
- Did I record the responsibility, candidates, representative usage, and `reuse` / `extend` / `feature-local` / `shared` decision for non-trivial UI authoring?
- Did I use established canonical primitives, existing code, generated clients, and vendor components at the appropriate level?
- If I bypassed a canonical primitive, did I identify the semantic or behavioral gap?
- Are new strings translated and new controls covered by stable test IDs when the project expects them?
- Is the touched code locally readable without opening many unrelated files?
- Did I distinguish a private single-use extraction from a shared abstraction?
- Did I review large files for mixed responsibilities without splitting them mechanically?
- Is every memoization choice tied to a specific cost or identity requirement?
- Are optional backend states safe?
- Are behavior-bearing helpers, maps, permissions, transforms, effects, and mutations tested?
- Did the relevant checks run, or is there a concrete environment blocker?

Mention only failed checks, skipped checks, or verification blockers in the final response.
