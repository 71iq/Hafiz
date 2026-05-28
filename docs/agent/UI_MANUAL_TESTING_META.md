# Hafiz UI Manual Testing Meta

## Maintenance Rule

This is a living meta file for manual UI QA. Any model or human change that adds, removes, renames, or materially changes a page, user-visible component, overlay, setting, or user flow must update this file in the same change.

Keep this file exhaustive enough that a tester can use it as the source of truth for what should be manually checked after UI work. If a component is not directly testable by itself, list the route or flow that covers it.

## Baseline Test Matrix

Use this matrix for broad UI regression passes and for any high-risk reader, RTL, theme, or sync change.

- Platforms: web desktop, web tablet, web phone, iOS, Android.
- Web browsers: Safari, Chrome, Firefox where practical. Safari on iPad and iPhone is required for Quran text selection, font rendering, and browser toolbar color checks.
- Viewports: 360, 390, 412, 768, 1024, 1440, plus iPad portrait and landscape.
- Languages: English LTR and Arabic RTL.
- Themes: beige, white, dark, amoled, system, scheduled.
- Quran font modes: QCF2, QCF V4, QCF V4 Tajweed.
- Mushaf modes: verse by verse, page vertical scroll, page horizontal swipe.
- Auth states: signed out, signed in, just signed up, password reset, expired session.
- Network states: online, offline, reconnect after offline, Supabase unavailable, QF content unavailable.
- Sync states: empty queue, pending local writes, sync error, cross-device pull, last-write-wins conflict.
- Data states: first app load, warm cached app load, imported optional tafsir, tafsir downloading, no downloaded optional tafsir, empty reflections, populated reflections, empty decks, due reviews, no due reviews.
- Input methods: touch, mouse, trackpad, keyboard, hardware keyboard on iPad.
- Accessibility basics: tab order on web, visible focus states, screen-reader labels for icon controls, hit targets on phone.

## Route Inventory

Every route below should be included in full manual regression passes. Hidden or redirect routes are still listed because they can break navigation, provider boundaries, or deep links.

### Root And Shell Routes

- `app/_layout.tsx`
  - Root providers, route stack, auth/sync/audio/settings/database boundaries.
  - Check no provider-boundary crashes on direct route loads.
- `app/+html.tsx`
  - Web metadata, HTML language/bootstrap text, splash/loading copy, status/theme color.
  - Check English and Arabic initial loading text does not flash the wrong language.
- `app/(tabs)/_layout.tsx`
  - Tab layout, visible tab set, hidden routes, sync hook, navigation chrome coexistence.
- `app/(tabs)/index.tsx`
  - Onboarding gate and initial redirect to onboarding or home.
- `app/+not-found.tsx`
  - Unknown route UI, bilingual copy, navigation back home.
- `app/open.tsx`
  - Deep link bridge into Mushaf for `surah`, `ayah`, and invalid params.
- `app/qa-ready.tsx`
  - QA readiness route, provider assumptions, route accessibility.

### Public Routes

- `app/about.tsx`
  - Public content layout, links, language, theme, responsive behavior.
- `app/privacy.tsx`
  - Privacy content, QF/Supabase disclosures, scrolling, links, language.
- `app/terms.tsx`
  - Terms content, source notices, scrolling, links, language.

### Auth Routes

- `app/auth/login.tsx`
  - Email/password login, OAuth buttons, validation, loading, error, success redirect.
- `app/auth/signup.tsx`
  - Signup form, username/display name behavior, validation, success state.
- `app/auth/forgot-password.tsx`
  - Email request, loading, success, error, back navigation.
- `app/auth/reset-password.tsx`
  - Password reset token flow, validation, expired/invalid token, success redirect.
- `app/auth/qf-callback.tsx`
  - QF callback placeholder/error behavior, invalid params, privacy-safe copy.

### Onboarding

- `app/onboarding.tsx`
  - All onboarding screens, language switch, theme behavior, skip/finish, persistence.

### Main Tabs

