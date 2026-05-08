# Hafiz Web UI Audit

## Scope
This audit records the current UI stabilization risks before app code changes for the web pass. It focuses on responsive behavior, overlays, search/navigation, i18n/RTL, design-system drift, and verification reliability.

## Primary Findings

### 1. TypeScript verification is polluted by the local Quran.com reference checkout
- `tsconfig.json` includes every `**/*.ts` and `**/*.tsx` file in the repository.
- The untracked `quran.com-frontend-next/` directory is therefore treated as Hafiz source by `npx tsc --noEmit` whenever it exists locally.
- Observed failure categories from `npx tsc --noEmit` on the current worktree:
  - missing external reference-only packages such as `@playwright/test`, `next`, `@sentry/nextjs`, `@sentry/profiling-node`, `dotenv`, `vitest`, `@testing-library/react`, and related Quran.com dependencies
  - unresolved Quran.com-internal aliases such as `@/...`, `types/...`, and `src/...`
  - follow-on type noise inside the reference checkout such as implicit-`any`, missing `JSX` namespace entries, and unknown-service errors
- Impact:
  - local validation results are noisy and environment-dependent
  - reference code can fail Hafiz verification even though it is read-only and outside product scope
- Required follow-up:
  - exclude `quran.com-frontend-next/**` from Hafiz TypeScript scope before starting the main UI edits

### 2. Root-stack settings and i18n ownership is inconsistent outside tabs
- `app/(tabs)/_layout.tsx` is the shared owner of `SettingsProvider`, but several root-level routes sit outside that boundary.
- Confirmed examples:
  - `app/auth/login.tsx`
  - `app/auth/signup.tsx`
  - `app/auth/forgot-password.tsx`
  - `app/auth/reset-password.tsx`
  - `app/profile/[userId].tsx`
  - `app/qa-ready.tsx`
  - `app/+not-found.tsx`
- Current behavior:
  - auth, profile, and QA screens call `useStrings()` and/or `useSettings()` with only the default context values available
  - not-found bypasses the strings layer entirely with hardcoded English copy
- Impact:
  - root-stack screens can drift from the user-selected language, theme, and RTL settings
  - a route can look "correct enough" in default English/light/LTR while still violating the real app contract

### 3. Search exists as a modal system, not as a stable route
- `app/(tabs)/search.tsx` is a redirect placeholder to home.
- The search tab is intentionally hidden in `app/(tabs)/_layout.tsx`.
- Actual search behavior lives in `components/SearchCommand.tsx` and is launched from:
  - `app/(tabs)/home.tsx`
  - `app/(tabs)/mushaf.tsx`
- Impact:
  - route semantics and user semantics diverge
  - search cannot yet be stabilized as a full page across `360`, `412`, `768`, and desktop
  - navigation/history/focus decisions are trapped inside a modal-only implementation

### 4. Breakpoint ownership is duplicated and partially hardcoded
- `components/ui/AppNavigation.tsx` defines `SIDEBAR_BREAKPOINT = 768`.
- `lib/settings/context.tsx` separately defines `MOBILE_BREAKPOINT = 768`.
- `components/SearchCommand.tsx` uses raw `width < 768`.
- `components/mushaf/WordDetailSheet.tsx` uses raw `width < 768`.
- Impact:
  - behavior stays mostly aligned today only because every place happens to use the same number
  - future changes will drift quickly because the contract is not centralized

### 5. Overlay behavior is fragmented across many one-off modals
- Shared `Sheet` is used by:
  - `components/mushaf/SelectionActionBar.tsx`
  - `components/reflections/WriteReflectionSheet.tsx`
- Raw `Modal` is used by:
  - `components/SearchCommand.tsx`
  - `components/ui/ConfirmDialog.tsx`
  - `components/settings/TranslationLanguagePicker.tsx`
  - `components/flashcards/CreateDeckSheet.tsx`
  - `components/reflections/CommentsSheet.tsx`
  - `components/mushaf/BookmarksSheet.tsx`
  - `components/mushaf/GoToNavigator.tsx`
  - `components/mushaf/AyahDetailModal.tsx`
  - `components/mushaf/WordDetailSheet.tsx`
  - the deck picker inside `components/mushaf/AyahBlock.tsx`
- `components/ui/MobilePrimitives.tsx` includes `MobileBottomSheet`, but nothing consumes it yet.
- Impact:
  - inconsistent backdrop opacity
  - inconsistent animation styles
  - inconsistent safe-area handling
  - inconsistent close affordances
  - width and height rules vary per surface with no shared contract

### 6. String ownership is mostly centralized, but not complete
- Good baseline:
  - most route-level UI uses `useStrings()`
  - bilingual labels live in `lib/i18n/strings.ts`
