# CLAUDE.md

## Project

Hafiz — Quran retention app (iOS/Android/Web via Expo).
Full spec: HAFIZ_SPEC.md (always read before starting work).
Design references: design-references/ folder.

## Rules

- ALWAYS read HAFIZ_SPEC.md before starting any phase.
- Follow phases strictly. Complete one phase fully before starting the next.
- RTL is a first-class requirement. Every layout must work RTL from day one.
- Use QCF2 (KFGQPC V2) per-page fonts for ALL Quran text rendering. 604 per-page fonts with PUA glyph mapping.
- All Quran data reads come from local SQLite. Never block on network for reading features.
- Run `npx expo start --web` after every significant change and verify it works.
- Use NativeWind (Tailwind) for all styling. Avoid inline StyleSheet objects unless NativeWind can't handle it.
- Components follow shadcn/ui conventions: composable, typed props, NativeWind styling.
- Use real data from assets/data/ — never create mock or placeholder data.
- Keep bundle size in mind — the datasets are large. Use efficient SQLite imports.

## Tech Stack

- Expo (SDK 52+) + TypeScript + NativeWind
- expo-sqlite for local database
- Zustand (UI state) + TanStack Query v5 (async/server state)
- ts-fsrs for FSRS-6 spaced repetition
- React Hook Form + Zod for form validation
- Lucide React Native for icons
- Axios for HTTP requests
- FlashList for virtualized lists
- Supabase for backend (auth, sync, community features)

## Datasets (in assets/data/)

- quran-data.json — Quran text, surahs, juz, hizb, word roots
- tafseer/\*.json — Tafseer Al-Muyassar (114 files, one per surah)
- translation-sahih.json — Sahih International English translation
- page-map.json — 604-page Mushaf mapping
- wbw/ — Word-by-word English translations
- masaq/ — MASAQ إعراب dataset (grammatical analysis)
- morphology/ — Quranic corpus morphology (تصريف)
- tajweed.json — Tajweed rule annotations
- layout/page-words.json — Authoritative per-word line mapping from quran.com (83,863 words across 604 pages)
- layout/page-lines.json — Per-line word ID ranges for Mushaf layout (9,046 lines)
- translations/\*.json — 20 bundled language translations (downloaded from quran.com API)

## Current Phase

TBD (Phase 7 complete)

## Completed Phases

### Phase 7: Reflections (Community Feature)

- `@tanstack/react-query` v5 for async state management and caching
- `QueryClientProvider` wraps entire app in root `_layout.tsx` (5min stale time default)
- Supabase tables: `reflections`, `reflection_likes`, `reflection_comments`, `reports`
- RLS: reflections publicly readable (active only), writable by author; likes/comments require auth
- Database triggers: auto-update `likes_count` and `comments_count` on reflections
- Reflections API (`lib/reflections/api.ts`): CRUD for reflections, likes, comments, reports
- `ReflectionsSection` component: collapsible section below each AyahBlock (below tafseer)
  - Count badge from `fetchReflectionCount` (TanStack Query cached)
  - Paginated reflection list (5 per page) with "Load more"
  - Empty state with "Be the first to share" prompt
  - Inline "Write a reflection" button
- `ReflectionCard` component: author avatar initial, name, relative timestamp, text, like/comment buttons
  - Optimistic like toggle with rollback on error
  - Three-dot menu with Report action
- `WriteReflectionSheet`: bottom sheet with ayah preview, textarea (10-5000 chars), character count
  - Auth gate: shows login prompt if not authenticated
  - Optimistic cache invalidation on success
- `CommentsSheet`: sub-sheet for viewing/adding comments on a reflection
  - Real-time comment list, text input with send button
  - Increments comments_count optimistically
- Context menu integration: "Reflect" button in SelectionActionBar now opens WriteReflectionSheet
  - Supports single ayah and ayah range reflections
- i18n: 17 new reflection strings in both English and Arabic

### Phase 6: Authentication & Sync

