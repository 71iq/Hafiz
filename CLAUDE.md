# CLAUDE.md

## Project

Hafiz — Quran retention app (iOS/Android/Web via Expo).
Full spec: HAFIZ_SPEC.md (always read before starting work).
Design references: design-references/ folder.

## Rules

- ALWAYS read HAFIZ_SPEC.md before starting any phase.
- Follow phases strictly. Complete one phase fully before starting the next.
- RTL is a first-class requirement. Every layout must work RTL from day one.
- Use UthmanicHafs font for ALL Quran text. Never use system Arabic fonts for Quran rendering.
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

## Current Phase

Phase 2b: Mushaf — Enhanced Reading (next)

## Completed Phases

### Phase 2a: Mushaf — Verse-by-Verse View

- 5-tab navigation: Mushaf, Search, Flashcards, Leaderboard, Settings (Lucide icons)
- Verse-by-verse Mushaf screen with FlashList (6236 ayahs + 114 surah headers)
- SurahHeader component: decorative teal card with Arabic name (UthmanicHafs), English name, ayah count, revelation type, standalone Bismillah
- AyahBlock component: Arabic text in UthmanicHafs, end-of-ayah number markers (﴿٢﴾), RTL alignment, subtle dividers
- Bismillah stripping from first ayah of surahs 2-114 (except 9) to avoid duplication with SurahHeader
- Font size control: 5 steps (22–38px), live preview, persisted to user_settings SQLite table
- Theme switching: Light/Dark/Auto modes via NativeWind dark mode (class strategy), persisted to user_settings
- SettingsProvider context for font size and theme state management
- Settings screen with theme toggle and font size control with Arabic preview
- Placeholder screens for Search, Flashcards, Leaderboard tabs

### Phase 1: Foundation & Data Pipeline

- Expo SDK 55 project with TypeScript, expo-router, NativeWind v4, expo-sqlite
- UthmanicHafs font bundled and loading correctly
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
- **Bismillah handling**: Database `text_uthmani` for ayah 1 of surahs 2-114 (except 9) includes the Bismillah prefix. Stripped at display time using Unicode-escape-based `indexOf` search for "ٱلرَّحِيمِ" end marker. SurahHeader renders a standalone decorative Bismillah instead.
- **FlashList for Mushaf**: Flat list with mixed item types (`surah-header` and `ayah`) using `getItemType`. 6350 total items. `estimatedItemSize: 150`.
- **Color palette**: Warm neutrals (warm-50 to warm-900) for light mode base, Tailwind neutral for dark mode, teal accent (teal-500/600) for interactive elements and surah headers.
- **Tab layout**: SettingsProvider placed inside TabLayout (after database ready check) so it can access useDatabase().

## Plugins

Use the frontend-design and typescript-lsp plugins for this phase.
