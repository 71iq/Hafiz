# Hafiz Codebase Map

## Purpose
This document maps the current web-facing UI surfaces in Hafiz before the stabilization pass. It is a descriptive baseline for responsive, RTL, i18n, modal, and verification work; `docs/agent/WEB_UI_CONTRACT.md` remains authoritative when rules overlap.

## Route Graph

### Root stack
| Surface | File | Notes |
| --- | --- | --- |
| Root providers | `app/_layout.tsx` | Owns `QueryClientProvider`, `DatabaseProvider`, UI font bootstrapping, auth initialization, and the root `Stack`. The explicit stack registration lists `(tabs)`, `onboarding`, `open`, `flashcards/session`, `auth/*`, and `profile/[userId]`. |
| Tabs shell | `app/(tabs)/_layout.tsx` | Wraps the tab experience in `SettingsProvider`, `ChromeProvider`, `ErrorBoundary`, `OfflineBanner`, `SyncOverlay`, and `AppNavigation`. |
| Onboarding | `app/onboarding.tsx` | Three-step onboarding flow backed by local SQLite and deck creation. Wraps its inner screen in its own `SettingsProvider` because it sits outside tabs. |
| Deep-link bridge | `app/open.tsx` | Parses `hafiz://open` and redirects to Mushaf after calling `setPendingDeepLink()`. |
| Flashcards session | `app/flashcards/session.tsx` | Outside tabs; owns its own `SettingsProvider`. |
| Vocab review | `app/flashcards/vocab.tsx` | Outside tabs. Uses `useSettings()` and `useStrings()` today without wrapping its own `SettingsProvider`, so it falls back to default context values. |
| Auth routes | `app/auth/login.tsx`, `app/auth/signup.tsx`, `app/auth/forgot-password.tsx`, `app/auth/reset-password.tsx` | Modal-style full screens pushed from the root stack. |
| Public profile | `app/profile/[userId].tsx` | Leaderboard profile drill-down backed by TanStack Query. |
| QA probe | `app/qa-ready.tsx` | Deterministic readiness route for browser automation and screenshot flows. |
| Not-found | `app/+not-found.tsx` | Root catch-all surface. Uses hardcoded English strings today and sits outside tab-level settings. |
| HTML shell | `app/+html.tsx` | Web-only root document. Owns root metadata plus body/root scroll behavior used to collapse the mobile browser URL bar. |

### Tabs group
| Surface | File | Notes |
| --- | --- | --- |
| Index redirect | `app/(tabs)/index.tsx` | Checks `user_settings.onboarding_completed` and redirects to onboarding or Mushaf. |
| Home | `app/(tabs)/home.tsx` | Deck dashboard, review CTA, resume reading, auth banner, create-deck sheet, and search modal launcher. |
| Mushaf | `app/(tabs)/mushaf.tsx` | Main reader route for verse and page modes; owns the highest number of overlays and responsive chrome decisions. |
| Leaderboard | `app/(tabs)/leaderboard.tsx` | TanStack Query + Supabase-backed leaderboard tabs. |
| Progress | `app/(tabs)/progress.tsx` | Local statistics and heatmap, optionally auth-gated when Supabase is configured. |
| Settings | `app/(tabs)/settings.tsx` | User settings, translation import, review-mode toggles, auth actions. |
| Hidden flashcards tab | `app/(tabs)/flashcards.tsx` | Redirect placeholder to home. Not visible in navigation. |
| Hidden search tab | `app/(tabs)/search.tsx` | Redirect placeholder to home. Not visible in navigation. |

## Provider Boundaries

### Settings and i18n scope
- `app/(tabs)/_layout.tsx` is the only shared tab-level owner of `SettingsProvider`.
- `app/onboarding.tsx` wraps itself in `SettingsProvider`.
- `app/flashcards/session.tsx` wraps itself in `SettingsProvider`.

### Root-level routes outside tab settings today
- `app/auth/login.tsx`
- `app/auth/signup.tsx`
- `app/auth/forgot-password.tsx`
- `app/auth/reset-password.tsx`
- `app/profile/[userId].tsx`
- `app/qa-ready.tsx`
- `app/flashcards/vocab.tsx`
- `app/open.tsx`
- `app/+not-found.tsx`

### Current implication
- Auth, profile, QA, and vocab review already call `useStrings()` and/or `useSettings()` outside `SettingsProvider`, so they silently use the default English/light/LTR settings context.
- `app/open.tsx` currently does not consume strings or settings, so the missing provider is only a boundary note there.
- `app/+not-found.tsx` does not consume `useStrings()`, but it hardcodes English copy and therefore still bypasses the bilingual contract.

## Navigation And Chrome

