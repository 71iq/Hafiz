# New Phone Design Implementation Plan

Source folder: `new phone design/`

This document is an implementation roadmap only. It intentionally does not implement the new design. Use it later as the phase checklist for converting the current Hafiz phone UI to the new mobile design.

## Design Inventory

Primary reference files:

- `new phone design/uploads/DESIGN_SYSTEM.md`: visual north star, tokens, typography, spacing, motion, component rules.
- `new phone design/app.jsx`: complete mockup canvas inventory and target screen list.
- `new phone design/phone-frame.jsx`: phone target dimensions and mobile-safe framing assumptions.
- `new phone design/screen-home-v1.jsx`, `screen-home-v2.jsx`: two home variants.
- `new phone design/screen-mushaf.jsx`: Mushaf chrome and page slider.
- `new phone design/m-mushaf-page.jsx`: page-reading mode.
- `new phone design/m-mushaf-verse.jsx`: verse-by-verse mode.
- `new phone design/screen-word-panel.jsx`: word long-press panel.
- `new phone design/m-progress.jsx`: progress dashboard.
- `new phone design/m-flashcard.jsx`: flashcard session.
- `new phone design/m-search.jsx`: search.
- `new phone design/m-settings-1.jsx`, `m-settings-2.jsx`, `m-settings-3.jsx`: settings split across scroll positions.
- `new phone design/m-onboard-auth.jsx`: onboarding and auth.
- `new phone design/m-leaderboard.jsx`: leaderboard.
- `new phone design/icons.jsx`: icon vocabulary used by the mockups.
- `new phone design/Hafiz Mockups.html`, `Hafiz.pdf`: rendered references.

Non-negotiable project constraints to preserve:

- Do not replace real local data with mock data.
- All user-facing strings remain bilingual, with English and Arabic parity.
- RTL remains first-class.
- Quran text must continue using QCF2/KFGQPC V2 fonts, PUA glyph mapping, and `direction: "ltr"` plus `row-reverse` for Quran word containers.
- Reading data stays local SQLite/offline-first.
- NativeWind remains the primary styling system.
- Sync writes stay non-blocking.

## Phase 0 — Baseline Audit And Decisions

Goal: establish exact implementation scope before editing UI.

Tasks:

- Compare every mockup screen against current routes:
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
- Decide which home variant is canonical:
  - Option A: `HomeV1`, “Sanctuary Feed”, resume rail plus quiet stats.
  - Option B: `HomeV2`, “Editorial Hero”, verse-of-day focal screen.
- Decide whether search remains a command modal or becomes a full mobile tab/screen matching `m-search.jsx`.
- Decide whether the new phone design applies only below `SIDEBAR_BREAKPOINT` or also changes tablet widths.
- Identify current features not represented in mockups:
  - bookmarks sheet
  - reflections modal
  - translation language picker
  - flashcard deck management
  - vocabulary mode
  - offline banner
  - sync indicator
  - auth reset password
- Produce a screen-by-screen mapping table: current component, target mockup, dependencies, risk level.

Exit criteria:

- A short implementation decision note is appended to this file or `HAFIZ_SPEC.md`.
- No code changes yet beyond docs.

## Phase 1 — Mobile Design Tokens And Shared Primitives

Goal: make the new visual language available without rewriting screens yet.

Tasks:

- Audit existing `tailwind.config.js`, `global.css`, `DESIGN_SYSTEM.md`, and `components/ui/*`.
- Ensure token names from the mockup design system are present or mapped:
  - `surface`
  - `surface-low`
  - `surface-mid`
  - `surface-high`
  - `surface-dim`
  - `surface-bright`
  - `primary`
  - `primary-soft`
  - `primary-accent`
  - `primary-bright`
  - `gold`
  - `gold-light`
  - `gold-dark`
  - `charcoal`
  - `warm-400`
  - dark-mode surface ladder
- Verify font availability:
  - Manrope for UI.
  - Noto Serif for display.
  - Arabic UI font for non-Quran Arabic text.
  - QCF2 for Quran text only.