- `app/(tabs)/home.tsx`
  - Dashboard state, daily review CTA, recent reading/move-to page, default deck cards, sync-derived data, empty and populated states.
- `app/(tabs)/mushaf.tsx`
  - Main reader route. See Mushaf flows below for full checklist.
- `app/(tabs)/leaderboard.tsx`
  - Daily, weekly, all-time, consistency tabs; signed-in and signed-out states; offline and empty states.
- `app/(tabs)/progress.tsx`
  - Activity heatmap, progress stat cards, default deck progress, surah progress, empty and populated states.
- `app/(tabs)/settings.tsx`
  - General, content, account, about, advanced sections; all pickers, sheets, controls, and settings persistence.
- `app/(tabs)/flashcards.tsx`
  - Deck overview, default decks, retention deck, custom decks if present, deck actions and sheets.
- `app/(tabs)/search.tsx`
  - Hidden search redirect/launcher behavior.
- `app/(tabs)/reflection-feed.tsx`
  - Reflection feed, search/filter/sort, comments, likes, write flow entry points, auth gate.
- `app/(tabs)/reflection-journey.tsx`
  - Journey content, ayah blocks, reading/reflection progression, empty/error states.

### Flashcard Routes

- `app/flashcards/session.tsx`
  - Review session route, all modes, grading, options menu, summary, exit flow.
- `app/flashcards/vocab.tsx`
  - Vocabulary review route, word prompt, ayah context, custom meaning edits, session summary.

### Profile Routes

- `app/profile/index.tsx`
  - Current user profile, settings/profile modal entry, auth gate.
- `app/profile/[userId].tsx`
  - Public profile, user stats, badges, notes/progress visibility, missing user state.

## Component Inventory

All user-visible components below need manual UI coverage when changed. Components that only render inside another surface are covered through the listed parent route or flow.

### Global And Navigation Components

- `components/LoadingScreen.tsx`
  - Loading copy, progress bar, language/theme/font flash.
- `components/SearchCommand.tsx`
  - Search modal, results, filters, recent searches, keyboard behavior.
- `components/ui/AppNavigation.tsx`
  - Sidebar and mobile bottom navigation, active state, RTL order.
- `components/ui/CustomTabBar.tsx`
  - Mobile tab bar, hidden tab behavior, safe area.
- `components/ui/OfflineBanner.tsx`
  - Offline/online transitions, overlay coexistence.
- `components/ui/SyncIndicator.tsx`
  - Sync state visibility, error/pending/success states.
- `components/ui/Toast.tsx`
  - Toast placement, timing, overlap with overlays and bottom nav.
- `components/ui/ErrorBoundary.tsx`
  - Error fallback UI and recovery action.

### UI Primitive Components

Spot-test these through every route that consumes them after any style, accessibility, or interaction change.

- `components/ui/AuthGate.tsx`
- `components/ui/Badge.tsx`
- `components/ui/Button.tsx`
- `components/ui/Card.tsx`
- `components/ui/ConfirmDialog.tsx`
- `components/ui/DropdownMenu.tsx`
- `components/ui/EmptyState.tsx`
- `components/ui/Field.tsx`
- `components/ui/FormTextField.tsx`
- `components/ui/Icon.tsx`
- `components/ui/Input.tsx`
- `components/ui/MobilePrimitives.tsx`
- `components/ui/Progress.tsx`
- `components/ui/ResponsiveOverlay.tsx`
- `components/ui/ScreenContent.tsx`
- `components/ui/Separator.tsx`
- `components/ui/Sheet.tsx`
- `components/ui/Skeleton.tsx`
- `components/ui/Switch.tsx`
- `components/ui/Tabs.tsx`
- `components/ui/Text.tsx`
- `components/ui/ToggleGroup.tsx`
- `components/ui/index.ts`

### Mushaf Components

- `components/mushaf/AyahBlock.tsx`
  - Verse card header/actions, QCF text, action pills, highlights, bookmarks, audio, RTL.
