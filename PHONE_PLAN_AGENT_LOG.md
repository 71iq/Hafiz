# Phone Plan Agent Log

Purpose: persistent continuity log for the new phone redesign so future sessions can resume without relying on chat history.

## Update Protocol
- For every phone-plan decision, scope change, or phase progress, append an entry here in chronological order.
- Keep entries concrete: date, decision/change, rationale, impacted files/routes, and next step.
- Do not mark a phase complete without explicit exit criteria.

## 2026-05-01 — Phase 0 Started

### Scope baseline audited
Compared current routes/components against the phone mockup inventory:
- `app/(tabs)/home.tsx`
- `app/(tabs)/mushaf.tsx`
- `app/(tabs)/progress.tsx`
- `app/(tabs)/leaderboard.tsx`
- `app/(tabs)/settings.tsx`
- `app/onboarding.tsx`
- `app/auth/login.tsx`
- `app/auth/signup.tsx`
- `app/flashcards/session.tsx`
- `app/flashcards/vocab.tsx`
- `components/SearchCommand.tsx`
- Supporting nav/chrome: `app/(tabs)/_layout.tsx`, `components/ui/AppNavigation.tsx`

### Phase 0 decisions
1. Canonical home variant: **HomeV1 (Sanctuary Feed)**.
- Rationale: current app home is deck/review-first and maps directly to resume rail + quiet stats; lower migration risk than an Editorial Hero pivot.

2. Search architecture: **move from command modal-first to a full mobile screen** aligned with `m-search.jsx`, while keeping command-style behavior available on non-phone widths if needed.
- Rationale: current `app/(tabs)/search.tsx` is a redirect placeholder and `SearchCommand` is reused in multiple surfaces; a dedicated mobile screen is required by the target mockups.

3. Breakpoint scope: **new phone design applies below `SIDEBAR_BREAKPOINT` (`768`) only for now**.
- Rationale: existing tablet/desktop sidebar behavior in `AppNavigation` is stable and intentionally distinct. Tablet redesign is deferred until explicitly requested.

4. Delivery strategy: **preserve current information architecture and route graph in early phases**; redesign visual/chrome first, then screen internals.
- Rationale: minimizes regression risk for deep links, onboarding/auth routing, and flashcard session outside tabs.

### Feature gaps not represented in mockups (must be carried forward)
- Bookmarks sheet (`components/mushaf/BookmarksSheet` usage in mushaf route).
- Reflections flows (community sheets/modals outside this phase).
- Translation language picker (`components/settings/TranslationLanguagePicker`).
- Flashcard deck management (`components/flashcards/CreateDeckSheet` on home).
- Vocabulary mode (`app/flashcards/vocab.tsx`).
- Offline banner (`components/ui/OfflineBanner`) and sync indicator (`components/ui/SyncIndicator`).
- Auth recovery flows (`app/auth/forgot-password.tsx`, `app/auth/reset-password.tsx`).

### Screen mapping table (Phase 0 output)
| Current screen/component | Target mockup | Dependencies | Risk |
|---|---|---|---|
| `app/(tabs)/home.tsx` | `new phone design/screen-home-v1.jsx` | FSRS deck queries, auth banner, `CreateDeckSheet`, `SearchCommand`, i18n | Medium |
| `app/(tabs)/mushaf.tsx` | `new phone design/screen-mushaf.jsx`, `m-mushaf-page.jsx`, `m-mushaf-verse.jsx` | QCF2 pipeline, `v2_page`, WordDetailSheet, selection, deep links, slider/nav | High |
| `components/mushaf/WordDetailSheet.tsx` | `new phone design/screen-word-panel.jsx` | 7 tabs, word datasets, bottom-sheet behavior, RTL | High |
| `app/(tabs)/progress.tsx` | `new phone design/m-progress.jsx` | local stats queries, heatmap, auth gate | Medium |
| `app/flashcards/session.tsx` | `new phone design/m-flashcard.jsx` | FSRS flow/state machine, scoring sync, SettingsProvider isolation | High |
| `components/SearchCommand.tsx` + `app/(tabs)/search.tsx` | `new phone design/m-search.jsx` | local FTS/root search, deep-link jump, history table, route wiring | Medium |
| `app/(tabs)/settings.tsx` | `new phone design/m-settings-1.jsx`, `m-settings-2.jsx`, `m-settings-3.jsx` | settings persistence, translation import/lazy load, auth actions | Medium |
| `app/onboarding.tsx` + `app/auth/login.tsx` + `app/auth/signup.tsx` | `new phone design/m-onboard-auth.jsx` | onboarding DB writes, auth store, form validation, bilingual strings | Medium |
| `app/(tabs)/leaderboard.tsx` | `new phone design/m-leaderboard.jsx` | Supabase availability, TanStack Query, optimistic states | Medium |
| `components/ui/AppNavigation.tsx` + `app/(tabs)/_layout.tsx` | mobile chrome patterns across mockups | breakpoint behavior, safe areas, hidden routes, overlay collisions | High |

### Phase 0 status
- Decision note complete.
- Baseline mapping complete.
- No UI implementation changes made yet.
- Next step: start Phase 1 tokens/primitives audit and mapping.

## 2026-05-01 — Phase 1 In Progress

### Audit decisions
1. Token mapping status: **accepted as already present**.
- Verified in `tailwind.config.js`: `surface` ladder (`surface`, `surface-low`, `surface-mid`, `surface-high`, `surface-dim`, `surface-bright`), `primary` ladder (`primary`, `primary-soft`, `primary-accent`, `primary-bright`), `gold` ladder (`gold`, `gold-light`, `gold-dark`), `charcoal`, `warm-400`, and dark ladder (`surface-dark-*`).

2. Font audit status: **partially complete**.
- Confirmed loaded: Manrope + Noto Serif (`lib/fonts/ui-fonts.ts`, `app/_layout.tsx`).
- Confirmed Quran-only font path remains QCF2 per-page (`lib/fonts/qpc-v2-fonts.ts`).
- Gap identified: explicit Arabic UI font family for non-Quran Arabic is not yet loaded as a dedicated family; current UI relies on existing mixed font/system behavior.
- Decision: keep current behavior in this phase (to avoid introducing new font package risk during primitives setup), then add a dedicated Arabic UI font in a focused follow-up once first mobile primitives/screens are wired.

3. Primitive rollout strategy: **add shared mobile primitives in a single module first**, then adopt incrementally in later phases/screens.
- Rationale: avoids broad churn while creating a stable base for Phase 2+.

### Implemented in this step
- Added `components/ui/MobilePrimitives.tsx` with:
  - `ScreenScaffold`
  - `EditorialHeader`
  - `Eyebrow`
  - `PillButton`
  - `IconCircleButton`
  - `SegmentedControl`
  - `StatNumber`
  - `HairlineProgress`
  - `MobileGlassBar`
  - `MobileBottomSheet`
  - `MobileSectionLabel`
- Exported all above from `components/ui/index.ts`.

### Phase 1 status after this step
- Shared primitives added, data-agnostic.
- No full screen redesign performed yet.
- Next immediate step: run `npx tsc --noEmit` and `npx expo export --platform web` to validate Phase 1 exit criteria.

### Validation result
- `npx tsc --noEmit`: passed.
- `npx expo export --platform web`: passed.

### Additional fix made during validation
- `components/SearchCommand.tsx`: added missing `Platform` import to satisfy type-check.

### Phase 1 completion status
- Exit criteria satisfied for primitives/tokens foundation.
- Ready to start Phase 2 (mobile navigation and app chrome) using the new shared primitives where appropriate.
