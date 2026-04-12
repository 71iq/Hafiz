# CLAUDE.md

## Project

Hafiz — Quran retention app (iOS/Android/Web via Expo). All 9 phases complete.
Full spec: HAFIZ_SPEC.md (read before starting any work).

## Workflow

- **Commit and push to `main` after every change.** The live site deploys from `main`, so unpushed commits are invisible to users. After each edit, `git commit` then `git push origin main` immediately — no confirmation needed for normal pushes. Destructive ops (`reset --hard`, `push --force`, branch deletion) still require confirmation.

## Rules

- RTL is first-class. Every layout must work RTL. Quran word containers use `direction: "ltr"` + `flexDirection: "row-reverse"` to avoid double-reversal when UI language is Arabic.
- QCF2 (KFGQPC V2) per-page fonts for ALL Quran text. 604 fonts with PUA glyph mapping. Never use system Arabic fonts for Quran text.
- Clean Arabic UI font (not QCF2) for non-Quran Arabic text (tafseer, UI labels, etc.).
- All Quran data reads from local SQLite. Never block on network for reading features.
- NativeWind (Tailwind) for all styling. Avoid inline StyleSheet unless NativeWind can't handle it.
- Use real data from assets/data/ — never create mock data.
- i18n: all user-facing strings must have both English and Arabic entries.

## Tech Stack

- Expo SDK 55 + TypeScript + NativeWind v4 (darkMode: 'class')
- expo-sqlite (local DB) + expo-font (QCF2 fonts)
- Zustand v5 (auth state only) + TanStack Query v5 (Supabase async state)
- ts-fsrs (FSRS-6 spaced repetition, request_retention: 0.95)
- React Hook Form + Zod, Lucide React Native, Axios, FlashList
- Supabase (auth, sync, reflections, leaderboard)

## Architecture

### Data Layer

- **SQLite tables (pre-populated):** surahs, quran_text (has text_uthmani, text_qcf2, text_clean, text_search, v2_page), juz_map, hizb_map, word_roots, page_map, page_lines, tafseer (multi-source: muyassar/zilal), translations, translation_active (non-English), word_translations, word_irab (MASAQ), tajweed_rules
- **SQLite tables (user data):** study_cards, study_log, bookmarks, highlights, user_settings, sync_queue
- **DatabaseProvider** context wraps app, async init with progress callbacks. Components use `useDatabase()` hook.
- **SettingsProvider** context manages font size, theme, view mode, tafseer source, translation language, test modes. Persists to user_settings SQLite.
- **Batch inserts** in transactions of 500 rows. Uses `withTransactionAsync`.

### Mushaf

- **Verse-by-verse:** FlashList with 6350 items (6236 ayahs + 114 surah headers). `getItemType` distinguishes them.
- **Page-based:** Vertical FlatList, 604 pages. Line-by-line flexbox from page_lines table (15 lines/page). `getItemLayout` with pre-computed offsets.
- **QCF2 fonts:** Web uses native FontFace API (`display:'swap'`), native uses expo-font. Font loaded per-page with opacity reveal via requestAnimationFrame.
- **QCF2 page assignment:** Groups ayahs by `v2_page` (not page_map) since 56 ayahs differ. Basmallah uses page 1 font PUA codepoints (U+FC41–FC44).
- **text_qcf2** has no Bismillah prefix and includes end-of-ayah markers as PUA glyphs.
- **Deep linking:** `lib/deep-link.ts` module-level state. `app/open.tsx` route → `setPendingDeepLink` → Mushaf consumes via `useFocusEffect`.

### Word Interaction

- Each word is a pressable WordToken. Tap → inline English tooltip. Long-press → bottom sheet with 7 tabs (English, المعنى, إعراب, تصريف, تجويد, قراءات placeholder, Occurrences).
- Selection: tap badge → select ayah, long-press → range selection. SelectionProvider manages state.
- Context menu: Copy, Share, Reflect, Highlight (4 colors), Bookmark.

