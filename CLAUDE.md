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
- translations/*.json — 20 bundled language translations (downloaded from quran.com API)

## Current Phase

Phase 2d: Word-Level Interaction (next)

## Completed Phases

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

- 5-tab navigation: Mushaf, Search, Flashcards, Leaderboard, Settings (Lucide icons)
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
- **Custom tab bar**: `CustomTabBar` component replaces expo-router's default bottom tab bar via the `tabBar` prop. Matches DESIGN.md "Serene Path" spec: dark teal pill (`#1B4D4F`) for active tab with gold (`#FDDC91`) text/icon, 50% opacity inactive tabs, rounded top corners (40px), glassmorphism (backdrop-blur on web, higher opacity on native), teal-tinted ambient shadow, Reanimated scale-on-press (0.90), filled/outline Lucide icons for active/inactive state. Filters hidden routes via `tabBarItemStyle.display === 'none'` (expo-router's internal representation of `href: null`).

### Phase 2b Decisions

- **Vertical scrolling**: Changed from horizontal paging to vertical FlatList with page separators (Arabic page numbers). `getItemLayout` with pre-computed offsets enables instant `scrollToIndex`.
- **Line-by-line layout**: Each Mushaf page uses `page_lines` table data (15 lines/page) for precise line placement. Flexbox rows with `direction: "ltr"` + `row-reverse` for RTL, `space-between` for justified lines, `center` for centered lines.
- **Quran word container direction isolation**: All Quran word flex containers (MushafPage lines, AyahBlock word wrap) must set `direction: "ltr"` explicitly, then use `flexDirection: "row-reverse"` to achieve RTL visual order. This prevents double-reversal when the UI language is Arabic (`direction: "rtl"` on the parent layout). Without this, CSS `direction: rtl` + `flex-direction: row-reverse` = left-to-right = reversed words.
- **QCF2 font loading**: On web, bypasses expo-font and uses native FontFace API with `display: 'swap'` to avoid `font-display: auto` issue where PUA codepoints render as Arabic Presentation Form fallback glyphs. On native, uses expo-font.
- **QCF2 word-to-line mapping**: Uses authoritative per-word line assignments from quran.com API (`page-words.json`). Each page's lines get their exact QCF2 words directly — no proportional distribution needed. Fixes overflow caused by multi-glyph words (4,321 words use 2 PUA characters).
- **QCF2 page assignment (v2_page)**: 56 ayahs have different page assignments between `page_map` and QCF2 `v2_page`. Since QCF2 PUA codepoints are tied to per-page fonts, `buildPageData()` groups ayahs by `v2_page` instead of `page_map` ranges.
- **QCF2 Basmallah**: Uses page 1 font glyphs (U+FC41–FC44) for Basmallah lines. Page 1's font is preloaded alongside each page's font.
- **Font reveal**: Renders text at opacity:0 while font loads, reveals with `requestAnimationFrame` after load completes. Spinner shown while font downloads.
- **Page data building**: Load all 604 page_map rows, all 6236 ayahs, all 114 surahs, and all page_lines in parallel. Build page-grouped data in JS using ayahKey (surah * 10000 + ayah) for efficient range matching.
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

### Multi-Language Translation Decisions

- **Separate table**: `translation_active` holds only the currently selected non-English translation (6,236 rows max). English stays in existing `translations` table — zero migration risk.
- **Lazy import**: Translations imported from bundled JSON only when user selects a language (~0.8-1s). First launch unchanged.
- **Query routing**: AyahBlock checks `translationLanguage === "en"` to decide which table to query. Uses `useRef` to track fetched language and detect stale cache.
- **RTL support**: `getLanguageByCode()` provides direction info. RTL languages get `writingDirection: "rtl"` and `textAlign: "right"` on translation text.
- **Static require map**: `lib/translations/translation-requires.ts` has static `require()` calls for all 20 JSON files (Metro needs static strings).
- **API response mapping**: quran.com API returns translations in sequential verse order without `verse_key`. Script maps to surah/ayah using known ayah counts array.
- **HTML cleanup**: Download script strips `<sup>` footnotes, HTML tags, and decodes entities (`&quot;`, `&amp;`, etc.).

## Plugins

Use the frontend-design and typescript-lsp plugins for this phase.