### Ownership
- `app/(tabs)/_layout.tsx` owns visible tab registration and injects `AppNavigation`.
- `components/ui/AppNavigation.tsx` switches between:
  - mobile bottom bar below `SIDEBAR_BREAKPOINT`
  - floating sidebar panel at and above `SIDEBAR_BREAKPOINT`
- `lib/ui/chrome.tsx` provides hide-on-scroll visibility state for tab chrome.
- `components/ui/OfflineBanner.tsx` and `components/ui/SyncIndicator.tsx` render above route content and must not collide with search, sheets, or page chrome.

### Current visible navigation contract
- Visible tabs: Home, Mushaf, Leaderboard, Progress, Settings.
- Hidden routes inside tabs: `index`, `flashcards`, `search`.
- The search route is not a navigable page today; search is invoked from route-local modal launchers in Home and Mushaf.

## Core UI Primitives

### Used in app routes and shared runtime surfaces
- `components/ui/Button.tsx`
- `components/ui/Card.tsx`
- `components/ui/Progress.tsx`
- `components/ui/ToggleGroup.tsx`
- `components/ui/Switch.tsx`
- `components/ui/EmptyState.tsx`
- `components/ui/Skeleton.tsx`
- `components/ui/Toast.tsx`
- `components/ui/AuthGate.tsx`
- `components/ui/ConfirmDialog.tsx`
- `components/ui/Sheet.tsx`
- `components/ui/ErrorBoundary.tsx`
- `components/ui/AppNavigation.tsx`
- `components/ui/OfflineBanner.tsx`
- `components/ui/SyncIndicator.tsx`

### Exported or available, but not adopted by live routes today
- `components/ui/Badge.tsx`
- `components/ui/Text.tsx` (`Typography`)
- `components/ui/Separator.tsx`
- `components/ui/Tabs.tsx` (`TabBar`)
- `components/ui/CustomTabBar.tsx`
- `components/ui/MobilePrimitives.tsx`
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

These exports currently exist as a parallel primitive layer or dormant surface area and are not active route dependencies today.

## Mushaf Surface Map

### Top-level reader ownership
- `app/(tabs)/mushaf.tsx`
  - wraps the screen in `WordInteractionProvider`
  - wraps selection behavior in `SelectionProvider`
  - switches between verse mode and page mode
  - owns phone-only chrome decisions, bookmarks, search, word detail, selection actions, and deep-link consumption

### Verse mode path
- `components/mushaf/SurahHeader.tsx`
- `components/mushaf/AyahBlock.tsx`
- `components/mushaf/WordToken.tsx`
- `components/mushaf/WordTooltip.tsx`
- `components/reflections/ReflectionsSection.tsx`

### Page mode path
- `components/mushaf/PageMushaf.tsx`
- `components/mushaf/MushafPage.tsx`
- `components/mushaf/MushafSlider.tsx`
- `components/mushaf/MushafIndicator.tsx`

### Reader overlays and helpers
- `components/mushaf/GoToNavigator.tsx`
- `components/mushaf/BookmarksSheet.tsx`
- `components/mushaf/WordDetailSheet.tsx`
- `components/mushaf/AyahDetailModal.tsx`
- `components/mushaf/SelectionActionBar.tsx`
- `components/SearchCommand.tsx`
- `lib/deep-link.ts`
- `lib/mushaf/position.ts`
- `lib/selection/context.tsx`
- `lib/word/context.tsx`

### QCF2 rendering ownership
- `lib/fonts/loader.ts` loads per-page QCF2 fonts.
- `lib/fonts/qpc-v2-fonts.ts` holds the bundled 604-font map.
- `components/mushaf/AyahBlock.tsx` and `components/mushaf/MushafPage.tsx` are the core Quran text renderers.
- `components/mushaf/AyahDetailModal.tsx` also loads QCF2 font pages for large ayah detail views.

## Modal And Sheet Inventory

| Surface | File | Primitive |
| --- | --- | --- |
| Search | `components/SearchCommand.tsx` | raw `Modal` |
| Confirm dialog | `components/ui/ConfirmDialog.tsx` | raw `Modal` |
| Translation language picker | `components/settings/TranslationLanguagePicker.tsx` | raw `Modal` |
| Create deck | `components/flashcards/CreateDeckSheet.tsx` | raw `Modal` |
| Bookmarks | `components/mushaf/BookmarksSheet.tsx` | raw `Modal` |
| Go to page/surah/juz | `components/mushaf/GoToNavigator.tsx` | raw `Modal` |
| Ayah detail | `components/mushaf/AyahDetailModal.tsx` | raw `Modal` |
| Word detail | `components/mushaf/WordDetailSheet.tsx` | raw `Modal` |
| Reflections comments | `components/reflections/CommentsSheet.tsx` | raw `Modal` |
| Selection actions | `components/mushaf/SelectionActionBar.tsx` | shared `Sheet` |
| Write reflection | `components/reflections/WriteReflectionSheet.tsx` | shared `Sheet` |
| Mobile bottom sheet prototype | `components/ui/MobilePrimitives.tsx` | `MobileBottomSheet` export, not adopted |
| Deck picker inside ayah block | `components/mushaf/AyahBlock.tsx` | inline raw `Modal` |

