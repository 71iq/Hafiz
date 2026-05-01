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

## 2026-05-01 — Phase 2 In Progress

### Scope decisions for this phase
1. `AppNavigation` mobile bar is the only chrome component changed in this step.
- Desktop floating sidebar behavior remains unchanged by design.

2. Search tab visibility remains deferred in Phase 2.
- Reason: `app/(tabs)/search.tsx` is still a redirect placeholder, not the target full mobile search screen.
- Decision: keep `search` hidden until Phase 7 implementation lands.

### Implemented in this step
- Updated `components/ui/AppNavigation.tsx` mobile bottom bar interaction/style:
  - Press animation scale changed from `0.9` to `0.98` to match the design spec.
  - Explicit inactive opacity (`0.5`) applied at item level.
  - Kept active pill using `primary-soft`/gold mapping constants (`#1B4D4F`, `#FDDC91`).
  - Increased top corner radius from `40` to `44` for stronger rounded chrome.
- Added a route comment in `app/(tabs)/_layout.tsx` documenting why `search` is intentionally hidden in Phase 2.

### Phase 2 status after this step
- Mobile navigation chrome aligned closer to mockup rules.
- Existing route graph preserved, desktop unaffected.
- Next immediate step: run `npx tsc --noEmit` and `npx expo export --platform web` for exit criteria verification.

### Validation result
- `npx tsc --noEmit`: passed.
- `npx expo export --platform web`: passed.

### Phase 2 completion status
- Navigation is usable on phone widths with updated chrome behavior.
- Existing routes continue to navigate correctly.
- No desktop sidebar regression introduced in this phase.

## 2026-05-01 — Phase 3 Completed

### Scope decisions for this phase
1. Implemented new Mushaf chrome only on phone widths (`< SIDEBAR_BREAKPOINT`); desktop/tablet keeps existing header/indicator.
2. Kept existing GoTo/search/bookmark/hide-mode capabilities but moved them into compact mobile chrome controls.
3. Slider progression is now forced to Mushaf RTL pagination semantics regardless of UI direction:
- page `1` on the right, page `604` on the left.

### Implemented in this step
- `app/(tabs)/mushaf.tsx`:
  - Added phone detection using `SIDEBAR_BREAKPOINT`.
  - Replaced phone header with a glass top bar composed of:
    - surah block
    - center page chip button (`Page N`) opening `GoToNavigator`
    - juz block
  - Added compact control row in mobile chrome:
    - verse/page toggle
    - go-to button
    - bookmarks
    - hide-mode (verse only)
    - search
  - Preserved desktop header + `MushafIndicator` path unchanged.
  - Ensured content bottom padding accounts for bottom slider on phone:
    - page mode container padding
    - verse mode list `contentContainerStyle` padding
- `components/mushaf/MushafSlider.tsx`:
  - Track height changed from `4px` to `2px`.
  - Enforced fixed RTL page mapping math (independent of UI RTL/LTR).
  - Added compact endpoint labels (`604` at left side, `1` at right side visually for RTL pagination).
  - Kept dragging preview bubble with surah name + page number.

### Validation result
- `npx tsc --noEmit`: passed.
- `npx expo export --platform web`: passed.

### Phase 3 completion status
- Page and verse modes now share the new mobile chrome shell.
- Go-to navigator remains connected and functional.
- Slider updates current page and preserves RTL pagination behavior.

## 2026-05-01 — Phase 4 Completed

### Scope decisions for this phase
1. Kept `PageMushaf` virtualization architecture unchanged:
- still `FlatList`-based
- still `getItemLayout`
- still `initialNumToRender={1}`
- still `maxToRenderPerBatch={1}`
- still `windowSize={3}`
- no whole-Mushaf render path introduced
2. Implemented spacing via configurable paddings instead of structural rewrites, to preserve performance and QCF2 layout behavior.

### Implemented in this step
- `components/mushaf/MushafPage.tsx`:
  - Added `sidePadding` prop (default `16`).
  - Updated content width math to use `sidePadding` (`width - sidePadding * 2`).
  - Kept QCF2 font loading and line/word mapping logic unchanged.
- `components/mushaf/PageMushaf.tsx`:
  - Added props: `pagePaddingTop`, `pagePaddingBottom`, `pageSidePadding`.
  - Wired those paddings into:
    - `MushafPage` render
    - `getItemLayout`/height calculations
    - layout offset rebuild logic
    - vertical list bottom content padding
    - horizontal page render side padding
  - Preserved all existing virtualization and interaction behavior.
- `app/(tabs)/mushaf.tsx`:
  - In page mode, passed phone-specific spacing:
    - `pagePaddingTop={14}`
    - `pagePaddingBottom={44}`
    - `pageSidePadding={22}`
  - Desktop spacing remains at previous defaults (`8/32/16`).

### Validation result
- `npx tsc --noEmit`: passed.
- `npx expo export --platform web`: passed.

### Phase 4 completion status
- Phone page view now has explicit top/bottom/side spacing tuned for the new glass chrome.
- QCF2 rendering path and page-lines/page-words integration remain intact.
- No virtualization regression introduced.

## 2026-05-01 — Phase 5 Completed

### Scope decisions for this phase
1. Refactored verse presentation only in `AyahBlock` (no FlashList architecture changes).
2. Kept reflections interaction modal-based via existing `Sheet` + `ReflectionsSection` (no inline reflections body).
3. Deferred sticky write-reflection CTA (bottom pill) until explicit product confirmation; current selection/reflection flow remains via existing reflection surfaces.