- Create or update reusable mobile primitives:
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
- Keep components data-agnostic. They should accept props from existing real data.
- Add press states using existing React Native patterns:
  - scale `0.98` for buttons/cards.
  - bottom-sheet spring parity with the mockups.
- Audit dark mode after each primitive.

Exit criteria:

- Shared components render in isolation inside real screens or a lightweight dev harness.
- No screen has been fully redesigned yet.
- `npx tsc --noEmit` passes.
- `npx expo export --platform web` passes.

## Phase 2 — Mobile Navigation And App Chrome

Goal: align the phone navigation and chrome with the new mobile design before changing content screens.

Tasks:

- Update `components/ui/AppNavigation.tsx` mobile bottom bar only.
- Preserve desktop sidebar behavior unless explicitly redesigned later.
- Match mobile bottom bar rules:
  - absolute bottom placement.
  - large rounded top radius.
  - glassmorphic background on web.
  - active pill with `primary-soft` background and `gold` icon/text.
  - inactive labels at 50% opacity.
  - press scale animation.
- Decide visible mobile tabs:
  - Mushaf.
  - Home or Review, depending on final product decision.
  - Leaderboard.
  - Progress.
  - Settings.
  - Search if full-screen search becomes a tab.
- Make chrome hide/show compatible with:
  - Mushaf page mode.
  - Mushaf verse mode.
  - Flashcard session route outside tabs.
  - modal/sheet overlays.
- Ensure `OfflineBanner` and `SyncIndicator` do not collide with the new top/header areas.
- Verify Arabic and English label lengths fit on 320px, 375px, 399px, and 430px widths.

Exit criteria:

- Navigation is usable on phone widths.
- Existing routes still navigate correctly.
- No desktop regression.

## Phase 3 — Mushaf Mobile Chrome

Goal: implement the mobile Mushaf top bar, page indicator, and bottom page slider from `screen-mushaf.jsx`.

Tasks:

- Refactor the current Mushaf header in `app/(tabs)/mushaf.tsx` into mobile-specific and desktop-specific render paths.
- For mobile, implement the glass top bar:
  - right side: surah badge and surah name.
  - center: page indicator/bookmark-style page chip.
  - left side: juz label and juz number.
  - RTL mirroring without interfering with Quran word direction.
- Implement mobile view mode control:
  - page/verse toggle should fit inside the new top chrome.
  - avoid the current desktop-style dense toolbar on phone.
- Implement mobile bottom page slider:
  - thin 2px track.
  - RTL page progression, page 1 on the right and page 604 on the left.
  - compact page labels.
  - draggable thumb.
  - floating label while dragging: surah name plus page number.
  - expand chevron opens existing `GoToNavigator`.
- Preserve hide-on-scroll behavior only where it improves reading.
- Confirm header/slider do not overlap content after safe-area insets.
- Keep `MushafIndicator` behavior or replace it with the new top bar data.

Exit criteria:

- Page and verse modes share the new mobile chrome.
- Go-to navigator still works.
- Slider updates current page accurately.
- RTL page slider behaves correctly.

## Phase 4 — Mushaf Page View

Goal: make page-reading mode match `m-mushaf-page.jsx` while preserving QCF2 correctness and performance.

Tasks:

- Keep the existing virtualized `PageMushaf` architecture.
- Do not render all 604 pages at once.
- Preserve:
  - `FlatList` virtualization.
  - `getItemLayout`.
  - `initialNumToRender={1}`.
  - `maxToRenderPerBatch={1}`.
  - small `windowSize`.
  - memoized `MushafPage`.
- Adapt page content spacing:
  - top padding accounts for glass top bar.
  - bottom padding accounts for glass slider.
  - page content uses generous side padding from the mockup.
- Keep all Quran text QCF2-based:
  - no system Arabic font for Quran text.
  - no mock Arabic text.
  - no plain Uthmani display in page view unless used only as fallback.
