# Quran.com Frontend Reference Notes

## Scope
This note treats Quran.com as a read-only UX and engineering reference. `quran.com-frontend-next/` is an optional local, untracked checkout that may or may not exist in a given Hafiz worktree, and it is not a committed Hafiz dependency.

When that reference checkout is available locally, useful read-only entry points include:
- `quran.com-frontend-next/README.md`
- `quran.com-frontend-next/package.json`
- `quran.com-frontend-next/playwright.config.ts`
- `quran.com-frontend-next/src/components/dls/`
- `quran.com-frontend-next/tests/integration/`

The goal is to borrow patterns, not architecture or code.

## Patterns Worth Reusing Conceptually

### 1. Reader-first hierarchy
- Quran.com keeps the reading surface visually dominant and makes control chrome secondary.
- Hafiz should keep that principle for Mushaf, word detail, search, and tafseer surfaces:
  - large type hierarchy for titles
  - muted metadata
  - low-noise dividers
  - controls that do not compete with Quran text

### 2. Shared design-language components
- Quran.com explicitly centralizes reusable primitives under `src/components/dls/`.
- When the local checkout is present, the inventory shows a deliberate separation between generic UI pieces and feature modules:
  - `Button`
  - `Card`
  - `ContentModal`
  - `ConfirmationModal`
  - `Popover`
  - `QuranWord`
  - `Tabs`
  - `Tooltip`
  - `Separator`
- Hafiz should mirror the principle by collapsing its one-off modal and breakpoint logic into a small shared UI contract instead of repeating per-screen shells.

### 3. Clear interaction taxonomy
- Quran.com differentiates between hover cards, popovers, modals, confirmation dialogs, and content drawers instead of treating every overlay as a custom one-off.
- Hafiz needs the same clarity across:
  - search
  - word detail
  - ayah detail
  - bookmarks
  - go-to navigation
  - reflections
  - deck creation

### 4. Component isolation for QA
- Quran.com documents Storybook usage in the README and keeps many reusable components story-friendly.
- Hafiz does not need Storybook first, but it should adopt the same intent:
  - shared primitives should be renderable in isolation
  - modal states should be easy to smoke test without navigating the whole app
  - responsive and RTL states should be verifiable outside manual guesswork

### 5. Desktop and mobile verification as first-class targets
- When present, the local Playwright config defines both desktop and mobile browser projects.
- Hafiz should copy the testing idea, not the exact toolchain:
  - verify at phone widths and desktop widths intentionally
  - cover route navigation and overlay behavior
  - treat responsive regressions as normal automated checks

### 6. Feature-oriented integration coverage
- Quran.com's integration tests are grouped by user journey and feature area, not by implementation detail.
- Hafiz should aim for the same shape in a lighter form:
  - search behavior
  - reader settings
  - leaderboard/profile flows
  - onboarding/auth
  - deep links

## Hafiz-Specific Translation Of Those Patterns

### Reader hierarchy
- Keep phone and desktop chrome quieter than the Quran text.
- Preserve existing editorial headers only where they support orientation, not where they crowd the reader.

### Overlay system
- Standardize a small family of adaptive overlays:
  - bottom sheet on phone
  - centered dialog or large content panel on wider widths
  - explicit confirmation dialog for destructive actions

### Responsive contract
- Replace raw breakpoint checks with one shared viewport contract for `360`, `412`, `768`, `1024`, and `1440`.
- Search, word detail, navigation chrome, and form surfaces should all consume the same contract.

### QA strategy
- Use the existing `app/qa-ready.tsx` route as a deterministic boot gate for automation.
- Add the lightest useful responsive smoke coverage instead of bringing in Quran.com's entire test stack.

## What Hafiz Will Not Adopt

### Not adopting Quran.com's stack
- No Next.js architecture adoption.
- No Redux, SWR, Radix, or Storybook migration by default.
- No attempt to mirror Quran.com's repo layout wholesale.

### Not adopting remote-first reader behavior
- Hafiz remains offline-first for all Quran reading paths.
- All Quran reads remain local SQLite reads.

### Not copying product scope
- No widget/embed system migration.
- No study-mode SSR assumptions.
- No attempt to recreate Quran.com's full homepage, account system, or content ecosystem.

### Not importing reference code into Hafiz runtime or type-check scope
- Any future validation against Quran.com must stay read-only.
- The optional `quran.com-frontend-next/` checkout must not add dependencies, source files, aliases, or test files to Hafiz runtime, Metro, or TypeScript scope.
- It should stay uncommitted and out of Hafiz's TypeScript checks once verification hygiene is fixed.

## Practical Takeaway
Quran.com is useful here as a standard for discipline:
- shared primitives over one-off UI
- reader-first hierarchy
- overlay taxonomy
- responsive verification on mobile and desktop
- component isolation for QA

Hafiz should keep its own architecture, datasets, route graph, offline constraints, and QCF2 rendering pipeline.