- `components/mushaf/AyahDetailModal.tsx`
  - Ayah panel, tabs, navigation next/previous, tafsir sources, notes, reflections, hadith, qiraat.
- `components/mushaf/BookmarksSheet.tsx`
  - Bookmark list, empty state, remove, jump to ayah.
- `components/mushaf/FocusModeControls.tsx`
  - Focus mode controls, speed, play/pause, safe-area placement.
- `components/mushaf/FontSizeControl.tsx`
  - Font size stepping, preview, page-mode locking.
- `components/mushaf/GoToNavigator.tsx`
  - Surah/juz/page navigation, search, RTL, invalid inputs.
- `components/mushaf/HifzControls.tsx`
  - Reveal/hide controls, auto reveal, page advance, reset.
- `components/mushaf/JuzNameText.tsx`
  - Juz labels in Arabic/English and page mode.
- `components/mushaf/MushafIndicator.tsx`
  - Page/surah/juz indicator, RTL, scroll/safe area.
- `components/mushaf/MushafPage.tsx`
  - Page rendering, line fitting, QCF2/V4/V4 Tajweed, structural lines.
- `components/mushaf/MushafSlider.tsx`
  - Page slider, thumb position, RTL, drag, keyboard/touch.
- `components/mushaf/PageMushaf.tsx`
  - Vertical page list, horizontal page swipe, page indicator, page separators, page selection, hifz, font loading.
- `components/mushaf/RecitationRangeSheet.tsx`
  - Single/range/surah recitation controls, repeat, unavailable audio.
- `components/mushaf/SelectionActionBar.tsx`
  - Ayah selection actions, copy, highlight, bookmark, reflection, remove highlight.
- `components/mushaf/SurahHeader.tsx`
  - Surah header, V4 surah-name font, basmallah, clipping, themes.
- `components/mushaf/SurahInfoModal.tsx`
  - Surah metadata overlay, next actions, responsive layout.
- `components/mushaf/WebSelectionMenu.tsx`
  - Web text-selection copy/highlight menu, color picker, mobile Safari selection behavior.
- `components/mushaf/WordDetailSheet.tsx`
  - Word panel, tabs, meta, next/previous word, RTL, theme, custom meaning.
- `components/mushaf/WordToken.tsx`
  - Word tap/long-press, tooltip, native selection, hidden hifz word, highlights.
- `components/mushaf/WordTooltip.tsx`
  - Tooltip placement, dismissal, scrolling, theme contrast, truncation.
- `components/mushaf/ayah-tabs/HadithTab.tsx`
  - Hadith loading, unavailable QF state, list display.
- `components/mushaf/word-tabs/MeaningTab.tsx`
  - Arabic/English meaning fallback, user custom meaning display.
- `components/mushaf/word-tabs/IrabTab.tsx`
  - MASAQ grammar data, missing data state.
- `components/mushaf/word-tabs/TasreefTab.tsx`
  - Morphology data, missing data state.
- `components/mushaf/word-tabs/TajweedTab.tsx`
  - Tajweed rule colors and labels, V4 Tajweed color parity.
- `components/mushaf/word-tabs/QiraatTab.tsx`
  - Qiraat placeholder/data state, QF unavailable state.
- `components/mushaf/word-tabs/OccurrencesTab.tsx`
  - Occurrences list, root search, navigation.

### Flashcard Components

- `components/flashcards/CreateDeckSheet.tsx`
  - Deck creation, surah/juz/range scope, ayah range modal, validation, RTL.
- `components/flashcards/DeckCardsSheet.tsx`
  - Card list, filters, dropdown actions, status/state display, delete/restore behavior.
- `components/flashcards/DeckReviewSettingsSheet.tsx`
  - Mode toggles, desired retention, daily limit, persistence.
- `components/flashcards/Qcf2AyahText.tsx`
  - Flashcard Quran text, font modes, hidden/highlighted word, line fitting.
- `components/flashcards/SmartDeckFilterSheet.tsx`
  - Default deck filters, retention scope, surah/juz/ayah range selection, sync persistence.