### Tafseer

- Multi-source: `tafseer` table has `source` column (PK: surah, ayah, source). Values: `'muyassar'`, `'zilal'`.
- Zilal texts truncated to 200 chars with "Read more". Source attribution shown for zilal.
- `tafseerSource` setting persisted, defaults to `'muyassar'`.

### Translations

- 21 languages. English in `translations` table, others lazy-imported into `translation_active` table.
- Static require map in `lib/translations/translation-requires.ts`.
- RTL support for Urdu, Persian, Pashto, Sindhi, Kurdish.

### Flashcards (FSRS)

- Card ID: `"surah:ayah"`. Deck metadata in user*settings as `deck*<id>` JSON.
- Uniqueness algorithm checks duplicate text_clean, prepends context ayahs.
- 6 test modes, toggleable. Session route outside tabs with own SettingsProvider.
- Pre-fetches all card data upfront at session start.

### Auth & Sync

- Zustand `useAuthStore` for auth state. Supabase client with platform-aware storage.
- `isSupabaseConfigured()` guard — app works fully offline if not configured.
- Sync queue: writes to syncable tables auto-enqueue via `enqueueSync()`. Non-blocking.
- Push: groups by table, upserts to Supabase. Pull: last-write-wins via updated_at.
- `useSync` hook in tab layout: syncs on foreground + connectivity restore.

### Community

- Reflections: TanStack Query for Supabase CRUD. Optimistic likes with rollback. Paginated (5/page).
- Auth gate: checks useAuthStore, shows login CTA if unauthenticated.
- Leaderboard: 4 tabs (Daily/Weekly/All-time/Streak). Scoring in `lib/fsrs/scoring.ts`. Weekly aggregated client-side.

### UI Patterns

- Skeleton loaders: `usePulse()` hook, opacity 0.3↔0.7.
- Haptics: `lib/haptics.ts` wrapper with platform guard + silent catch.
- EmptyState: icon + title + subtitle + optional action.
- ErrorBoundary: class component + `withErrorBoundary()` HOC.
- OfflineBanner: NetInfo-based, animated slide-in/out, pointerEvents="none".
- Toast: self-dismissing 2s pill.
- Onboarding: 3 screens, shows once (user_settings `onboarding_completed`).

### Navigation

- 6 tabs: Home, Mushaf, Leaderboard, Search, Flashcards, Progress, Settings (sidebar on desktop ≥768px, bottom bar on mobile).
- Glassmorphism bottom bar, teal active pill with gold icon/text.

## Datasets (assets/data/)

quran-data.json, tafseer/_.json (Al-Muyassar), zilal.json (Fi Zilal), translation-sahih.json, page-map.json, tajweed.json, wbw/wbw.json, masaq/masaq-aggregated.json, layout/page-words.json, layout/page-lines.json, translations/_.json (20 languages)

## Key Gotchas

1. **QCF2 direction bug:** Quran word containers MUST use `direction: "ltr"` + `row-reverse`. Without this, Arabic UI direction causes double-reversal.
2. **text_qcf2 vs text_uthmani:** Copy/Share uses text_uthmani (real Unicode). QCF2 PUA glyphs are display-only.
3. **v2_page vs page_map:** 56 ayahs differ. Always use v2_page for QCF2 rendering.
4. **Font loading on web:** Must use native FontFace API, not expo-font, to get `display:'swap'`.
5. **Session route:** `app/flashcards/session.tsx` is outside tabs — needs own SettingsProvider.
6. **Sync never blocks:** All enqueueSync calls use `.catch(console.warn)`. Sync failures never break local ops.
7. **MASAQ aggregation:** Multiple segments per word aggregated to one row via GROUP_CONCAT.
8. **Onboarding gate:** `app/(tabs)/index.tsx` checks user_settings and redirects. Uses `router.replace()`.

## Plugins

Use frontend-design and typescript-lsp plugins.