- `@supabase/supabase-js` v2 for backend auth and data sync
- `zustand` v5 for auth state management (`useAuthStore`)
- `@react-native-community/netinfo` for connectivity detection
- `@react-native-async-storage/async-storage` for Supabase session persistence on native
- Supabase client in `lib/supabase.ts` with platform-aware storage adapter
- Auth store (`lib/auth/store.ts`): signIn, signUp, signOut, fetchProfile, session restoration via `onAuthStateChange`
- Login screen (`app/auth/login.tsx`): React Hook Form + Zod validation, email/password
- Signup screen (`app/auth/signup.tsx`): email, username, display_name, password with validation
- Auth routes registered in root layout with slide-from-bottom animation
- Settings account section: logged-in profile display with logout, or login/signup buttons
- Supabase SQL schema (`supabase/schema.sql`): profiles, daily_scores, study_cards, study_log, bookmarks, highlights
- RLS policies: profiles publicly readable (leaderboard), user data owner-only
- Sync queue (`lib/database/sync-queue.ts`): enqueue/dequeue/mark synced/failed/clean
- Enhanced `sync_queue` table: row_id, status (pending/synced/failed), synced_at columns
- Sync engine (`lib/database/sync.ts`): pushSyncQueue (local→Supabase), pullRemoteChanges (Supabase→local), fullSync
- Conflict resolution: last-write-wins using updated_at timestamps
- All writes to study_cards, study_log, bookmarks, highlights automatically enqueue sync entries
- `useSync` hook (`lib/sync/useSync.ts`): auto-sync on app foreground, on connectivity restore, on login
- `SyncIndicator` component: cloud icon with spinner (syncing), checkmark (synced), X (offline), alert (error)
- Floating sync indicator in tab layout (top-right corner, respects RTL)
- Database migration for existing installs: sync_queue table rebuilt with new schema
- i18n: 16 new auth/sync strings in both English and Arabic

### Phase 5: Flashcard Engine (FSRS-Powered Spaced Repetition)

- `ts-fsrs` integration with `request_retention: 0.95` (higher precision for Quran memorization)
- FSRS scheduler: `lib/fsrs/scheduler.ts` — wraps `fsrs.repeat()` with `gradeCard()` convenience helper
- Deck creation: by Surah (multi-select), Juz (1-30), Hizb (1-60), or custom range
- `CreateDeckSheet` modal with scope tabs, surah list, juz/hizb number chips, custom range inputs
- Cards generated in `study_cards` table — one row per ayah in selected scope, INSERT OR IGNORE for idempotency
- Deck metadata stored in `user_settings` as `deck_<id>` JSON entries
- Card Uniqueness Algorithm (`lib/fsrs/uniqueness.ts` per §3.6.2):
  - Checks if ayah `text_clean` is unique across entire Quran via duplicate cache
  - Prepends previous ayah(s) if not unique (up to 2 context ayahs)
  - Falls back to explicit surah name + ayah number label if still ambiguous
  - Surah name always shown subtly as secondary context
- Multi-Sided Card Flow (§3.6.3 Carousel):
  - State machine: Front → Side 1 → Side 2 → ... → Grading → Next card
  - 6 test modes: Next Ayah, Previous Ayah, Translation, Tafseer, First Letter, Surah Identification
  - Each mode toggleable in Settings (`flashcard_test_modes` persisted to `user_settings`)
  - Modes filtered per-card (e.g., no Previous Ayah for ayah 1, no Translation if missing)
  - First Letter mode: strips diacritics, shows first letter of each word with wide spacing
- Grading: 4 buttons (Again=red, Hard=orange, Good=green, Easy=blue) → `gradeCard()` → FSRS state update
- `study_cards` updated with new FSRS fields (due, stability, difficulty, state, reps, lapses, etc.)
- `study_log` records each review (card_id, rating, state, due, reviewed_at)
- Session summary screen: Trophy icon, cards reviewed, new/review/relearning breakdown, duration, next review date
- Study Dashboard (Flashcards tab):
  - Stats row: Due Today count, Day Streak (consecutive days), Last Review date
  - Start Review CTA card with gold play button (navigates to review session)
  - Deck list with card/due/new counts, per-deck Start Review and Delete buttons
  - Empty state with Create Deck button
  - Data refreshes on tab focus via `useFocusEffect`
- Review session route: `app/flashcards/session.tsx` (outside tabs, slide-from-bottom animation)
  - Wrapped in own `SettingsProvider` (since outside tab layout)
  - Progress bar with card count, card state badge (New=blue, Learning=orange, Review=green, Relearning=red)
  - Animated card reveal (spring translateY + opacity)
- 6-tab navigation: Home, Mushaf, Search, Flashcards, Progress, Settings
- Bottom tab padding reduced to 10px horizontal to fit 6 tabs
- i18n: 50+ new flashcard strings in both English and Arabic

### Phase 4: Smart Search

