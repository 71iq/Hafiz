# Hafiz Web UI Audit

## Scope
This audit records the current UI stabilization risks after the initial web stabilization pass. It focuses on responsive behavior, overlays, search/navigation, i18n/RTL, design-system drift, and verification reliability. It is descriptive; `docs/agent/WEB_UI_CONTRACT.md` remains authoritative for live UI rules and verification gates.

## Primary Findings

### 1. TypeScript verification hygiene now isolates the local Quran.com reference checkout
- `tsconfig.json` still uses broad Hafiz include globs, but it now explicitly excludes `quran.com-frontend-next/**`.
- The untracked `quran.com-frontend-next/` directory no longer enters Hafiz source scope when it exists locally.
- Impact:
  - `npm run typecheck` is now a stable Hafiz-only verification step instead of an environment-dependent mixed-repo check
  - the Quran.com checkout stays read-only reference material rather than a hidden validation dependency
- Required follow-up:
  - keep future reference-only checkouts out of Hafiz runtime, Metro, and TypeScript scope by default

### 2. Root-stack settings and i18n ownership is mostly normalized
- `app/(tabs)/_layout.tsx` remains the shared owner of `SettingsProvider` for the tab experience.
- Root-level routes that need full settings state now wrap themselves in `SettingsProvider`, including onboarding, flashcards session, vocab review, profile routes, and the Zayt preview.
- Auth, QA, and not-found routes use the startup-language string catalog directly because they sit before or outside the tab settings boundary.
- Current behavior:
  - auth validation copy now comes from `lib/i18n/strings.ts`
  - `app/qa-ready.tsx` and `app/+not-found.tsx` use startup-language strings
  - root auth still cannot reflect a later in-app language switch until settings are loaded
- Impact:
  - the previous English-only root-stack leak is addressed
  - remaining drift risk is limited to startup-language versus persisted-settings timing on early/root auth screens

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

### 4. Breakpoint ownership is now centralized, but wider width rules are still local
- `lib/ui/viewport.ts` is the shared owner of the viewport contract for `360`, `412`, `768`, `1024`, and `1440`.
- `components/ui/AppNavigation.tsx`, `lib/settings/context.tsx`, `components/SearchCommand.tsx`, and `components/mushaf/WordDetailSheet.tsx` now consume the shared sidebar breakpoint instead of owning their own `768` split.
- Many other width caps remain intentionally route-local in this phase, such as search/dialog max widths and reader-specific content widths.
- Impact:
  - the primary mobile/desktop split is less likely to drift across navigation, settings, search, and word detail
  - a broader content-width system is still pending because this pass does not redesign or normalize route-local width caps

### 5. Overlay behavior is now mostly centralized, with a small legacy backlog
- `components/ui/ResponsiveOverlay.tsx` is the canonical adaptive overlay shell for sheets and dialogs.
- Current migrated consumers include search, confirm dialog, translation picker, deck cards/settings/filter sheets, bookmarks, go-to navigator, ayah detail, word detail, reflections comments/write sheets, private notes, recitation range, reading settings, profile sheets, and reflection-feed filters.
- Shared behavior now covered for migrated consumers:
  - matching backdrop
  - web body scroll locking
  - top-most `Escape` dismissal
  - shared header/body/footer slots
  - phone sheet versus desktop panel/dialog presentation
- Raw `Modal` is now limited to:
  - `components/ui/ResponsiveOverlay.tsx` as the canonical primitive implementation
  - `components/ui/Sheet.tsx` as a legacy primitive
  - `components/ui/DropdownMenu.tsx`
  - `components/mushaf/PageViewNavigationSheet.tsx`
- Legacy `Sheet` is still used by:
  - `components/mushaf/SelectionActionBar.tsx`
- `components/ui/MobilePrimitives.tsx` includes `MobileBottomSheet`, but nothing consumes it yet.
- Remaining legacy overlay backlog after this pass:
  - migrate `components/mushaf/SelectionActionBar.tsx` from legacy `Sheet`
  - decide whether `components/mushaf/PageViewNavigationSheet.tsx` and `components/ui/DropdownMenu.tsx` should remain specialized popovers or move behind `ResponsiveOverlay`
  - delete or adopt unused `MobileBottomSheet`
- Impact:
  - modal backdrop, close behavior, and mobile/desktop presentation are now largely consistent
  - remaining risk is concentrated in specialized popover/menu surfaces and one legacy selection sheet

### 6. String ownership is strongly centralized, with typed key coverage
- Good baseline:
  - most route-level UI uses `useStrings()`
  - bilingual labels live in `lib/i18n/strings.ts`
  - `UIStrings` and `UIStringKey` are now inferred from the English catalog, so local helper props no longer need `s: any`
  - auth Zod validation messages, QA readiness text, and not-found text use bilingual strings
  - reflection relative-time suffixes use `lib/i18n/relative-time.ts`
- Current drift examples:
  - server/Supabase error messages may still surface in their original language unless normalized at the boundary
  - dynamic string-key catalogs still need `stringByKey()` fallbacks when keys are data-driven
- Impact:
  - static UI parity between English and Arabic is much stronger
  - future string additions should use the typed catalog instead of local string maps

### 7. RTL handling is strong in core reader paths and major overlays
- Stronger paths:
  - `app/(tabs)/_layout.tsx` sets root direction using `isRTL`
  - `components/ui/AppNavigation.tsx` supports `isRTL`
  - `app/(tabs)/mushaf.tsx`, `components/mushaf/AyahBlock.tsx`, and `components/mushaf/AyahDetailModal.tsx` explicitly handle reader direction
- Major overlay paths such as comments, bookmarks, translation picker, go-to navigator, reading settings, and page navigation now consume `isRTL` or explicit `dir`.
- Hotspots that need direct audit:
  - legacy `components/mushaf/SelectionActionBar.tsx`
  - dense reader controls where Quran glyph containers must keep `direction: "ltr"` plus `row-reverse`
  - any new popover/menu surface that bypasses `ResponsiveOverlay`
- Impact:
  - the highest-risk visible overlays have much better RTL coverage
  - guardrail tests should keep focusing on Quran glyph direction and popover/action ordering

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
| Onboarding/Auth | root auth uses startup-language strings; verify startup-language and persisted-settings timing |
| Flashcards session | out-of-tabs route with its own width logic and provider boundary |
| Reflections overlays | mostly migrated to responsive overlays; keep testing auth-gated comments/write flows |

## Immediate Conclusions
- Documentation should stay close to runtime changes because responsive, overlay, and RTL contracts are now spread across shared primitives plus a few specialized popovers.
- Verification hygiene now includes TypeScript, unit RTL guardrails, and a passing ESLint baseline with visible warnings.
