# Refactoring conventions

Read AGENTS.md, the selected task, ARCHITECTURE.md, CONVENTIONS.md, TECH_STACK.md and PROGRESS.md before editing. For implementation tasks, inspect implementation, callers and nearest tests before choosing a seam. Search components/ui and the owning feature for reusable behavior. Record whether the change reuses, extends or introduces a feature-local implementation, with the concrete reason.

Implement directly. A task specifies a small behavior change, allowed source paths and ordinary verification commands. Do not prepare copy-only handoffs, frozen artifacts or hash-pinned verification scripts. The primary engineer retains architecture, security/data decisions and final acceptance.

## Source and types

Use @/ imports for app-owned modules. Preserve Expo platform-file resolution. Name functions for their behavior, use accurate return types at external boundaries, and derive related types from existing schemas. Parse unknown network/storage input with a meaningful validator. Do not replace any with a cast that merely hides the same unsafe assumption.

Use discriminated unions when states have different valid fields. Keep ordinary arrays unless callers actually require a nonempty invariant. Avoid classes, pass-through services, barrel files and speculative generic helpers. Extract policy separately from React state only when that gives a real test or ownership boundary.

## UI and accessibility

Use existing Text, Button, Input, ScreenContent and ResponsiveOverlay variants. Use semantic tokens and established viewport breakpoints. Do not shrink text to fix overflow. Add strings in both languages. Icon-only actions need a role, label and state where applicable. Preserve focus restoration, Escape/backdrop dismissal, keyboard avoidance, safe areas, touch targets and reduced-motion preferences.

Keep RN-compatible imports. Web DOM code belongs in an explicit platform adapter or guarded web branch. Geometry, glyph layouts and large-list measured scrolling need rendered evidence after changes. Preserve deliberate differences between otherwise similar controls.

## Data and errors

Domain query functions own SQL and service requests. Parameterize SQL values. Keep local and remote row types distinct where their semantics differ. UI errors distinguish unavailable configuration, offline state, validation failure and failed persistence. Preserve existing offline content and pending work. Catch errors only to recover, report or rethrow with context. Never silently turn a failure into successful state.

Query keys, identity, mutations and offline behavior follow ARCHITECTURE.md. Do not wrap local SQLite in network fetching merely to increase TanStack Query usage. Simple controlled inputs need no form migration. Multi-field forms reuse installed RHF/Zod without introducing a second validation system. RF034 found every auth form (login, signup, forgot and reset password) already on RHF with Zod schemas and the same email normalization. The profile editor keeps plain controlled inputs: its only rules are input length limits, and its save path carries the account and edit-scope ownership described in AUTH_PROFILE_SAVE_OWNERSHIP.md.

## Verification and review

Add characterization tests before extracting nontrivial behavior. Prefer actual function/component behavior over source-string spelling. Keep existing meaningful contracts while replacing brittle text assertions with equivalent behavioral coverage. Never skip a test, weaken an assertion or disable a rule to obtain green output.

Use each task's argv verification commands. Full-suite baseline failures remain visible until separately fixed. If a task requires zero ESLint warnings, enforce `--max-warnings=0`. Exit zero alone permits warnings. When existing warnings must remain, record and compare the exact baseline diagnostics instead of describing the run as warning-free. UI/native checks must record what ran, platform/viewport/locale/theme and observed result. A web build does not verify Android or iOS.

Judge source behavior, the full controller checks and independent review. Do not audit worker command history for acceptance. Ignore unrelated output and Codex CLI plugin, watcher, skills or sandbox diagnostic lines. An actual failed check or actionable code-review finding still requires a repair.

The controller or primary engineer owns backlog status and the short acceptance note. A worker edits only approved task paths. Keep failed source work for repair, but remove accepted-task evidence and logs. Use one local commit per accepted task; no preparation or diagnostic commits.