### Notes Components

- `components/notes/PrivateNotesSection.tsx`
  - Notes list, create entry, edit entry, delete, empty state.
- `components/notes/PrivateNoteSheet.tsx`
  - Note editor, range display, save/cancel/delete, QF sync fields where visible.

### Reflections Components

- `components/reflections/ReflectionCard.tsx`
  - Author, content, ayah chip, like/comment/report menus, deleted/hidden state.
- `components/reflections/ReflectionsSection.tsx`
  - Inline ayah reflections, load more, empty state, auth gate.
- `components/reflections/WriteReflectionSheet.tsx`
  - Reflection composer, selected ayah/range preview, validation, submit.
- `components/reflections/CommentsSheet.tsx`
  - Comments list, composer, auth gate, empty/loading/error states.

### Reflection Journey Components

- `components/reflection-journey/JourneyAyahCard.tsx`
  - Journey ayah block, Quran font rendering, tafsir/translation/reflection content.

### Profile And Achievement Components

- `components/profile/ProfileAvatar.tsx`
  - Avatar image/fallback, upload/display sizing.
- `components/profile/ProfileIdentity.tsx`
  - Display name, username, RTL spacing, verified/current user states.
- `components/profile/ProfileModalContent.tsx`
  - Modal profile summary, stats, actions.
- `components/profile/ProfileNotesManager.tsx`
  - User notes/progress content, empty states.
- `components/profile/ProfileStatCard.tsx`
  - Stat display, responsive cards, RTL and number formatting.
- `components/achievements/AchievementBadge.tsx`
  - Badge locked/unlocked states.
- `components/achievements/AchievementGrid.tsx`
  - Achievement grid layout, empty/loading states.
- `components/achievements/AchievementProgressBar.tsx`
  - Badge progress, percent/label formatting.
- `components/achievements/AchievementUnlockToast.tsx`
  - Unlock toast placement and timing.
- `components/achievements/PublicBadgesGrid.tsx`
  - Public profile badges.

### Progress Components

- `components/progress/ActivityHeatmap.tsx`
  - Heatmap months, RTL behavior that should not reverse day semantics, tooltips.
- `components/progress/DefaultDeckProgressChart.tsx`
  - Default deck chart, empty/populated states, legend.
- `components/progress/SurahProgressList.tsx`
  - Surah progress, filtering, empty states, responsive layout.

### Settings Components

- `components/settings/TafsirSourcePicker.tsx`
  - Source list, download/use actions, background import, selected/importing states, RTL.
- `components/settings/TranslationLanguagePicker.tsx`
  - Language list, search, selected state, RTL languages, import state.

### Auth Components

- `components/auth/OAuthButtons.tsx`
  - OAuth buttons, provider availability, loading/error states, RTL.

### Public Page Components

- `components/public/PublicPage.tsx`
  - Public legal/about shell, nav, language/theme, content width.

### Zayt Components

- `components/zayt/ZaytPreviewModal.tsx`
  - Preview modal, loading/error, close behavior.
- `components/zayt/ZaytRivePreview.tsx`
  - Shared preview wrapper.
- `components/zayt/ZaytRivePreview.web.tsx`
  - Web Rive rendering.
- `components/zayt/ZaytRivePreview.native.tsx`
  - Native Rive rendering.
- `components/zayt/types.ts`
  - Not directly UI-testable; covered through preview modal.

## Ordered Manual Flow Checklist

Use this order for a full manual pass. For targeted changes, run the affected section plus the global regression checks at the end.

### 1. First Launch And Shell

- Fresh install or cleared browser storage opens to onboarding when onboarding is not complete.
- Returning user skips onboarding and lands on Home.
- Loading screen uses the saved language immediately without English flash in Arabic mode.
- Loading screen uses the selected UI font/theme without visible font or color jump.
- Loading progress bar appears without obsolete numeric step counts.
- Offline banner appears only when offline and does not block touch.
- Mobile bottom nav appears below 768 width.
- Desktop sidebar appears at and above 768 width.
- Hidden tab routes do not appear in visible navigation.
- Back/forward browser navigation works across tabs, hidden routes, and overlays.
- Unknown URLs show not-found UI and can return home.

