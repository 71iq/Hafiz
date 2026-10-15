# Coding Principles for AI Agents

Four principles that apply to every coding task. For trivial changes such as typo fixes, use judgment; the ceremony should match the risk.

These principles are designed to be referenced from `CLAUDE.md` or `AGENTS.md`. Keep the short trigger there and the detailed workflow here.

---

## 1. Think Before Coding

Do not assume or hide uncertainty. Surface tradeoffs that affect the result.

- State material assumptions explicitly.
- If multiple interpretations would produce meaningfully different behavior, present them or ask.
- If a simpler approach meets the requirement, say so.
- When something blocks safe progress, name the missing information instead of guessing.

## 2. Prefer Simple, Cohesive Code

Write the minimum code that solves the requested problem, then keep each responsibility where it is easiest to understand.

- Do not add speculative features, configurability, or error handling for states the system cannot produce.
- Keep closely related state, behavior, and rendering together when separating them would make the workflow harder to follow.
- Extract a private component, function, or hook when naming a responsibility improves readability, testing, or change isolation. Single use does not make that extraction wasteful.
- Do not present a private single-use extraction as a reusable abstraction. Shared code needs a stable contract and evidence that independent consumers share the same responsibility.
- Treat line count as a prompt to review cohesion, not as a reason to split code mechanically.

The test: can a reviewer explain each unit's responsibility and follow the change without jumping through unrelated files?

## 3. Make Surgical Changes

Touch only what the task requires and clean up only the consequences of your change.

When editing existing code:

- Do not reformat or refactor adjacent code without a task-related reason.
- Follow safe local conventions, even when another style is also valid.
- Mention unrelated problems instead of quietly expanding the change.
- Remove imports, variables, files, or branches that your change made obsolete.

The test: every changed line should trace to the requested outcome or to keeping that outcome correct and maintainable.

## 4. Work Toward Verifiable Outcomes

Translate the request into observable success criteria and keep iterating until they are verified.

- "Add validation" becomes "cover the invalid inputs, then make those cases pass."
- "Fix the bug" becomes "reproduce the failure, fix it, and add a regression check when practical."
- "Refactor this" becomes "preserve externally visible behavior before and after the structural change."

For multi-step work, use a brief plan in which each step has a check. Report checks that failed, were skipped, or could not run.

---

## Reuse-First Authoring

Before creating or replacing a component, hook, helper, or service, gather enough evidence to make a deliberate ownership decision:

1. **Responsibility** — describe the semantic job and required behavior in one sentence. Do not describe only its appearance.
2. **Candidates** — search project-owned semantic components, feature/domain code, hooks, helpers, and services that may already own that responsibility.
3. **Representative usage** — inspect at least one real usage of the strongest candidate. Its name or screenshot alone does not prove compatibility.
4. **Library fallback** — if project code does not cover the responsibility, check the project's approved vendor library before using a lower-level platform primitive or creating infrastructure.
5. **Decision** — explicitly choose `reuse`, `extend`, `feature-local`, or `shared`.

Use the four decisions consistently:

| Decision | Use when |
|---|---|
| `reuse` | An existing owner already matches the semantics and behavior. |
| `extend` | The existing owner's responsibility is correct and a narrow, compatible capability belongs there. |
| `feature-local` | The code serves one workflow or has feature-specific semantics. It may remain inline or be privately extracted. |
| `shared` | Independent consumers need the same stable contract and a shared owner reduces real repeated complexity. |

An explicitly documented canonical semantic primitive is a stable project contract. Use it when the responsibility matches. A deviation must identify the semantic or behavioral gap; visual preference or convenience is not enough.

Domain components are contextual candidates, not automatic mandates. Reuse or extend them only when responsibilities, behavior, ownership, and likely change direction align. Similar markup alone is not evidence for a shared abstraction.