Current implication: Hafiz has one shared sheet primitive and many one-off modal shells with separate width, backdrop, safe-area, animation, and close behavior rules.

## Responsive Breakpoints And Width Rules

### Breakpoint sources in code today
- `lib/ui/viewport.ts`: shared viewport contract for `360`, `412`, `768`, `1024`, and `1440`
- `components/ui/AppNavigation.tsx`: consumes `SIDEBAR_BREAKPOINT` for the mobile/desktop navigation split
- `lib/settings/context.tsx`: consumes `SIDEBAR_BREAKPOINT` for web font-scaling mode
- `components/SearchCommand.tsx` and `components/mushaf/WordDetailSheet.tsx`: consume `SIDEBAR_BREAKPOINT` for their phone-vs-wide shell split

### Screen widths to stabilize against
- `360px`: compact phone baseline
- `412px`: large phone baseline
- `768px`: tablet/sidebar transition
- `1024px`: sidebar behavior verification checkpoint
- `1440px`: desktop baseline

### Width drift already present
- Flashcards session caps content at `600px`.
- Bookmarks caps modal width at `560px`.
- Comments caps modal width at `760px`.
- Ayah detail caps modal width at `1080px`.
- Surah header caps some content at `840px`.

These limits are valid as local decisions, but they are not yet governed by one documented contract.

## Data Dependencies By Surface

| Surface | Primary local data | Remote or sync dependency |
| --- | --- | --- |
| Home | `surahs`, `study_cards`, `study_log`, `user_settings.last_mushaf_position` | auth banner state via Zustand only |
| Mushaf | `surahs`, `quran_text`, `page_map`, `page_lines`, `word_roots`, `word_translations`, `word_irab`, `tajweed_rules`, `tafseer`, `translations`, bookmarks/highlights/user settings | none required for reading |
| Search | `quran_text`, `translations`, `word_roots`, `search_history` | none |
| Progress | `study_log`, `study_cards`, `surahs` | auth gate only when Supabase is configured |
| Leaderboard | local scoring helpers and DB-backed sync helpers | Supabase fetches through TanStack Query |
| Settings | `user_settings`, `translation_active`, `translation_active_lang` | Supabase auth actions only |
| Onboarding | `surahs`, FSRS deck creation queries | none |
| Flashcards session | `study_cards`, `study_log`, `user_settings`, `quran_text`, `translations`, `tafseer`, word lookup tables | optional leaderboard sync when configured |
| Vocab review | `vocab_cards` plus local FSRS scheduling fields stored on those rows | none |
| Public profile | none | Supabase `profiles` read through TanStack Query (`fetchPublicProfile`) |
| Auth recovery | no local app tables; uses route params, default strings context, and auth store state | Supabase Auth reset email, hash-session restore, and password update |
| QA readiness | database boot status only via `useDatabaseStatus()` | none |
| Not-found | none | none |
| Reflections surfaces | local route context for ayah references | Supabase CRUD through TanStack Query and API helpers |

## Verification Constraints

### Current truth
- Documentation-only changes should be validated against the current code paths, not by changing runtime behavior.
- Later UI phases must run:
  - `npm run typecheck`
  - `npm run build:web`
  - `npx expo start --web`

### TypeScript scope boundary
- `tsconfig.json` includes Hafiz source files broadly, but now explicitly excludes `quran.com-frontend-next/**`.
- The optional local Quran.com reference checkout is therefore outside Hafiz TypeScript scope by design, even when it exists in the worktree.
- `npm run typecheck` is expected to validate Hafiz code only; future reference-only checkouts should keep the same boundary.

### Reader invariants that must survive every UI phase
- Quran display uses QCF2 per-page fonts only.
- QCF2 grouping uses `v2_page`, not `page_map`.
- Web QCF2 font loading uses `FontFace` with `display: "swap"` via `lib/fonts/loader.ts`.
- Verse word containers preserve the existing `direction: "ltr"` plus `flexDirection: "row-reverse"` behavior in the Quran text path.
- Copy/share/export paths use `text_uthmani`, not QCF2 PUA glyph strings.