### 2. Onboarding

- Step through every onboarding screen in English.
- Step through every onboarding screen in Arabic.
- Switch language during onboarding and verify layout mirrors immediately.
- Finish onboarding and verify it persists after reload.
- Verify theme/background across all onboarding screens.
- Verify safe-area spacing on phone and iPad.

### 3. Auth And Account

- Open login while signed out.
- Submit empty login form and check validation.
- Submit invalid credentials and check error copy.
- Submit valid credentials and check redirect.
- Open signup and validate username/email/password errors.
- Complete signup and check profile initialization.
- Use forgot password flow and success state.
- Use reset password route with invalid and valid tokens.
- Test OAuth button layout and disabled/error states.
- Log out and verify local reading still works.
- Reload as signed-out user and verify auth gates are stable.

### 4. Settings

- Change app language to Arabic and back to English.
- Change every theme: beige, white, dark, amoled, system, scheduled.
- Verify browser status/theme color on mobile Safari for each theme.
- Change Mushaf view mode between verse and page.
- Change Quran font mode between Classic, Modern, and Tajweed Colors.
- Change Arabic font size and verify preview uses the selected Quran font mode.
- Change page navigation between scroll and swipe.
- Verify Reading setting labels stay on the RTL start/right side with controls beside them.
- Open tafsir source select from settings.
- Select bundled tafsirs.
- Download optional tafsir and verify selector remains usable while downloading.
- Download multiple optional tafsirs sequentially without closing the modal unexpectedly.
- Open translation picker, search, choose English Bridges, choose another language.
- Change favorite reciter and verify the list is readable and compact.
- Validate account section signed out and signed in.
- Validate advanced/about/legal links.
- Reload and verify all settings persisted.
- On a second device/browser, verify syncable settings pull where expected.

### 5. Mushaf Verse Mode

- Open verse-by-verse mode at Surah 1.
- Scroll through ayahs; bottom nav/chrome behavior remains predictable.
- Verify Surah headers display correct names, ayah count, revelation type.
- Verify default translation is English Bridges in English mode.
- Verify Surah English names use Bridges-style names where expected.
- Tap ayah audio play/pause and loading state.
- Tap share/copy actions and verify copied text uses Uthmani text, not PUA glyphs.
- Add and remove bookmark from ayah card.
- Open Hadith, Qiraat, Notes, and Tafsir actions from ayah card.
- Add ayah to review and verify retention deck does not make every ayah appear already added.
- Open inline reflections and check empty/populated/auth states.
- Use text selection and WebSelectionMenu copy/highlight colors.
- Apply each highlight color and verify persisted rendering after reload.
- Remove highlight where UI allows it.
- Switch English/Arabic and verify tabs/actions are ordered correctly in RTL.

### 6. Mushaf Page Mode - Vertical Scroll

- Switch to page mode, vertical navigation.
- Verify page 1 renders with correct surah header and basmallah.
- Scroll pages 1, 2, 50, 255, 574, 604.
- Verify QCF2 page grouping uses correct page assignments.
- Verify QCF V4 and QCF V4 Tajweed render nonblank pages.
- Verify V4 Tajweed colors match word-panel tajweed colors.
- Verify line fitting on representative pages including Surah 67 and last 3 juz.
- Verify default Quran font size keeps page lines justified, while non-default sizes grow and wrap instead of shrinking.
- Verify surah headers and page separators are not clipped and use Quranic fonts where applicable.
- Tap word for tooltip.
- Tap outside and scroll to dismiss tooltip.
- Long-press/tap word to open word detail sheet.
- Open ayah marker to open ayah detail modal.
- Highlight selected Quran text and verify selection menu.

### 7. Mushaf Page Mode - Horizontal Swipe

