# Refactoring conventions

Read AGENTS.md, the selected task, ARCHITECTURE.md, CONVENTIONS.md, TECH_STACK.md and PROGRESS.md before editing. For implementation tasks, inspect implementation, callers and nearest tests before choosing a seam. Search components/ui and the owning feature for reusable behavior. Record whether the change reuses, extends or introduces a feature-local implementation, with the concrete reason.

An approved task may use `implementation_mode: copy-only` when the primary engineer has frozen exact artifacts and reuse choices. That worker installs only those artifacts and reports verification pending. Required instruction and readiness/reuse reads remain mandatory. Caller/source/test inspection, full source/test dumps, implementation workflows and verification belong to the primary engineer, controller and evaluator for that handoff. The controller retains every task command and the evaluator must inspect the original generator command log. Missing mode keeps normal implementation guidance; unknown modes are rejected.

## Source and types

Use @/ imports for app-owned modules. Preserve Expo platform-file resolution. Name functions for their behavior, use accurate return types at external boundaries, and derive related types from existing schemas. Parse unknown network/storage input with a meaningful validator. Do not replace any with a cast that merely hides the same unsafe assumption.

Use discriminated unions when states have different valid fields. Keep ordinary arrays unless callers actually require a nonempty invariant. Avoid classes, pass-through services, barrel files and speculative generic helpers. Extract policy separately from React state only when that gives a real test or ownership boundary.

## UI and accessibility

Use existing Text, Button, Input, ScreenContent and ResponsiveOverlay variants. Use semantic tokens and established viewport breakpoints. Do not shrink text to fix overflow. Add strings in both languages. Icon-only actions need a role, label and state where applicable. Preserve focus restoration, Escape/backdrop dismissal, keyboard avoidance, safe areas, touch targets and reduced-motion preferences.

Keep RN-compatible imports. Web DOM code belongs in an explicit platform adapter or guarded web branch. Geometry, glyph layouts and large-list measured scrolling need rendered evidence after changes. Preserve deliberate differences between otherwise similar controls.

## Data and errors

Domain query functions own SQL and service requests. Parameterize SQL values. Keep local and remote row types distinct where their semantics differ. UI errors distinguish unavailable configuration, offline state, validation failure and failed persistence. Preserve existing offline content and pending work. Catch errors only to recover, report or rethrow with context. Never silently turn a failure into successful state.

Query keys, identity, mutations and offline behavior follow ARCHITECTURE.md. Do not wrap local SQLite in network fetching merely to increase TanStack Query usage. Simple controlled inputs need no form migration. Multi-field forms reuse installed RHF/Zod without introducing a second validation system.

## Verification and review

Add characterization tests before extracting nontrivial behavior. Prefer actual function/component behavior over source-string spelling. Keep existing meaningful contracts while replacing brittle text assertions with equivalent behavioral coverage. Never skip a test, weaken an assertion or disable a rule to obtain green output.

Use each task's argv verification commands. Full-suite baseline failures remain visible until separately fixed. If a task requires zero ESLint warnings, enforce `--max-warnings=0`. Exit zero alone permits warnings. When existing warnings must remain, record and compare the exact baseline diagnostics instead of describing the run as warning-free. UI/native checks must record what ran, platform/viewport/locale/theme and observed result. A web build does not verify Android or iOS.

The controller alone changes backlog statuses, appends progress and commits. Each implementation session edits only its approved paths. Failed work remains available for diagnosis and retries; it cannot enter another task. All commits stay on the local modernization branch.
