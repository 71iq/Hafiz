# React and React Native Component Guidelines

Task-oriented guidance for agents and reviewers authoring React, React Native, and TypeScript UI. The goal is cohesive code that reuses the project's semantic contracts without turning every screen into either a monolith or a maze of tiny files.

## Authoring Preflight

Before creating or replacing UI, establish the local source of truth:

1. Read the repository and package instructions that apply to the target files.
2. Describe the responsibility in semantic terms, including required behavior. "Submits a valid form and exposes loading and disabled states" is useful; "blue button" is not.
3. Search project-owned UI, feature components, hooks, helpers, and services for plausible owners.
4. Inspect the implementation and at least one representative usage of the strongest candidate.
5. If project code does not own the responsibility, inspect the approved component library, then the lower-level platform API.
6. Choose and record one decision: `reuse`, `extend`, `feature-local`, or `shared`.

Search the repository's actual structure rather than assuming it has particular folders. `rg --files` can locate likely component, feature, hook, and helper areas; `rg` can then find exports, imports, labels, roles, and usages related to the responsibility.

For non-trivial UI work, keep a compact evidence note in the plan, work log, or review summary:

```text
Responsibility: [semantic job and required behavior]
Candidates: [project owners and library primitives examined]
Representative usage: [usage inspected and what it established]
Decision: reuse | extend | feature-local | shared — [reason]
```

If no suitable candidate exists, say where you searched. The evidence should be proportional to the change; a typo does not need an architecture record.

## Reuse Decision

| Decision | Meaning | Evidence needed |
|---|---|---|
| `reuse` | Use an existing owner unchanged. | Its contract and representative usage match the responsibility. |
| `extend` | Add a narrow capability to an existing owner. | The capability belongs to the same responsibility and preserves existing consumers. |
| `feature-local` | Keep code with one workflow, inline or privately extracted. | Semantics or change cadence are feature-specific, or shared ownership would add indirection. |
| `shared` | Create a new shared owner. | Independent consumers share a stable semantic and behavioral contract. |

Repeated markup is a search signal, not proof that a shared abstraction is correct. Conversely, single-use code may still deserve a private extraction when the name creates a useful boundary.

### Canonical Semantic Primitives

A canonical semantic primitive is explicitly established by the project as the standard owner for a recurring job, such as its standard action, form control, navigation control, overlay, or feedback pattern. It usually centralizes behavior such as accessibility, interaction states, analytics, theming, or test conventions.

- Use the canonical primitive when its semantic responsibility matches.
- Prefer extending that owner when a missing capability belongs to the same contract and can be added safely.
- Use a vendor or platform primitive directly only when the canonical owner has a concrete semantic or behavioral gap.
- Document that gap. A different visual treatment or a shorter import is not sufficient justification.

This rule is suitable for hard enforcement only when the project has clearly identified the primitive and its supported responsibility. Do not infer canonical status merely because a component is common or centrally located.

### Domain and Feature Candidates

Domain components require contextual review. Similar names or markup may hide different permissions, data invariants, analytics, or release cadence.

Before reusing or extending one, compare:

- semantic responsibility and user intent
- behavior, state, and accessibility contract
- data and permission assumptions
- ownership and likely direction of change

If those do not align, choose a feature-local implementation. Do not force domain reuse just to remove a few duplicated lines.

## Organize Around Cohesion

Place state, behavior, and rendering according to responsibility, not a universal layer diagram.

A screen or page may reasonably own:

- route parameters and navigation
- screen-specific state and orchestration
- small event handlers and derived values
- cohesive layout and conditional rendering

Extract when a part has a useful name and at least one of these is true:

- it owns a distinct behavior or lifecycle
- it can be understood and tested through a smaller contract
- it is repeated or changes independently
- the parent is difficult to scan because responsibilities are mixed
- extraction keeps a volatile detail behind a stable boundary

Do not move all logic into one large hook merely to make a screen short. A fat hook can mix fetching, mutations, navigation, form state, and presentation decisions just as easily as a large component can.

Likewise, do not split a cohesive workflow into many pass-through components and hooks. If understanding one behavior requires opening several files with no independent responsibilities, the extraction has made the code less clear.