- Switch to page mode, horizontal navigation.
- Swipe/trackpad between pages from blank page area.
- Verify page indicator updates and pages do not skip.
- Verify horizontal wheel/trackpad does not trigger while text is selected.
- Desktop: drag across Quran text and verify text selection wins over page swipe.
- Desktop: drag blank page area and verify page swipe still works.
- Phone/iPad Safari: long-press/select Quran text and verify selection handles appear.
- Phone/iPad Safari: after selection, verify Copy/Highlight menu appears.
- Phone/iPad Safari: choosing a highlight color persists the highlight.
- Verify tapping word still shows tooltip after text-selection changes.
- Verify long-press word in horizontal touch mode does not block native selection.
- Verify horizontal page mode with all Quran font modes.

### 8. Word Interaction

- Tap a word and verify tooltip text, truncation, placement, and dismissal.
- Tap another word and verify tooltip updates.
- Scroll while tooltip is visible and verify it dismisses.
- Open word detail sheet.
- Check next/previous word buttons.
- Check English meaning tab.
- Check Arabic meaning tab with real data.
- Check no-meaning fallback text.
- Edit custom word meaning and verify vocabulary card uses it.
- Check Irab tab with populated and missing data.
- Check Tasreef tab with populated and missing data.
- Check Tajweed tab colors and descriptions.
- Check Qiraat tab unavailable/data states.
- Check Occurrences tab and navigation.
- Verify word panel RTL ordering: metadata, tabs, add-to-review, navigation.
- Verify word panel themes on white, beige, dark, amoled.

### 9. Ayah Detail Panel

- Open ayah detail from verse card.
- Open ayah detail from page marker.
- Navigate next and previous ayah.
- Verify header title, subtitle, bookmark, audio, share, close.
- Check Translation tab in English and Arabic UI modes.
- Check Tafsir tab, source chips order in RTL, downloaded and bundled sources.
- Open tafsir source picker from panel and download source in background.
- Verify panel stays open or returns predictably after download.
- Check Hadith tab QF configured and unconfigured states.
- Check Qiraat tab.
- Check Notes tab create/edit/delete note.
- Check Reflections tab list/write/auth states.
- Verify nested tafsir picker overlay closes one level at a time.

### 10. Hifz And Focus Modes

- Enable hifz hide mode in page view.
- Reveal next word/ayah manually.
- Hide last revealed item.
- Reset current page reveal state.
- Start auto reveal at minimum, middle, and maximum speeds.
- Pause auto reveal.
- Enable auto-advance page and verify page transition.
- Verify hifz state is session-only where intended.
- Enter focus mode in vertical page mode.
- Verify focus controls, chrome hiding, scroll behavior, and safe-area placement.
- Exit focus mode and verify reader state remains stable.

### 11. Navigation, Search, And Deep Links

- Open Go To navigator.
- Jump by surah.
- Jump by juz.
- Jump by page.
- Search within navigator and select a result.
- Submit invalid references and verify validation.
- Use global SearchCommand from all launch points.
- Search English terms, Arabic terms, roots, and no-results terms.
- Open a search result and verify Mushaf scrolls/highlights the ayah or word.
- Use browser URL/deep link `/open?surah=2&ayah=255`.
- Use invalid deep links and verify graceful fallback.
- Verify direct route load to `/mushaf`, `/settings`, `/progress`, `/flashcards/session`.

### 12. Bookmarks, Highlights, Notes, And Copy

- Bookmark an ayah in verse mode.
- Bookmark an ayah in page mode.
- Open bookmark sheet, jump to bookmark, remove bookmark.
- Highlight full ayah from ayah action bar.
- Highlight custom word range from web selection menu.
- Highlight Bismillah/structural text where selectable.
- Verify highlights sync across reload and devices.
- Remove highlights.
- Copy selected text and verify Uthmani output format.
- Share selected ayah/range.
- Create private note from ayah detail.
- Edit private note.
- Delete private note.
- Verify notes show in profile/progress surfaces where intended.