- Keep word interactions:
  - tap/double-tap behavior.
  - long-press word sheet.
  - ayah marker long-press selection if still desired.
- Validate page-words layout, page-lines layout, and per-page font loading on web/native.
- Test performance on:
  - first page open.
  - fast page swipes.
  - jumping to page 442.
  - font size changes.

Exit criteria:

- Phone page view visually matches target while staying fast.
- QCF2 layout remains correct.
- No whole-Mushaf render regression.

## Phase 5 — Mushaf Verse-By-Verse View

Goal: redesign verse mode toward `m-mushaf-verse.jsx`.

Tasks:

- Refactor `components/mushaf/AyahBlock.tsx` for mobile variants.
- Make verse cards less card-heavy and more editorial:
  - softer surfaces.
  - number badge top right in RTL.
  - generous verse whitespace.
  - collapsible English row.
  - collapsible tafseer row.
  - reflections access through modal, not inline expansion.
- Preserve current behavior:
  - translation setting controls default visibility.
  - tafseer setting controls default visibility.
  - translation language direction controls text alignment.
  - QCF2 display remains right-aligned.
  - copy/share uses `text_uthmani`, not QCF2 PUA.
  - bookmark toggles directly.
  - play stays disabled until audio exists.
- Implement sticky write-reflection CTA if product direction confirms it:
  - bottom pill.
  - does not overlap bottom nav or page slider.
  - opens existing `WriteReflectionSheet`.
- Preserve FlashList virtualization in verse mode.
- Confirm all header action buttons have direct actions and do not open extra context menus.
- Ensure the active verse and highlighted deep-link verse states still work.

Exit criteria:

- Verse view matches the new mobile composition.
- No duplicate reflection toggles.
- No regressions in translation, tafseer, bookmark, share, or hide mode.

## Phase 6 — Word Long-Press Panel

Goal: redesign `WordDetailSheet` to match `screen-word-panel.jsx`.

Tasks:

- Keep the current data model:
  - word-by-word English meaning.
  - Arabic meaning.
  - i'rab.
  - morphology.
  - tajweed.
  - qiraat placeholder.
  - occurrences.
- Update sheet layout:
  - dimmed Quran page backdrop.
  - rounded top sheet.
  - drag handle.
  - context chips: `surah:ayah:word`.
  - “show full ayah” button.
  - close button.
  - horizontal RTL tab strip.
  - large focused word display.
  - root metadata.
  - expandable long tafseer/source cards.
  - quick stats row.
  - source attribution at bottom.
  - footer action row.
- Preserve nested scroll behavior.
- Ensure tab labels are bilingual.
- Use real local SQLite data only.
- Keep QCF2/text identity separate from Arabic UI text.
- Verify on small phone heights where keyboard/sheets can compress content.

Exit criteria:

- Word panel is visually aligned with mockup.
- Every existing tab still has data or a known placeholder.
- Long content remains scrollable.

## Phase 7 — Home Screen

Goal: redesign the mobile home screen after selecting canonical variant.

Tasks:

- Choose `HomeV1` or `HomeV2` as the target.
- Map every visual section to real data:
  - greeting/user display.
  - Hijri/Gregorian date if available.
  - resume reading position from `user_settings`.
  - due cards from FSRS/study cards.
  - streak and review counts from study logs.
  - memorized ayah count from decks/progress.
  - active deck list from stored deck metadata.
  - sign-in CTA if unauthenticated.
- Remove mock-only concepts unless backed by data:
  - “verse of the day” requires a real deterministic/local source or product approval.
  - notifications require actual feature state.
- Use editorial header pattern:
  - label-sm eyebrow.
  - Noto Serif/Arabic display title.
  - one focal element.
- Implement primary action:
  - start review if due cards exist.
  - continue reading otherwise.
- Ensure home remains secondary to Mushaf as default launch if that remains the product decision.

Exit criteria:

- Home uses real app state only.
- Empty states are clean.
- Authenticated and unauthenticated states both work.

## Phase 8 — Progress Screen