### Line Counts Are Review Signals

Follow repository-specific limits when they exist. Otherwise, line count is diagnostic rather than a gate. A file around 200 lines is a useful prompt to review responsibility, but it may be cohesive; a 60-line component may already mix unrelated behavior.

When a file grows, ask:

- Does it have more than one reason to change?
- Is the render tree difficult to scan?
- Are effects, state transitions, or branches hard to name?
- Would a private extraction clarify an actual responsibility?
- Would extraction create more navigation than understanding?

Split based on those answers, not to satisfy a target number.

## Component Boundaries

- Follow the project's existing export, naming, file-placement, and styling conventions.
- Define typed props at the boundary; prefer the narrowest contract that expresses the component's responsibility.
- Keep state close to the smallest cohesive owner that needs to coordinate it. Lift state when multiple owners must coordinate, not pre-emptively.
- Keep simple derived values near their use. Extract domain transforms, repeated formatting, or independently testable rules into an appropriate helper.
- Preserve semantic controls, labels, focus behavior, keyboard behavior, and other accessibility requirements when wrapping library primitives.
- Do not hide required behavior behind a generic bag of configuration when explicit composition is easier to read.

Composition and configuration are both valid. Prefer composition when the child relationship matters to the reader. Prefer typed configuration when consumers repeatedly render the same schema-driven structure. Review the responsibility and contract rather than applying either pattern universally.

### Private Extraction Versus Shared Abstraction

Use names that make ownership clear:

- A **private extraction** organizes one consumer. It can live in the same file or feature and may intentionally expose only the props that consumer needs.
- A **shared abstraction** is an API for independent consumers. It needs stable semantics, compatible behavior, a clear owner, and tests appropriate to the risk.

Do not generalize a private extraction with speculative variants. Promote it only after new evidence shows that shared ownership is the clearer model.

## Hook Boundaries

Create or reuse a custom hook when it provides a cohesive React-specific boundary, for example:

- coordinated state and effects with a clear lifecycle
- reusable access to a project service or context
- a focused workflow used by more than one consumer
- a named boundary that isolates complex behavior from rendering

A single-use private hook is acceptable when it makes a real behavior boundary clearer. It is not automatically reusable, and it should not become a screen-sized dumping ground.

Follow these constraints:

- Use the project's data-access and generated-client boundaries.
- Keep query invalidation, subscriptions, and cleanup close to the event or lifecycle that requires them.
- Return a contract shaped for the consumer rather than leaking an entire lower-level object without need.
- Do not use a hook for pure logic that is clearer as a function.

## Memoization

Do not add `useMemo`, `useCallback`, or component memoization by default.

Memoize when there is a specific reason:

- a measured or plausibly expensive computation needs to be avoided
- a downstream memoized consumer benefits from stable identity
- an API or effect contract semantically requires stable identity
- profiling identifies a render path worth optimizing

Record or make the reason evident in the code. Memoization has dependency and readability costs; it is not a substitute for choosing the right state or component boundary.

## Testing

Test behavior that can regress silently:

- domain calculations, validation, permissions, mappings, and state transitions
- effects and mutation flows with branching or cleanup behavior
- shared semantic primitives whose interaction or accessibility contract changed
- bug fixes, with a regression case when practical

Avoid tests that only prove a vendor component renders or mirror implementation details. Simple presentational code may be covered through the workflow that uses it. Match the repository's test level and commands, and report anything that could not be verified.

## Review Checklist

- Is the responsibility stated in semantic and behavioral terms?
- Were project candidates and a representative usage inspected before dropping to a vendor or platform primitive?
- Is the decision explicitly `reuse`, `extend`, `feature-local`, or `shared`?
- If canonical project UI was bypassed, is there a concrete semantic or behavioral gap?
- Does each extraction clarify a responsibility rather than merely reduce line count?
- Is private single-use code kept distinct from a shared API?
- Are screens, components, and hooks cohesive rather than artificially thin or fat?
- Is each memoization choice justified?
- Are risky behaviors covered by focused tests, or is the verification gap reported?