- Full-featured Search tab with text search and root word search modes
- 5-tab navigation: Home, Mushaf, Search, Progress, Settings
- Text search: queries `text_search` column (diacritics-stripped) via LIKE, grouped by surah
- Root search: queries `word_roots` by exact root match, grouped by lemma (derivative word)
- Highlighted matches in both modes using character-position mapping back through diacritics
- `text_search` column added to `quran_text` table — pre-stripped of Arabic diacritics (tashkeel) during import
- Migration for existing installs: ALTER TABLE + batch UPDATE to populate text_search from text_clean
- `search_history` SQLite table: last 10 searches with mode, deduplicated, most recent first
- Search history UI with recent searches, tap to re-execute, clear all button
- Debounced search (350ms) with loading indicator
- Text results: limited to 200 matches, grouped by surah with count badges
- Root results: grouped by lemma with occurrence count, expandable/collapsible
- Tap any result → `setPendingDeepLink` + navigate to Mushaf tab → scroll + pulse highlight
- Mushaf search button (header) now navigates to Search tab
- Deep link consumption upgraded from `useEffect` to `useFocusEffect` (supports both `hafiz://` and search navigation)
- `deepLinkConsumed` ref removed — `consumePendingDeepLink()` already clears state
- i18n: 14 new search strings in both English and Arabic
- `react-hook-form` + `@hookform/resolvers` installed (available for future form validation)

### Phase 3c: Deep Linking

- `hafiz://` scheme already configured in app.json (`"scheme": "hafiz"`)
- `app/open.tsx` route handles `hafiz://open?surah=X&ayah=Y` and web URLs (`/open?surah=X&ayah=Y`)
- Parses surah/ayah from query params, validates ranges, stores in module-level pending state
- `router.replace("/(tabs)/mushaf")` redirects to Mushaf tab (no back-nav to blank screen)
- `lib/deep-link.ts` — lightweight module-level state (`setPendingDeepLink` / `consumePendingDeepLink`)
- Mushaf screen consumes pending deep link after data loads, scrolls to target ayah
- Works in both verse mode (FlashList `scrollToIndex`) and page mode (`goToPageRef`)
- Pulse highlight animation: teal overlay at 15% opacity fades out over 1.5s via `Animated.timing`
- `AyahBlock` accepts `highlighted` prop for the pulse effect
- `Stack.Screen name="open"` registered in root layout
- `test-deep-link.html` — test page with native (`hafiz://`) and web (`localhost:8081`) deep links

### Phase 3b: Text Selection & Context Menu

- Tap ayah badge → selects ayah → bottom action bar with Copy/Share/Reflect/Highlight/Bookmark
- Long-press word → starts range selection → tap another word to complete (same surah only)
- Copy/Share uses `text_uthmani` (not QCF2 PUA glyphs) with formatted reference
- 4 highlight colors (Amber/Green/Blue/Pink) at 12% opacity as word backgrounds
- Highlights persisted to SQLite `highlights` table, loaded upfront into Map
- Bookmarks persisted to SQLite `bookmarks` table, shown as gold dot on ayah badge
- BookmarksSheet modal accessible from header bookmark icon — tap to navigate
- Selection mode banner shows "Tap another word to complete selection"
- SelectionProvider context wraps Mushaf, manages all selection/highlight/bookmark state
- Toast component for copy/bookmark/highlight confirmations (2s auto-dismiss)
- Page view: highlights rendered via WordToken `highlightColor` prop
- `lib/selection/` — types, queries, format, context (4 new files)
- `components/mushaf/SelectionActionBar.tsx` — bottom action bar with 5 buttons
- `components/mushaf/BookmarksSheet.tsx` — modal bookmark list with navigation
- `components/ui/Toast.tsx` — self-dismissing pill toast

### Multi-Language Translation Support

- 21 translation languages (English + 20 additional) with offline-first bundled JSON data
- Language picker modal in Settings with native script names and RTL support
- Separate `translation_active` SQLite table for non-English translations (lazy import on selection)
- English reads from existing `translations` table (instant, no import needed)
- Query routing in AyahBlock based on selected language
- RTL text alignment for Urdu, Persian, Pashto, Sindhi, Kurdish languages
- Dynamic section header shows current language name instead of hardcoded "Translation"
- Language persists across sessions via user_settings SQLite
- Re-import on app restart if translation_active is empty for saved non-English language
- Download script: `scripts/download-translations.js` (one-time, fetches from quran.com API)

### Phase 2c: Inline Content & Hide Ayahs Mode