### 13. Reflections

- Open reflection feed signed out and verify auth gate.
- Open reflection feed signed in.
- Filter by all/surah/juz where available.
- Search reflections with debounce.
- Sort reflections.
- Create reflection from ayah selection.
- Create reflection from inline ayah reflections section.
- Validate short/empty/too-long content.
- Like and unlike reflection.
- Open comments sheet.
- Add comment.
- Report reflection if action is present.
- Test offline behavior and reconnect sync.
- Open public profile from a reflection author.

### 14. Reflection Journey

- Open journey route.
- Verify journey ayah card font loading.
- Verify translation/tafsir blocks.
- Navigate through levels/steps if available.
- Test empty/error/loading states.
- Verify Arabic RTL and theme compliance.

### 15. Flashcards - Decks

- Open Flashcards tab with no custom decks.
- Verify default decks appear: new, learning, review/retention, vocabulary where applicable.
- Verify retention is a single default deck and cannot be duplicated.
- Open default deck filters.
- Filter retention by juz.
- Filter retention by full surah.
- Filter retention by ayah range inside a surah.
- Verify filters sync across devices.
- Create custom deck if the UI still supports it.
- Select surahs, juz, and ayah ranges.
- Open "Specify Ayah Range" without changing list item height.
- Validate invalid deck ranges.
- Open deck cards sheet.
- Open card dropdown actions.
- Delete card and verify it is marked deleted/synced as deleted.
- Suspend/postpone/bury/reset/schedule card where available.
- Edit second side of a card and verify session uses edited answer.
- Open deck review settings and toggle each mode.
- Change daily limits and desired retention.

### 16. Flashcards - Review Session

- Start a due review session.
- Start a session with no due cards and verify empty state.
- Review each mode: next ayah, previous ayah, translation, tafsir, first letter, surah identification, vocabulary.
- Review similar ayah tail cards and verify the answer shows only the missing tail, not a duplicate full ayah.
- Reveal answer.
- Move next/previous within card sides where applicable.
- Grade Again, Hard, Good, Easy.
- Verify Again cards enter relearning and come back before session end when due today.
- Open card options during session.
- Edit second side during session.
- Delete/suspend/postpone from session and verify session state.
- End session early.
- Complete session and verify summary fits phone without scrolling.
- Verify next review date is not stale.
- Verify session writes progress visible on Progress page.

### 17. Vocabulary

- Add word to vocabulary deck from word panel.
- Review vocabulary card first side with the word in ayah context.
- Reveal second side with ayah context.
- Verify no-meaning fallback says no meaning rather than empty card.
- Edit card meaning from card options.
- Verify edited meaning appears on second side and deck list.
- Grade vocabulary cards and verify scheduling.

### 18. Home

- Verify Home with no reviews due.
- Verify Home with due reviews.
- Verify "Move to" or recent reading page syncs across devices.
- Verify default deck summary cards.
- Verify default deck cards on phone show readable full titles/subtitles/filters without horizontal squeeze.
- Verify signed-out state.
- Verify offline state.
- Verify Arabic RTL ordering for status cards that should not reverse semantic order.

### 19. Progress

- Verify progress page with empty data.
- Verify progress page after reviews.
- Verify profile-visible progress matches progress page.
- Verify activity heatmap displays correct months/days and does not incorrectly reverse chronological meaning in RTL.
- Verify default deck progress charts show actual data.
- Verify surah progress shows tracked surahs.
- Verify stats cards for retention/reviews/wird consistency.
- Verify progress stat widgets use two cards per row on phone widths.
- Verify phone layout has no overlap or excessive horizontal scroll.

### 20. Leaderboard

- Verify signed-out auth gate.
- Verify daily tab.
- Verify weekly tab.
- Verify all-time tab.
- Verify consistency/wird tab.
- Verify empty leaderboard.
- Verify current user row highlighting.
- Verify profile navigation from leaderboard row.
- Verify offline/unavailable Supabase state.
- Verify Arabic number and RTL layout.