Goal: adapt `m-progress.jsx` into `app/(tabs)/progress.tsx`.

Tasks:

- Reuse existing progress calculations where possible.
- Redesign top header:
  - eyebrow.
  - display title.
  - asymmetric RTL composition.
- Implement daily reminder/banner only if copy is approved and bilingual.
- Redesign stat grid:
  - mastery percentage.
  - memorized ayah count.
  - longest streak.
  - total sessions.
- Redesign heatmap:
  - horizontally scrollable on phone.
  - tonal cells.
  - today outline.
  - activity legend.
  - no heavy borders.
- Redesign surah progress list:
  - circular/number badges.
  - Arabic display name plus English transliteration.
  - thin progress hairline.
- Keep empty state for no tracked surahs.
- Check calculations against existing `lib/fsrs/scoring.ts`.

Exit criteria:

- Progress screen matches mobile design.
- Existing scoring stays unchanged unless explicitly requested.

## Phase 9 — Flashcard Review Session

Goal: redesign `app/flashcards/session.tsx` to match `m-flashcard.jsx`.

Tasks:

- Preserve FSRS scheduling behavior exactly.
- Preserve six test modes and their toggles.
- Redesign top session chrome:
  - close button.
  - hairline progress.
  - current card count.
  - state badge.
- Redesign question state:
  - prompt card.
  - QCF2 verse text where Quran text appears.
  - surah/ayah reference.
  - reveal-answer button.
- Redesign answer state:
  - answer card.
  - translation/tafseer/help text where applicable.
  - four FSRS grade buttons.
  - schedule preview labels.
- Ensure button labels are bilingual and fit.
- Keep all session data prefetched at start.
- Ensure no network dependency.
- Test each test mode, not only next-ayah mode.

Exit criteria:

- Review workflow behavior is unchanged.
- Question and answer states match target visual hierarchy.

## Phase 10 — Search

Goal: redesign search toward `m-search.jsx`.

Tasks:

- Decide route strategy:
  - keep current command modal and restyle it, or
  - create/show full mobile search route while desktop may keep command modal.
- Implement top editorial header:
  - “Quran / words / roots” eyebrow.
  - display title.
- Redesign input:
  - full pill input.
  - RTL placeholder/text handling.
  - clear button.
- Redesign mode pills:
  - text search.
  - root search.
- Implement recent searches using persisted real history if available; otherwise add persistence before showing it.
- Redesign results:
  - grouped by surah.
  - result counts.
  - highlighted match spans.
  - taps navigate to Mushaf deep link.
- Preserve local SQLite search queries.
- Preserve minimum character guard.
- Ensure Arabic/English UI parity.

Exit criteria:

- Search remains fast and local.
- Results are readable and navigable on phone.

## Phase 11 — Settings

Goal: redesign settings across the three mockup segments.

Tasks:

- Preserve existing settings:
  - UI language.
  - theme.
  - font size.
  - view mode.
  - page scroll mode.
  - show translation.
  - show tafseer.
  - tafseer source.
  - translation language.
  - daily review limit.
  - flashcard test modes.
  - account/auth actions.
- Split into sections matching mockups:
  - account.
  - language.
  - theme.
  - Quran display/font.
  - page/verse preferences.
  - inline content preferences.
  - tafseer/translation.
  - review/session settings.
- Use cards and segmented controls from Phase 1.
- Replace dense rows with spacious phone-first groups.
- Ensure every control is reachable on 320px-height-constrained devices.
- Avoid duplicate controls between Mushaf chrome and settings.
- Keep persisted `user_settings` keys stable unless migration is required.

Exit criteria:

- Settings are visually aligned with new phone design.
- All existing settings still persist and load.

## Phase 12 — Onboarding And Auth

Goal: redesign onboarding and auth from `m-onboard-auth.jsx`.

Tasks:

- Preserve onboarding gate:
  - `user_settings.onboarding_completed`.
  - redirect to Mushaf after completion.
- Redesign onboarding step 1:
  - centered brand mark.
  - large Hafiz title.
  - short bilingual copy.