- Collapsible Translation section below each AyahBlock (Sahih International English from translations table)
- Collapsible Tafseer section below each AyahBlock (Tafseer Al-Muyassar Arabic from tafseer table)
- On-demand SQLite fetch: translation/tafseer loaded only when section is expanded
- Global settings toggles: showTranslation and showTafseer (persisted to user_settings SQLite)
- Settings screen "Inline Content" section with Switch toggles for both
- Hide Ayahs mode: Eye/EyeOff toggle in Mushaf header
- When hidden: ayah text replaced with warm-100 placeholder box showing "Tap to reveal"
- Tap to reveal: toggles individual ayah visibility while hide mode is active
- AyahBlock wrapped in memo() for scroll performance with expanded content

### Phase 2b-QCF2: Verse-by-Verse QCF2 Integration

- AyahBlock renders QCF2 per-page fonts using text_qcf2 + v2_page per ayah
- Per-ayah font loading with opacity reveal (instant for cached fonts, async load + requestAnimationFrame for new)
- SurahHeader Bismillah uses QCF2 page 1 font PUA codepoints (\uFC41–\uFC44)
- No Bismillah stripping needed — text_qcf2 doesn't contain Bismillah prefix
- No manual ayah markers — end-of-ayah markers embedded in text_qcf2 PUA glyphs
- Surah Arabic names remain system font (metadata, not Quran text)

### Phase 2b: Mushaf — Page-Based View

- Page-based Mushaf view: 604 pages, vertical scrolling FlatList with page separators
- MushafPage component: line-by-line flexbox layout using page_lines table (15 lines/page)
- QCF2 (KFGQPC V2) font: 604 per-page fonts with Private Use Area glyph mapping (single font, no alternatives)
- Font loader: native FontFace API on web (display:'swap'), expo-font on native
- Authoritative per-word line mapping from quran.com (page-words.json) — exact glyph-to-line assignment
- Surah headers (compact mode) and Basmallah lines rendered from page_lines layout data
- View mode toggle in header: AlignJustify icon (verse) / BookOpen icon (page), persisted to user_settings
- GoToNavigator modal: "Go to Page" number input (1-604) and "Go to Surah" scrollable list (114 surahs)
- Go-to Surah in verse mode scrolls FlashList to surah header index
- Go-to Surah in page mode maps surah to first page containing it
- Font size control: 7 steps (22–46px)
- ViewMode setting added to SettingsProvider, persisted to SQLite
- page_lines table (9,046 rows): line-by-line Mushaf layout with word ID ranges
- quran_text: text_qcf2 and v2_page columns for QCF2 glyph data
- Database migration: auto-populates page_lines and QCF2 data on existing installs

### Phase 2a: Mushaf — Verse-by-Verse View

- 4-item navigation: Home, Mushaf, Progress, Settings (sidebar on desktop, bottom bar on mobile)
- Verse-by-verse Mushaf screen with FlashList (6236 ayahs + 114 surah headers)
- SurahHeader component: decorative teal card with Arabic name, English name, ayah count, revelation type, standalone Bismillah
- AyahBlock component: Arabic text with end-of-ayah number markers, RTL alignment, subtle dividers
- Bismillah stripping from first ayah of surahs 2-114 (except 9) to avoid duplication with SurahHeader
- Font size control: 7 steps (22–46px), live preview, persisted to user_settings SQLite table
- Theme switching: Light/Dark/Auto modes via NativeWind dark mode (class strategy), persisted to user_settings
- SettingsProvider context for font size and theme state management
- Settings screen with theme toggle and font size control with Arabic preview
- Placeholder screens for Search, Flashcards, Leaderboard tabs

### Phase 1: Foundation & Data Pipeline

- Expo SDK 55 project with TypeScript, expo-router, NativeWind v4, expo-sqlite
- Complete SQLite schema: 11 pre-populated tables + 6 user data tables
- First-launch import of all datasets (220K+ rows total)
- Verified table counts: surahs(114), quran_text(6236), juz_map(135), hizb_map(60), word_roots(50268), page_map(604), tafseer(6236), translations(6236), word_translations(77429), word_irab(77411), tajweed_rules(60057)
- Loading screen with progress indicator during import
- Test/verification screen confirming all data

## Architecture Notes

### Phase 1 Decisions

