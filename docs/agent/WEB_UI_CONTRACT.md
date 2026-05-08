# Hafiz Web UI Contract

## Purpose
This document is the authoritative execution contract for the Hafiz web UI stabilization pass. It defines the shared responsive rules, overlay rules, reader invariants, and verification gates that all later changes must satisfy.

## Scope
- Applies to all web-facing UI routes and overlays in Hafiz.
- When another agent or product doc overlaps with UI implementation or verification rules, this document wins.
- Uses Quran.com only as a conceptual reference for reader hierarchy and QA discipline.
- Does not authorize architecture changes away from Expo, local SQLite reads, or the current route graph unless explicitly stated below.

## Breakpoint Contract

### Canonical widths
- `360px`: compact phone baseline
- `412px`: large phone baseline
- `768px`: sidebar and tablet transition
- `1024px`: secondary verification checkpoint for sidebar behavior
- `1440px`: desktop baseline

### Implementation rule
- One shared source of truth must own viewport breakpoints for the app.
- The intended end state is a shared viewport module or constant set such as `lib/ui/viewport.ts`, consumed by `AppNavigation`, settings-responsive font scaling, search, word detail, and overlay shells.
- Raw `768` checks in feature files should be replaced with the shared contract without changing behavior first.

## Content Width Contract

### General screens
- Non-reader surfaces should use shared width constraints instead of ad hoc per-route caps.
- At `360` and `412`, screens remain single-column with phone gutters.
- At `768+`, content should be centered and intentionally constrained rather than stretched edge to edge.

### Reader surfaces
- Mushaf verse and page surfaces may use reader-specific width logic when needed for Quran layout fidelity.
- Reader-specific exceptions must be documented and cannot weaken QCF2 correctness.

### Dialog and sheet widths
- Phone overlays should prefer full-width bottom-sheet presentation with safe-area padding.
- Wider screens may promote large-content overlays to centered dialogs or panels, but only through a shared adaptive pattern.

## Navigation Contract

### Below `768`
- Use the mobile bottom bar from `AppNavigation`.
- Keep navigation chrome compact and secondary to route content.
- Hidden routes remain hidden unless product behavior changes explicitly.

### At and above `768`
- Use the floating sidebar behavior from `AppNavigation`.
- Validate at both `768` and `1024` because the sidebar transition is the most likely regression point.

### Overlay coexistence
- `OfflineBanner`, `SyncOverlay`, search, Mushaf chrome, and route-local overlays must not visually collide.
- Chrome visibility changes driven by `useHideChromeOnScroll()` must remain predictable when overlays are open.

## Overlay Contract

### Standard overlay families
- Use one shared adaptive content-sheet pattern for non-destructive content overlays.
- Use one shared confirmation-dialog pattern for destructive actions.
- Use route-local specialization only for reader-specific behavior that cannot fit the shared shell.

### Required shared behaviors
- consistent backdrop opacity
- explicit close affordance
- tap-outside dismissal policy documented per overlay type
- safe-area aware bottom padding
- scroll ownership inside the overlay, not accidental body scrolling
- width and max-height rules derived from the shared viewport contract

### Nested overlay rule
- Nested overlays are allowed only when the parent context must stay active and the child is clearly subordinate.
- Current examples like word detail to ayah detail should be treated as exceptions to minimize, not a general pattern to expand.

## Search Contract

### Current state
- `/search` is a hidden redirect route today.
- Real search behavior is modal-based through `SearchCommand`.

### Stabilization rule
- Search must have one canonical behavior model for:
  - focus
  - recent history
  - minimum-character guards
  - empty states
  - result selection and navigation
  - root-group expansion state

### Allowed futures
- Option A: keep search modal-first, and make every launcher use one shared content module
- Option B: promote `/search` to a real responsive page, and let modal launchers wrap the same content module where useful

Any future `/search` page must share the same query, history, empty-state, and result-rendering content module as `SearchCommand`; route promotion must not fork search behavior.

No implementation phase should fork search logic into separate page and modal behaviors.

## Provider Boundary Contract

### Root-stack route rule
- Any root-stack route that reads `useSettings()` or `useStrings()` must either:
  - wrap itself in `SettingsProvider`, or
  - explicitly document why default English/light/LTR settings are acceptable for that route