### Implemented in this step
- `components/mushaf/AyahBlock.tsx`:
  - Softer editorial card treatment:
    - moved to `bg-surface`/`bg-surface-dark` container
    - lighter control surfaces (`surface-low` ladder)
    - added extra vertical whitespace around Quran line on phone.
  - Number badge repositioned to top corner with RTL-aware placement:
    - top-right in RTL
    - top-left in LTR.
  - Header action simplification with direct actions:
    - play (disabled placeholder as before)
    - share
    - bookmark.
  - Replaced translation/tafseer pills with collapsible rows:
    - explicit row headers with chevron up/down
    - translation row still defaults from `showTranslation` setting
    - tafseer row still defaults from `showTafseer` setting
    - translation direction/alignment still follows selected translation language.
  - Preserved QCF2 right-aligned word layout and existing hide/reveal behavior.
  - Preserved bookmark toggle and share/copy behavior using Uthmani source text.

### Validation result
- `npx tsc --noEmit`: passed.
- `npx expo export --platform web`: passed.

### Phase 5 completion status
- Verse cards now follow a lighter editorial composition with collapsible translation/tafseer sections.
- No regressions introduced in translation, tafseer, bookmark, share, or hide mode flows during this phase.

## 2026-05-01 — Phase 6 Completed

### Scope decisions for this phase
1. Kept all existing tab data components unchanged (`MeaningTab`, `IrabTab`, `TajweedTab`, `TasreefTab`, `QiraatTab`, `OccurrencesTab`) and redesigned only the panel shell/layout.
2. Kept full-ayah expansion flow inside the same sheet (`view` toggle) using existing `AyahBlock`.
3. Added lightweight header metadata from local SQLite only:
- focused word text
- root
- lemma
- root occurrence count.

### Implemented in this step
- `components/mushaf/WordDetailSheet.tsx` redesign:
  - stronger dimmed backdrop and rounded top sheet treatment.
  - drag handle at the top of the panel.
  - context chip (`surah:ayah:word`) in header.
  - explicit `View Full Ayah` control + close control in header and footer.
  - large focused word display block under header.
  - root/lemma/occurrence metadata chips.
  - quick stats row (`surah`, `ayah`, `word`).
  - horizontal tab strip with RTL-aware ordering.
  - source attribution line at bottom of tabs view.
  - footer action row as quick actions.
- Preserved nested scroll behavior in tab content and ayah view.
- Preserved existing long-content handling by keeping tab internals unchanged.

### Validation result
- `npx tsc --noEmit`: passed.
- `npx expo export --platform web`: passed.

### Phase 6 completion status
- Word long-press panel structure now aligns with the target composition while preserving existing data/model behavior.
- All existing tabs remain wired and functional with local SQLite-backed data or existing placeholders.

## 2026-05-01 — Phase 7 Completed

### Scope decisions for this phase
1. Kept canonical target as **HomeV1 (Sanctuary Feed)** from Phase 0.
2. Preserved existing home route data model and actions (decks, start review, vocab, auth banner); redesigned composition around them.
3. Added real “resume reading” surface using persisted local state from `user_settings.last_mushaf_position` (no mock data).

### Implemented in this step
- `app/(tabs)/home.tsx`:
  - Editorial header refresh:
    - search icon action in header
    - date eyebrow
    - two-line display title with user-derived handle.
  - Added resume-reading card:
    - reads `last_mushaf_position` from `user_settings`
    - resolves page/surah/ayah via local SQLite (`page_map`, `quran_text`)
    - deep-links user back to Mushaf tab.
  - Reframed today section:
    - large due-count focal numeral
    - secondary memorized count
    - quieter streak/last-review row.
  - Kept existing real-data sections and actions:
    - auth CTA banner
    - start review CTA
    - deck list and deck actions
    - vocabulary deck card.
  - Ensured no one-language-only hardcoded UI labels were introduced.

### Validation result
- `npx tsc --noEmit`: passed.
- `npx expo export --platform web`: passed.

### Phase 7 completion status
- Home composition now aligns closer to HomeV1 editorial mobile direction while staying fully real-data-driven.
- Authenticated/unauthenticated and empty/non-empty deck paths remain functional.

## 2026-05-01 — Phase 8 Completed

### Scope decisions for this phase
1. Reused existing progress calculations and DB queries; no scoring algorithm changes.
2. Reinterpreted existing fields to match target stat intent:
- mastery % computed from memorized cards over total cards
- total sessions computed as distinct review dates from `study_log`.
3. Kept daily reminder card because bilingual copy already exists in `strings.ts`.

### Implemented in this step
- `app/(tabs)/progress.tsx`:
  - Editorial header update with eyebrow + display title.
  - Stats grid redesigned to focus on:
    - mastery percentage
    - memorized ayah/card count
    - longest streak
    - total sessions.
  - Kept all data local and existing query-based.
  - Added total review summary line below heatmap.
- `components/progress/ActivityHeatmap.tsx`:
  - Made grid horizontally scrollable on phone (`ScrollView horizontal`).
  - Added today-cell outline.
  - Added tonal intensity legend row.
  - Kept low-border visual language.
- `components/progress/SurahProgressList.tsx`:
  - Updated surah badge visual treatment.
  - Switched progress bar to thin hairline (2px) style.
  - Preserved Arabic + English naming and deep-link behavior.

### Validation result
- `npx tsc --noEmit`: passed.
- `npx expo export --platform web`: passed.

### Phase 8 completion status
- Progress screen now aligns closer to mobile target composition.
- Existing scoring/progress calculation behavior remains unchanged.