- **Expo SDK 55** with expo-router, NativeWind v4, expo-sqlite
- **Data import approach**: All JSON datasets loaded via `require()` at bundle time. WBW and MASAQ SQLite databases were pre-converted to JSON (`wbw/wbw.json`, `masaq/masaq-aggregated.json`) to avoid runtime multi-database complexity.
- **MASAQ aggregation**: The MASAQ dataset has multiple segments per word (prefix/stem/suffix). Aggregated to one row per (surah, ayah, word_pos) using GROUP_CONCAT for morphological_tag and syntactic_function fields. 77,411 aggregated word rows.
- **WBW HTML stripping**: The WBW database stores translations with HTML `<span>` tags for part-of-speech coloring. HTML is stripped to plain text during import. Future enhancement: preserve POS tags for color-coded word translations.
- **word_morphology table**: Schema created but not populated yet. The `morphology/morphology-terms-ar.json` file is a terminology reference (Arabic labels for POS tags), not per-word data. Per-word morphology comes from MASAQ (stored in word_irab). The mustafa0x/quran-morphology dataset would populate word_morphology when available.
- **Database provider pattern**: `DatabaseProvider` context wraps the app, handles async init with progress callbacks. Components use `useDatabase()` hook to get the SQLite instance.
- **Batch inserts**: Data imported in batches of 500 rows within transactions for performance. Uses `withTransactionAsync` (not `withExclusiveTransactionAsync`, which is unsupported on web).

### Phase 2a Decisions

- **NativeWind dark mode**: Uses `darkMode: 'class'` strategy in tailwind.config.js. NativeWind's `useColorScheme()` hook manages theme. Required `babel.config.js` with `jsxImportSource: "nativewind"` for className processing.
- **Settings persistence**: React context (`SettingsProvider`) wraps the tab layout. Reads font_size_index and theme from `user_settings` SQLite table on mount, writes on change. NativeWind `setColorScheme()` applies theme immediately.
- **Bismillah handling**: With QCF2, `text_qcf2` does NOT contain Bismillah prefix — no stripping needed. SurahHeader renders Bismillah using QCF2 page 1 PUA codepoints. (Legacy: `text_uthmani` included Bismillah prefix that required stripping.)
- **FlashList for Mushaf**: Flat list with mixed item types (`surah-header` and `ayah`) using `getItemType`. 6350 total items. `estimatedItemSize: 150`.
- **Color palette**: Warm neutrals (warm-50 to warm-900) for light mode base, Tailwind neutral for dark mode, teal accent (teal-500/600) for interactive elements and surah headers.
- **Tab layout**: SettingsProvider placed inside TabLayout (after database ready check) so it can access useDatabase().
- **Responsive navigation**: `AppNavigation` component renders as sidebar (≥768px) or bottom tab bar (<768px). 4 items: Home, Mushaf, Progress, Settings. Sidebar has "Hafiz / The Digital Sanctuary" branding. Both modes use dark teal pill (`#1B4D4F`) for active state with gold (`#FDDC91`) text/icon. Bottom bar has glassmorphism, rounded top corners (40px), Reanimated scale-on-press. Desktop content offset via `sceneStyle: { marginLeft: 220 }`. Old routes (search, flashcards, leaderboard) hidden via `href: null`.

### Phase 2b Decisions

- **Vertical scrolling**: Changed from horizontal paging to vertical FlatList with page separators (Arabic page numbers). `getItemLayout` with pre-computed offsets enables instant `scrollToIndex`.
- **Line-by-line layout**: Each Mushaf page uses `page_lines` table data (15 lines/page) for precise line placement. Flexbox rows with `direction: "ltr"` + `row-reverse` for RTL, `space-between` for justified lines, `center` for centered lines.
- **Quran word container direction isolation**: All Quran word flex containers (MushafPage lines, AyahBlock word wrap) must set `direction: "ltr"` explicitly, then use `flexDirection: "row-reverse"` to achieve RTL visual order. This prevents double-reversal when the UI language is Arabic (`direction: "rtl"` on the parent layout). Without this, CSS `direction: rtl` + `flex-direction: row-reverse` = left-to-right = reversed words.
- **QCF2 font loading**: On web, bypasses expo-font and uses native FontFace API with `display: 'swap'` to avoid `font-display: auto` issue where PUA codepoints render as Arabic Presentation Form fallback glyphs. On native, uses expo-font.
- **QCF2 word-to-line mapping**: Uses authoritative per-word line assignments from quran.com API (`page-words.json`). Each page's lines get their exact QCF2 words directly — no proportional distribution needed. Fixes overflow caused by multi-glyph words (4,321 words use 2 PUA characters).
- **QCF2 page assignment (v2_page)**: 56 ayahs have different page assignments between `page_map` and QCF2 `v2_page`. Since QCF2 PUA codepoints are tied to per-page fonts, `buildPageData()` groups ayahs by `v2_page` instead of `page_map` ranges.
- **QCF2 Basmallah**: Uses page 1 font glyphs (U+FC41–FC44) for Basmallah lines. Page 1's font is preloaded alongside each page's font.
- **Font reveal**: Renders text at opacity:0 while font loads, reveals with `requestAnimationFrame` after load completes. Spinner shown while font downloads.
- **Page data building**: Load all 604 page_map rows, all 6236 ayahs, all 114 surahs, and all page_lines in parallel. Build page-grouped data in JS using ayahKey (surah \* 10000 + ayah) for efficient range matching.
- **GoToNavigator**: Modal with tab selector. In page mode shows both Page (number input), Surah, and Juz' tabs. Surah-to-page mapping uses JOIN on `surah_start <= N AND surah_end >= N` to correctly find pages for surahs that start mid-page.
- **goToPageRef pattern**: Parent passes a mutable ref to PageMushaf; PageMushaf assigns a goToPage callback to it. Allows parent (mushaf.tsx) to trigger scrollToIndex on the FlatList from outside.