- Current drift examples:
  - `app/auth/login.tsx` hardcodes Zod messages like `Invalid email address` and `Password must be at least 6 characters`
  - `app/auth/signup.tsx` hardcodes validation copy for email, password, and username
  - `app/auth/forgot-password.tsx` hardcodes validation copy
  - `app/auth/reset-password.tsx` hardcodes validation copy
  - `app/qa-ready.tsx` hardcodes `QA Readiness` and `Wait for ready before starting screenshot capture.`
  - `app/+not-found.tsx` hardcodes `Oops!`, `This screen doesn't exist.`, and `Go to home screen!`
  - `components/reflections/CommentsSheet.tsx` and `components/reflections/ReflectionCard.tsx` emit compact relative-time suffixes like `m`, `h`, and `d`, which are not localized
- Impact:
  - English-only strings can leak in Arabic mode
  - parity checks cannot stop at top-level route copy

### 7. RTL handling is strong in core reader paths but weaker in several overlays
- Stronger paths:
  - `app/(tabs)/_layout.tsx` sets root direction using `isRTL`
  - `components/ui/AppNavigation.tsx` supports `isRTL`
  - `app/(tabs)/mushaf.tsx`, `components/mushaf/AyahBlock.tsx`, and `components/mushaf/AyahDetailModal.tsx` explicitly handle reader direction
- Hotspots that need direct audit:
  - `components/reflections/CommentsSheet.tsx` does not consume `isRTL`
  - `components/flashcards/CreateDeckSheet.tsx` only reads `isDark`
  - `components/mushaf/BookmarksSheet.tsx` only reads `isDark`
  - `components/mushaf/GoToNavigator.tsx` only reads `isDark`
- Impact:
  - sheets and dialogs can remain structurally LTR even when route content is RTL
  - action ordering, close buttons, and aligned metadata may not mirror consistently

### 8. Design-system drift is visible in borders, separators, and content widths
- The project has an existing tonal-surface direction in shared primitives, but route surfaces still mix styles.
- Examples:
  - `app/(tabs)/home.tsx` uses a hard `border-t` divider inside the resume card
  - `components/mushaf/AyahDetailModal.tsx` uses explicit header and tab borders
  - `components/reflections/CommentsSheet.tsx` uses bordered input and card-like sections
  - `app/(tabs)/mushaf.tsx` and `components/ui/MobilePrimitives.tsx` both use glass bars, but they are not yet the same shared implementation path
- Navigation facts that any design doc must track:
  - visible navigation in code is five tabs: Home, Mushaf, Leaderboard, Progress, Settings
  - search and flashcards remain hidden redirect routes today
  - desktop navigation is a floating `248px` panel, not a fixed `220px` sidebar
  - tab press scale in `AppNavigation` is `0.98`
- Width drift examples:
  - `app/flashcards/session.tsx` uses `maxWidth = 600`
  - `components/mushaf/BookmarksSheet.tsx` caps at `560`
  - `components/reflections/CommentsSheet.tsx` caps at `760`
  - `components/mushaf/AyahDetailModal.tsx` caps at `1080`
- Impact:
  - screens feel related but not governed by one layout contract
  - desktop widths can sprawl or compress unpredictably

### 9. The exported primitive surface is broader than the live app contract
- `components/ui/MobilePrimitives.tsx` exports scaffolds, segmented controls, glass bars, and a bottom sheet, but repo search shows only exports and no route adoption.
- `components/ui/Badge.tsx`, `components/ui/Tabs.tsx` (`TabBar`), `components/ui/Separator.tsx`, and `components/ui/Text.tsx` (`Typography`) are also exported without current app-route adoption.
- `components/ui/CustomTabBar.tsx` exists as another navigation primitive variant, but `app/(tabs)/_layout.tsx` uses `AppNavigation` instead.
- Impact:
  - Hafiz currently has two design-language layers:
    - existing shared primitives used in production
    - exported-but-unused primitives that can be mistaken for the canonical path
  - stabilization work should either adopt these primitives intentionally or stop treating them as the implied future contract

## Route Risk Summary

| Area | Main risk |
| --- | --- |
| Home | local layout decisions and search modal launcher are not yet tied to a shared responsive contract |
| Mushaf | strongest UI surface, but also the densest concentration of overlays, breakpoints, and QCF2 invariants |
| Search | hidden route plus modal-only implementation blocks clear navigation semantics |
| Leaderboard | remote state plus responsive segmented tabs need cross-width verification |
| Progress | mostly stable, but still depends on route-local spacing and width choices |
| Settings | large settings surface with many grouped controls and one-off modal picker |
| Onboarding/Auth | validation copy still partly English-only; needs parity audit |
| Flashcards session | out-of-tabs route with its own width logic and provider boundary |
| Reflections overlays | highest RTL and overlay-consistency risk outside Mushaf |

## Immediate Conclusions
- Documentation is required before more UI edits because the repo now has enough responsive and overlay surface area to drift without a contract.
- The first code change after this docs phase should be verification hygiene, followed by breakpoint consolidation, then overlay standardization.