### 21. Profile

- Open current profile.
- Open public profile by route.
- Verify avatar fallback and loaded image.
- Verify display name and username spacing in RTL.
- Verify stats cards and badges.
- Verify notes/progress sections.
- Verify missing/deleted user state.
- Verify profile modal content on phone and desktop.

### 22. Achievements

- Verify locked badge state.
- Verify unlocked badge state.
- Verify progress bar state.
- Trigger unlock toast where possible.
- Verify public badges grid on profile.
- Verify Arabic/English labels and themes.

### 23. Public Pages

- Open About, Privacy, Terms directly.
- Verify content width on phone/tablet/desktop.
- Verify links and navigation.
- Verify Arabic and English content where available.
- Verify privacy/terms include QF/Supabase data disclosures.

### 24. Error, Empty, Loading, And Offline States

- Force offline and open every major tab.
- Verify local Quran reading still works offline.
- Verify online-only features show unavailable/auth/offline states.
- Verify skeletons and loading indicators are visible but not stuck.
- Verify empty states have actionable copy where appropriate.
- Trigger a recoverable data error where practical and verify ErrorBoundary.
- Verify toasts do not overlap bottom nav, sheets, or Safari toolbar.

### 25. Sync And Cross-Device

- Sign in on two devices or browsers.
- Change profile data on one device and verify other pulls it.
- Change settings that should sync and verify pull.
- Change theme/appearance that should stay device-specific and verify it does not incorrectly sync.
- Add bookmark and verify sync.
- Add highlight and verify sync.
- Add note and verify sync.
- Add/edit/delete card and verify sync.
- Change retention deck filters and verify sync.
- Change recent reading page and verify sync.
- Create reflection/comment/like and verify online state.
- Make local changes offline, reconnect, and verify sync queue drains.
- Create same item on two devices and verify conflict behavior is acceptable.

### 26. Accessibility And Keyboard

- Navigate primary routes with keyboard on web.
- Verify focus states are visible but not harsh on inputs.
- Verify Escape closes top-most overlay only.
- Verify Enter/Space activates buttons.
- Verify tab order in settings, search, modals, and flashcard session.
- Verify icon-only buttons have accessibility labels.
- Verify phone hit targets are usable.
- Verify text does not clip under dynamic font-size/browser zoom.

## High-Risk Regression Areas

Run these whenever the affected area changes, even for small edits.

- Quran page rendering: QCF2/V4/V4 Tajweed, page line fitting, surah headers, basmallah, page assignment.
- RTL ordering: tab rows, chip rows, sidebar/profile identity, card status order, heatmap semantics, action buttons.
- Theme compliance: ayah panel, word panel, modals/sheets, Safari toolbar/status color, white theme surfaces.
- Horizontal page mode: page swipe, text selection, trackpad wheel, phone/iPad selection.
- Word interaction: tooltip dismissal, word detail sheet, custom meanings, vocabulary flow.
- Tafsir management: settings picker, ayah panel picker, background download, selected/downloaded/importing states.
- Flashcards scheduler: Again/relearning, next review date, due-today session inclusion, deleted card sync.
- Cross-device sync: deck filters, recent reading position, bookmarks, highlights, notes, cards, settings.
- Auth/provider boundaries: direct route loads, hidden routes, session route provider, public profile.

## Quick Smoke Test

Use this for small visual changes when a full pass is not practical.

- Load app at 390 width, English, white theme.
- Load app at 412 width, Arabic, beige theme.
- Load app at 768 width, Arabic, dark theme.
- Load app at 1440 width, English, white theme.
- Open Home, Mushaf, Progress, Settings.
- Open Mushaf verse mode and page horizontal mode.
- Open one ayah panel and one word panel.
- Open SearchCommand and one settings picker.
- Start one flashcard session if due cards exist.
- Check console for errors.
- Check no blank screens, clipped Quran text, inverted RTL rows, beige leakage in white theme, or overlapping bottom chrome.