- Redesign onboarding step 2:
  - surah selection chips.
  - real surah list from local SQLite.
  - selected count.
  - deck creation using existing deck metadata system.
- Redesign onboarding step 3:
  - first deck created confirmation.
  - real selected-surah/card count.
  - start review or continue to Mushaf.
- Redesign auth:
  - login.
  - signup.
  - reset password stays functional even if not in mockups.
- Verify Supabase unconfigured mode:
  - app remains usable offline.
  - auth UI shows unavailable copy.
- OAuth buttons should only appear if implemented/configured.

Exit criteria:

- First-run flow is polished and still robust offline.
- Auth does not imply unsupported providers.

## Phase 13 — Leaderboard

Goal: redesign leaderboard from `m-leaderboard.jsx`.

Tasks:

- Preserve existing Supabase/TanStack Query architecture.
- Preserve tabs:
  - Daily.
  - Weekly.
  - All-time.
  - Streak.
- Redesign top header:
  - eyebrow.
  - display title.
- Redesign tab segmented control.
- Redesign rows:
  - rank.
  - avatar/initial.
  - username/display name.
  - handle.
  - score.
  - medal for top ranks.
  - current-user highlight.
- Implement empty/invite state only if sharing is available; otherwise use a safe empty state.
- Preserve unauthenticated/auth-gate behavior.
- Avoid hardcoded rank/user data.

Exit criteria:

- Leaderboard matches visual direction and still uses live Supabase data.

## Phase 14 — Reflections And Community Sheets

Goal: align reflections modals/sheets with the new phone design.

Tasks:

- Restyle `ReflectionsSection`, `ReflectionCard`, `WriteReflectionSheet`, and `CommentsSheet`.
- Keep verse reflections opening in a modal/sheet, not inline.
- Preserve count badge on verse pill.
- Redesign write-reflection sheet:
  - display ayah reference.
  - show preview.
  - text input.
  - auth gate.
  - submit state.
- Redesign comments sheet:
  - nested sheet layout.
  - loading/empty states.
  - comment input.
- Keep optimistic likes and rollback behavior.
- Ensure Supabase-unconfigured mode returns null/CTA safely.

Exit criteria:

- Community features visually match new sheet language.
- Existing network/error behavior remains stable.

## Phase 15 — Cross-Screen RTL, I18n, And Accessibility Pass

Goal: verify global correctness after screen redesigns.

Tasks:

- Use `.codex/skills/i18n-check.md`.
- Use `.codex/skills/rtl-audit.md`.
- Check every new string exists in English and Arabic.
- Ensure no hardcoded Arabic-only UI strings remain unless they are Quran/source text.
- Verify RTL mirroring:
  - headers.
  - bottom nav.
  - sliders.
  - segmented controls.
  - sheets.
  - lists.
  - arrows/chevrons.
- Preserve Quran text direction invariant:
  - `direction: "ltr"`.
  - `flexDirection: "row-reverse"`.
- Accessibility:
  - tappable targets at least 44px where possible.
  - sufficient contrast in dark mode.
  - no text clipped at larger font sizes.
  - modal close controls are reachable.
- Check both UI languages on every redesigned screen.

Exit criteria:

- Arabic and English UI are feature-equivalent.
- RTL layout issues are documented or fixed.

## Phase 16 — Performance And Rendering Audit

Goal: ensure the new design does not regress reading performance.

Tasks:

- Use `.codex/skills/build-and-test.md`.
- Profile page mode:
  - initial load.
  - page swipes.
  - jump to far page.
  - font changes.
  - QCF2 font reveal.
- Profile verse mode:
  - FlashList mount.
  - rapid scroll.
  - opening/closing translation/tafseer.
  - reflection modal.
- Verify heavy visual effects:
  - blur/backdrop filters on web.
  - glass bars.
  - shadows.
  - SVG progress rings.
- Remove or reduce effects where they harm Android/web performance.
- Ensure no screen renders the full Quran unnecessarily.
- Check memory on web export and mobile dev server.
- Keep static imports reasonable; avoid loading all mockup assets.