### Phase 2b-QCF2 Decisions

- **Verse-view QCF2**: AyahBlock loads per-page QCF2 font via `loadQpcFont(v2Page)`. SQL query uses `text_qcf2` and `v2_page` instead of `text_uthmani`. Each ayah's text belongs to exactly one v2_page font.
- **Font caching**: `isQpcFontLoaded()` check in useState initializer gives instant render for already-loaded fonts (common when scrolling back). New fonts load async with opacity reveal via `requestAnimationFrame`.
- **No Bismillah stripping**: `text_qcf2` doesn't include Bismillah prefix (unlike `text_uthmani`), so the raheemEnd stripping logic was removed from mushaf.tsx.
- **No manual ayah markers**: End-of-ayah markers (circled numbers) are embedded as the last PUA glyph in `text_qcf2` — removed `toArabicNumber` from AyahBlock.
- **SurahHeader Bismillah**: Uses `BISMILLAH_QCF2 = "\uFC41 \uFC42 \uFC43 \uFC44"` with page 1 font (`QCF2_001`). Font loading state independent of ayah fonts.

### Phase 2c Decisions

- **On-demand fetch**: Translation and tafseer text fetched from SQLite only when the collapsible section is first opened. Cached in component state after first load. Prevents loading 12,472 extra text rows upfront.
- **Global defaults via context**: `showTranslation` and `showTafseer` booleans in SettingsProvider. When toggled in settings, all AyahBlocks sync via useEffect on the context values.
- **Hide mode as parent state**: `hideMode` boolean lives in mushaf.tsx and is passed as prop to AyahBlock. Included in FlashList's `extraData` to trigger re-renders.
- **Placeholder instead of overlay**: Hide mode replaces the text entirely with a rounded placeholder box (`bg-warm-100 dark:bg-neutral-800`) rather than using a semi-transparent overlay. Avoids NativeWind opacity modifier limitations with custom hex colors.
- **memo(AyahBlock)**: Wrapped in React.memo to prevent unnecessary re-renders during scroll with expanded inline content.

### Phase 5 Decisions