### Current hotspots to resolve or document
- auth routes
- public profile
- QA readiness
- vocab review
- not-found, if it remains a hardcoded fallback instead of using strings

## RTL, I18n, And Dark Mode Contract

### Strings
- All user-facing copy must come from bilingual string ownership.
- Validation errors, helper copy, and QA-route copy are included in scope.
- English and Arabic mode switching must not leave stale single-language labels behind.

### Directionality
- Layouts must use logical mirroring for:
  - row direction
  - action ordering
  - close and back affordances
  - text alignment
  - icon direction where meaning depends on direction

### Color and surfaces
- Light and dark mode must both use the established surface and accent token ladders.
- Hard borders and divider lines should be used only when they serve structure better than tonal separation.

## QCF2 Reader Invariants

These rules are non-negotiable across all UI phases:
- Quran display uses QCF2 per-page fonts, not system Arabic fonts.
- Page grouping uses `v2_page`, not `page_map`.
- Web QCF2 loading uses the `FontFace` path in `lib/fonts/loader.ts`.
- Quran word layout preserves the existing `direction: "ltr"` plus `flexDirection: "row-reverse"` behavior.
- Copy and share flows use `text_uthmani`, not QCF2 PUA glyph text.
- Quran reads remain local SQLite reads; reading features do not block on network.

## Verification Gates

### Documentation-only gate
- Path references should be verified with `rg` after doc edits.
- `git diff -- AGENTS.md tsconfig.json docs/agent docs/product` should stay scoped to docs plus the TypeScript config boundary for this cleanup.
- `npx tsc --noEmit` should pass even when the optional `quran.com-frontend-next/` checkout exists locally, because it is excluded from Hafiz TypeScript scope by design.

### Required commands for implementation phases
- `npx tsc --noEmit`
- `npx expo export --platform web`
- `npx expo start --web`

### Required manual coverage
- `360px`, English, light and dark where applicable
- `412px`, English and Arabic
- `768px`, English and Arabic
- `1440px`, English and Arabic
- `1024px` whenever sidebar or large-overlay behavior differs from `768`

### Must-check flows
- Home
- Mushaf verse mode
- Mushaf page mode
- Search
- Settings
- Flashcards session
- Onboarding and auth
- Leaderboard and profile
- representative modal and sheet flows

## Phased Roadmap

### Phase 1. Documentation baseline
- Create:
  - `docs/agent/CODEBASE_MAP.md`
  - `docs/agent/QURAN_FRONTEND_REFERENCE_NOTES.md`
  - `docs/agent/UI_AUDIT.md`
  - `docs/agent/WEB_UI_CONTRACT.md`
- Append the continuity decision to `docs/agent/PHONE_PLAN_AGENT_LOG.md`
- No app source changes

### Phase 2. Verification hygiene
- Make local checks reliable before UI edits
- Prevent the read-only `quran.com-frontend-next/` checkout from entering Hafiz TypeScript verification

### Phase 3. Responsive contract consolidation
- Centralize viewport constants around `360`, `412`, `768`, and desktop
- Replace existing raw `768` checks with shared contract reads without changing behavior

### Phase 4. Modal and sheet standardization
- Converge the current spread of modals, sheets, and large dialogs onto one documented adaptive pattern

### Phase 5. Search and navigation stabilization
- Decide whether `/search` remains a redirect or becomes a real responsive page
- Preserve useful command-style behavior while unifying history, focus, empty, and result navigation behavior

### Phase 6. Route-by-route UI pass
- Stabilize:
  - Home
  - Mushaf
  - Progress
  - Leaderboard
  - Settings
  - Flashcards session
  - Auth
  - Onboarding
  - Profile

### Phase 7. RTL, i18n, and dark-mode pass
- Remove remaining hardcoded strings
- verify English and Arabic parity
- verify directional icons and spacing
- remove design-system drift such as unnecessary hard divider lines

### Phase 8. QA automation
- Add the lightest useful automated coverage for:
  - responsive smoke checks
  - modal behavior
  - search behavior
  - i18n parity
  - representative screenshots

## Exit Rule
No UI change is considered complete unless it satisfies this contract and passes the required verification gates for its phase.