Exit criteria:

- Page mode remains smooth on phone.
- Verse mode remains smooth.
- Web export succeeds without OOM.

## Phase 17 — Visual QA Matrix

Goal: verify the implemented design against the mockups.

Tasks:

- Run `npx expo start --web` for visual testing.
- Capture screenshots with Playwright for:
  - 320x740.
  - 375x812.
  - 399x836.
  - 430x932.
  - light mode.
  - dark mode.
  - English UI.
  - Arabic UI.
- Screens to capture:
  - Mushaf page mode.
  - Mushaf verse mode.
  - Word panel.
  - Home.
  - Progress.
  - Flashcard question.
  - Flashcard answer.
  - Search empty.
  - Search results.
  - Settings top/middle/bottom.
  - Onboarding steps.
  - Login.
  - Signup.
  - Leaderboard.
  - Reflections modal.
- Compare against `new phone design/Hafiz.pdf` and the source JSX mockups.
- Check:
  - top safe area.
  - bottom nav overlap.
  - sheet height.
  - text wrapping.
  - icon alignment.
  - dark-mode layer distinction.
  - no unintended borders/shadows.

Exit criteria:

- Screenshot set is reviewed.
- Any deviations are listed as accepted or fixed.

## Phase 18 — Rollout Strategy

Goal: land the redesign safely.

Tasks:

- Prefer small commits by phase, pushed to `main` per repo rules.
- Avoid a single massive rewrite.
- After each phase:
  - `npx tsc --noEmit`.
  - `npx expo export --platform web`.
  - targeted manual check.
- Consider temporary feature flag only if a phase must land partially:
  - mobile-only flag.
  - never fork data behavior.
- Keep desktop regressions out of mobile redesign commits.
- Keep changelog notes in the commit messages or a rollout section.

Exit criteria:

- New mobile design is implemented incrementally.
- Each phase can be reverted independently if needed.

## Suggested Implementation Order

1. Phase 0: Baseline audit and final decisions.
2. Phase 1: Tokens and primitives.
3. Phase 2: Mobile navigation/chrome.
4. Phase 3: Mushaf mobile chrome.
5. Phase 4: Mushaf page view.
6. Phase 5: Mushaf verse view.
7. Phase 6: Word panel.
8. Phase 14: Reflections/community sheets.
9. Phase 7: Home.
10. Phase 9: Flashcard session.
11. Phase 8: Progress.
12. Phase 10: Search.
13. Phase 11: Settings.
14. Phase 12: Onboarding/auth.
15. Phase 13: Leaderboard.
16. Phase 15: RTL/i18n/accessibility.
17. Phase 16: Performance audit.
18. Phase 17: Visual QA.
19. Phase 18: Rollout cleanup.

## Key Risks To Watch

- Accidentally replacing QCF2 Quran text with normal Arabic mockup text.
- Overusing web blur/backdrop filters and slowing mobile web.
- Making page mode laggy by increasing `windowSize` or removing `getItemLayout`.
- Introducing Arabic-only UI strings from mockups without English equivalents.
- Showing mock data for stats, leaderboards, decks, verse of the day, or recent searches.
- Letting new bottom bars/sheets overlap native safe areas.
- Treating the mockups’ 399x836 frame as the only supported phone size.
- Losing Supabase-unconfigured/offline behavior.
- Breaking sync by awaiting or throwing from queued writes.
- Creating desktop regressions while changing phone-only UI.

## Later Implementation Prompt Template

Use this when asking Codex to implement a phase:

```text
Implement Phase N from NEW_PHONE_DESIGN_IMPLEMENTATION_PLAN.md.
Read AGENTS.md, HAFIZ_SPEC.md, and the relevant files in `new phone design/`.
Do not use mock data. Preserve i18n, RTL, QCF2, offline SQLite reads, and non-blocking sync.
Run npx tsc --noEmit and npx expo export --platform web, then commit and push to main.
```