- **ts-fsrs API**: `scheduler.repeat(card, now)` returns `IPreview` keyed by `Grade` (excludes `Rating.Manual`). `gradeCard()` helper wraps this. `Card` type has `due: Date`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`.
- **Deck metadata storage**: Decks stored as JSON in `user_settings` with key `deck_<id>`. This avoids adding a new table while keeping deck info queryable. Deck ID is deterministic from scope (e.g., `surah-1,2,3`).
- **Card ID format**: `"surah:ayah"` (e.g., `"2:255"`). INSERT OR IGNORE prevents duplicates when creating overlapping decks.
- **Uniqueness algorithm**: Builds a one-time cache of all duplicate `text_clean` values (GROUP BY HAVING COUNT > 1). For each card, checks if its text is in the cache. If duplicate, prepends prev ayah and checks if the combo exists elsewhere via JOIN. After 2 context ayahs, falls back to explicit label.
- **Test mode persistence**: `flashcard_test_modes` stored as JSON array in `user_settings`. Default: `["nextAyah", "translation", "firstLetter"]`.
- **Session route**: `app/flashcards/session.tsx` is a Stack screen outside tabs (slide-from-bottom). Wrapped in its own `SettingsProvider` since it's not a child of the tab layout.
- **Pre-fetch pattern**: All card data (text, translation, tafseer, prev/next ayah, unique front) loaded upfront when session starts. Avoids per-card SQLite queries during review.
- **FSRS card reconstruction**: StudyCardRow from SQLite → FSRSCard with `new Date(due)` and state cast. After grading, card fields are extracted back to row format with `toISOString()`.
- **6-tab navigation**: Flashcards tab added between Search and Progress. Bottom tab horizontal padding reduced from 14px to 10px. Layers icon from Lucide.

### Phase 4 Decisions

- **Diacritics stripping**: `text_clean` in the database still has diacritics (fatḥa, kasra, etc.) — only alif is standardized (ٱ→ا). Added `text_search` column with ALL diacritics stripped for LIKE searches. Regex: `[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640]`.
- **Highlight mapping**: Search matches are found in stripped text, but displayed from `text_uthmani`. A character-position mapper counts non-diacritic chars to map stripped match positions back to original text positions, including trailing diacritics in the highlight span.
- **Root search grouping**: `word_roots` query returns all occurrences, grouped by lemma in JS (not SQL GROUP BY, since we need per-occurrence data for display). Sorted by occurrence count descending.
- **Navigation from search**: Reuses the deep link mechanism (`setPendingDeepLink` + `router.navigate`). Mushaf's `useFocusEffect` consumes the pending target on tab focus. This unified approach supports both `hafiz://` deep links and in-app search navigation.
- **Debounced search**: 350ms debounce on text input change. Prevents excessive SQLite queries during typing.
- **Search history**: Simple SQLite table with deduplication (DELETE then INSERT). Capped at 10 entries via DELETE of overflow rows. Re-search on tap.
- **5-tab layout**: Bottom tab padding reduced from 20px to 14px horizontal to fit 5 tabs. Sidebar (desktop) already handled variable tab counts via flexbox.
- **Result limits**: Text search limited to 200 results via SQL LIMIT. Root search fetches all (typically < 500 for any root).

### Phase 3c Decisions

- **Route-based deep linking**: `app/open.tsx` handles the `/open` path. Expo Router maps both `hafiz://open?...` (native scheme) and `/open?...` (web) to this route automatically.
- **Module-level state transfer**: `lib/deep-link.ts` uses a simple module-level variable (not context/store) to pass the deep link target from the `/open` route to the Mushaf screen. Avoids context dependency on a route that renders outside the tab layout.
- **`router.replace()`**: Uses replace instead of push so the blank `/open` screen doesn't appear in the back stack.
- **Consume-once pattern**: `consumePendingDeepLink()` reads and clears the pending target. `deepLinkConsumed` ref prevents re-consumption on re-renders.
- **Pulse animation**: `Animated.timing` from 1→0 over 1.5s on a teal overlay at 15% max opacity. Uses `useNativeDriver: true` for smooth animation. The overlay is conditionally rendered only when `highlighted` is true.
- **Delayed scroll**: 100ms `setTimeout` before `scrollToIndex` to ensure FlashList/FlatList is mounted and ready after data loads.

### Multi-Language Translation Decisions

- **Separate table**: `translation_active` holds only the currently selected non-English translation (6,236 rows max). English stays in existing `translations` table — zero migration risk.
- **Lazy import**: Translations imported from bundled JSON only when user selects a language (~0.8-1s). First launch unchanged.
- **Query routing**: AyahBlock checks `translationLanguage === "en"` to decide which table to query. Uses `useRef` to track fetched language and detect stale cache.
- **RTL support**: `getLanguageByCode()` provides direction info. RTL languages get `writingDirection: "rtl"` and `textAlign: "right"` on translation text.
- **Static require map**: `lib/translations/translation-requires.ts` has static `require()` calls for all 20 JSON files (Metro needs static strings).
- **API response mapping**: quran.com API returns translations in sequential verse order without `verse_key`. Script maps to surah/ayah using known ayah counts array.
- **HTML cleanup**: Download script strips `<sup>` footnotes, HTML tags, and decodes entities (`&quot;`, `&amp;`, etc.).

### Fi Zilal al-Quran Integration

- **Multi-source tafseer**: `tafseer` table has `source` column (`'muyassar'` or `'zilal'`), composite PK on `(surah, ayah, source)`. ~12,472 rows total.
- **Database migration**: For existing installs, init.ts detects missing `source` column via `SELECT source FROM tafseer LIMIT 1` try/catch. Migrates by creating `tafseer_new`, copying data with `source='muyassar'`, dropping old table, renaming.
- **Zilal import**: `zilal.json` (17MB) bundled in `assets/data/`. Imported during first-launch and as migration for existing installs. Skips empty tafsir entries.
- **Tafseer source setting**: `tafseerSource` in SettingsProvider (`'muyassar'` default), persisted to `user_settings` as `tafseer_source`.
- **AyahBlock query**: Uses `WHERE source = ?` parameter, tracks source changes via `fetchedSourceRef` (same pattern as translation language).
- **Long text truncation**: Zilal texts are much longer than Muyassar. AyahBlock truncates to 200 chars with "Read more" expansion.
- **Settings UI**: Two-option card selector under Inline Content section, Arabic names with descriptions.

### Phase 7 Decisions

- **TanStack Query for reflections**: First use of TanStack Query in the app. `QueryClientProvider` wraps the entire app at the root layout level (above `DatabaseProvider`). Used for fetching/caching reflections data from Supabase. Local SQLite queries still use direct `useEffect` patterns.
- **Reflection count caching**: Each AyahBlock independently queries its reflection count with `queryKey: ["reflectionCount", surah, ayah]`. 5-minute stale time prevents excessive Supabase calls during scroll.
- **Pagination strategy**: Fetches PAGE_SIZE + 1 rows from Supabase to determine `hasMore`. Trims to PAGE_SIZE for display. Subsequent pages append to local state array.
- **Like optimism**: Like toggle updates local state immediately, then calls Supabase. On error, reverts both the liked flag and count. The Supabase trigger updates the server-side `likes_count` atomically.
- **Comment count sync**: When a comment is added, the local `allReflections` array is updated optimistically (incrementing `comments_count`). The Supabase trigger handles the server-side count.
- **User like detection**: After fetching reflections, a second query checks `reflection_likes` for the current user's likes across all fetched reflection IDs. Sets `user_has_liked` flag on each reflection.
- **Auth gate pattern**: `WriteReflectionSheet` checks `useAuthStore` user state. If null, shows a login CTA that navigates to `/auth/login`. This avoids wrapping community features in an auth-only route.
- **Context menu → sheet**: The SelectionActionBar "Reflect" button now opens `WriteReflectionSheet` as a second modal (not nested). The selection sheet stays mounted but the write sheet overlays it.
- **Reports table**: Simple `reports` table with `reporter_id`, `reflection_id`, `reason`. RLS allows insert for authenticated users and read only own reports. Moderation UI is out of scope for this phase.

### Phase 6 Decisions

- **Zustand for auth state**: First use of Zustand in the app. `useAuthStore` is a single global store (no provider needed) for session, user, profile, isLoading, error. All other state management still uses React Context.
- **Supabase client storage**: On web, uses default `localStorage`. On native, uses `@react-native-async-storage/async-storage` for session persistence. Platform check via `Platform.OS !== "web"`.
- **Auth initialization**: `useAuthStore.initialize()` called in root `_layout.tsx` on mount. Restores session, subscribes to `onAuthStateChange`. Profile fetched in background after session restore.
- **isSupabaseConfigured()**: Guard function checks if placeholder credentials are replaced. When not configured, auth UI shows "Cloud sync not configured" and sync is skipped. App works fully offline.
- **Sync queue pattern**: Writes to syncable tables (study_cards, study_log, bookmarks, highlights) call `enqueueSync()` after the local SQLite write. Non-blocking `.catch(console.warn)` — sync failures never break local operations.
- **Push sync**: Groups pending entries by table, upserts to Supabase with `user_id`. study_log is append-only (INSERT only, no upsert). Deletes use table-specific key parsing (e.g., bookmarks use `surah:ayah`).
- **Pull sync**: Fetches remote rows newer than `last_pull_at` (stored in user_settings). Last-write-wins for study_cards (compares `updated_at`). study_log deduplicates by `card_id + reviewed_at`.
- **useSync hook**: Runs in tab layout. Listens to AppState changes (foreground) and NetInfo connectivity events. Syncs automatically when conditions are met. Never blocks UI.
- **SyncIndicator**: Floating overlay in tab layout, positioned top-right (top-left in RTL). Uses `pointerEvents="none"` so it doesn't intercept touches. Shows for 3s after successful sync, then fades to idle.
- **Sync queue migration**: For existing installs, detects old schema via `SELECT row_id` try/catch. Drops and recreates the table (no user data to preserve — pending entries are just sync metadata).
- **Auth screens**: Stack screens outside tabs with slide-from-bottom animation. Use `router.replace()` between login/signup to avoid deep back stack. `router.back()` on successful auth returns to settings.

## Plugins

Use the frontend-design and typescript-lsp plugins for this phase.
