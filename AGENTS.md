# AGENTS.md — Hafiz (Codex Edition)

## Project

**Hafiz** — Quran retention app (iOS / Android / Web via Expo).
Full spec lives in `HAFIZ_SPEC.md`. Read it before starting non-trivial work.

---

## Workflow Rules (Hard Rules)

- **Commit and push to `main` after every change.** The live site deploys from `main`, so unpushed commits are invisible to users. After each edit: `git commit` then `git push origin main` immediately — no extra confirmation needed for normal pushes.
- **Destructive ops still need confirmation**: `reset --hard`, `push --force`, branch deletion, `rm -rf`, dropping tables, force-overwriting uncommitted work.
- **No mock data, ever.** Pull real data from `assets/data/`.
- **All user-facing strings are bilingual (en + ar).** nothing should be missing between ar/en modes switches.
- **RTL is first-class.** Every layout must work in RTL. See "Key Gotchas" below.
- **QCF2 (KFGQPC V2) per-page fonts for ALL Quran text.** 604 fonts with PUA glyph mapping. Never use system Arabic fonts for Quran text. Clean Arabic UI font is fine for non-Quran Arabic (tafseer body, UI labels).
- **All Quran data reads from local SQLite.** Never block on network for reading features.
- **NativeWind (Tailwind) only.** Avoid inline `StyleSheet` unless NativeWind genuinely can't handle it.
- **Sync writes never block local ops.** All `enqueueSync()` calls must be `.catch(console.warn)`.

---

## Tech Stack

- Expo SDK 55 + TypeScript + NativeWind v4 (`darkMode: 'class'`)
- expo-sqlite (local DB) + expo-font (QCF2 fonts)
- Zustand v5 (auth state only) + TanStack Query v5 (Supabase async state)
- ts-fsrs (FSRS-6 spaced repetition, `request_retention: 0.95`)
- React Hook Form + Zod, Lucide React Native, Axios, FlashList
- Supabase (auth, sync, reflections, leaderboard)

---

## Architecture Summary

### Data Layer

- **Pre-populated SQLite**: surahs, quran_text (with `text_uthmani`, `text_qcf2`, `text_clean`, `text_search`, `v2_page`), juz_map, hizb_map, word_roots, page_map, page_lines, tafseer (multi-source: muyassar/zilal), translations, translation_active (non-English), word_translations, word_irab (MASAQ), tajweed_rules.
- **User SQLite**: study_cards, study_log, bookmarks, highlights, user_settings, sync_queue.
- `DatabaseProvider` wraps the app; components consume `useDatabase()`.
- `SettingsProvider` manages font size, theme, view mode, tafseer source, translation language, test modes — persists to `user_settings`.
- Batch inserts use `withTransactionAsync` in transactions of **500 rows**.

### Mushaf

- **Verse-by-verse**: FlashList over 6,350 items (6,236 ayahs + 114 surah headers); `getItemType` distinguishes them.
- **Page-based**: vertical FlatList over 604 pages, line-by-line flexbox from `page_lines` (15 lines/page); `getItemLayout` with pre-computed offsets.
- **QCF2 fonts**: web uses native FontFace API (`display: 'swap'`), native uses expo-font. Loaded per-page with opacity reveal via `requestAnimationFrame`.
- **QCF2 page assignment**: group ayahs by `v2_page` (NOT `page_map` — 56 ayahs differ). Basmallah uses page-1 PUA glyphs `ﱁ–ﱄ`.
- `text_qcf2` has no Bismillah prefix and embeds end-of-ayah markers as PUA glyphs.
- **Deep linking**: `lib/deep-link.ts` holds module-level state. `app/open.tsx` route → `setPendingDeepLink` → Mushaf consumes via `useFocusEffect`.

### Word Interaction

- Each word is a pressable `WordToken`. Tap → inline English tooltip. Long-press → bottom sheet with 7 tabs (English, المعنى, إعراب, تصريف, تجويد, قراءات, Occurrences).
- Selection: tap badge → select ayah; long-press → range. `SelectionProvider` owns state.
- Context menu: Copy, Share, Reflect, Highlight (4 colors), Bookmark.

### Tafseer

- Multi-source: `tafseer` table has a `source` column (PK: surah, ayah, source). Values: `'muyassar'`, `'zilal'`.
- Zilal texts are truncated to 200 chars with "Read more"; source attribution shown for zilal.
- `tafseerSource` setting persisted; defaults to `'muyassar'`.

### Translations

- 21 languages. English in `translations` table; others lazy-imported into `translation_active`.
- Static require map: `lib/translations/translation-requires.ts`.
- RTL support for Urdu, Persian, Pashto, Sindhi, Kurdish.

### Flashcards (FSRS)

- Card ID: `"surah:ayah"`. Deck metadata in `user_settings` as `deck_<id>` JSON.
- Uniqueness algorithm checks duplicate `text_clean`; prepends context ayahs.
- 6 test modes, toggleable. Session route lives outside tabs with its own `SettingsProvider`.
- All card data pre-fetched upfront at session start.

### Auth & Sync

- Zustand `useAuthStore`. Supabase client with platform-aware storage.
- `isSupabaseConfigured()` guards everything — app works fully offline if Supabase isn't configured.
- Sync queue: writes to syncable tables auto-enqueue via `enqueueSync()`. Non-blocking.
- Push: groups by table, upserts. Pull: last-write-wins via `updated_at`.
- `useSync` hook in tab layout: syncs on foreground + connectivity restore.

### Community

- Reflections: TanStack Query for Supabase CRUD, optimistic likes with rollback, paginated 5/page.
- Auth gate: shows login CTA if unauthenticated.
- Leaderboard: 4 tabs (Daily / Weekly / All-time / Streak). Scoring in `lib/fsrs/scoring.ts`. Weekly aggregated client-side.

### UI Patterns

- Skeleton loaders: `usePulse()` hook, opacity 0.3 ↔ 0.7.
- Haptics: `lib/haptics.ts` wrapper with platform guard + silent catch.
- `EmptyState`: icon + title + subtitle + optional action.
- `ErrorBoundary`: class component + `withErrorBoundary()` HOC.
- `OfflineBanner`: NetInfo-based, animated, `pointerEvents="none"`.
- Toast: self-dismissing 2s pill.
- Onboarding: 3 screens, gated by `user_settings.onboarding_completed`.

### Navigation

- 6 tabs: Home, Mushaf, Leaderboard, Search, Flashcards, Progress, Settings (sidebar on desktop ≥ 768px, bottom bar on mobile).
- Glassmorphism bottom bar; teal active pill with gold icon/text.

---

## Datasets (`assets/data/`)

`quran-data.json`, `tafseer/*.json` (Al-Muyassar), `zilal.json` (Fi Zilal), `translation-sahih.json`, `page-map.json`, `tajweed.json`, `wbw/wbw.json`, `masaq/masaq-aggregated.json`, `layout/page-words.json`, `layout/page-lines.json`, `translations/*.json` (20 languages).

---

## Key Gotchas

1. **QCF2 direction bug** — Quran word containers MUST set `direction: "ltr"` + `flexDirection: "row-reverse"`. Without this, Arabic UI direction causes double-reversal.
2. **`text_qcf2` vs `text_uthmani`** — Copy/Share use `text_uthmani` (real Unicode). QCF2 PUA glyphs are display-only.
3. **`v2_page` vs `page_map`** — 56 ayahs differ. Always use `v2_page` for QCF2 rendering.
4. **Web font loading** — Must use the native `FontFace` API, not expo-font, to get `display: 'swap'` on QCF2.
5. **Session route** — `app/flashcards/session.tsx` is outside tabs and needs its own `SettingsProvider`.
6. **Sync never blocks** — every `enqueueSync` is `.catch(console.warn)`. Sync failures must never break local ops.
7. **MASAQ aggregation** — multiple segments per word aggregated into one row via `GROUP_CONCAT`.
8. **Onboarding gate** — `app/(tabs)/index.tsx` reads `user_settings` and `router.replace()`s to `/onboarding` or `/home`.

---

## Codex Slash Commands (`.codex/prompts/`)

These are project-shipped prompts. Install them into `~/.codex/prompts/` with `bash setup-codex.sh` (or symlink the directory). Once installed, invoke from the Codex CLI with `/<name> [args]`.

| Command                               | Purpose                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/feature <description>`              | Add a new feature, following Hafiz patterns.                                                                            |
| `/fix <bug description>`              | Investigate, fix, and verify a bug end-to-end.                                                                          |
| `/audit`                              | Run the full quality sweep: i18n, RTL, dark mode, build size, dependency audit.                                         |
| `/deploy`                             | Build the web export, commit, and push to `main` so Vercel deploys.                                                     |
| `/scrape-tafsir <slug> [arabic-name]` | Scrape a tafsir from `quran-tafsir.net` and produce import-ready JSON.                                                  |
| `/review`                             | Run the Hafiz code review checklist over staged/recent changes. (Replaces the `hafiz-reviewer` subagent.)               |
| `/data-explorer <file>`               | Inspect a Quran dataset for coverage, quality, and import compatibility. (Replaces the `hafiz-data-explorer` subagent.) |

---

## Codex Reference Skills (`.codex/skills/`)

These are **on-demand reference docs**. **read the corresponding file** before acting:

| Skill                  | When to read                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| `add-dataset.md`       | Importing a new Quran dataset (tafsir, translation, word data).  |
| `build-and-test.md`    | Running the web build and validating bundle size / OOM risks.    |
| `i18n-check.md`        | Auditing for missing en/ar translations or hardcoded UI strings. |
| `rtl-audit.md`         | Checking RTL layout and dark mode coverage.                      |
| `scrape-quran-data.md` | Building a Python scraper for a Quran data source.               |

If the user invokes `/audit` it triggers a sweep that reads several of these in turn.

---

## Conventions Codex Should Follow

- **Be terse.** State what you're doing in one sentence, then act. End-of-turn summary is one or two sentences max.
- **Prefer editing over creating.** Don't spawn new files when an existing module fits.
- **Comments**: default to none. Only add when the _why_ is non-obvious (hidden constraint, surprising invariant, workaround for a known bug). Never describe what the code does — names should do that.
- **No speculative abstractions.** Three similar lines beat a premature helper. Don't add error handling for impossible states; trust internal callers, validate only at system boundaries.
- **Reference code with `path:line`** so the user can jump straight there.
- **Run `npx expo start --web`** (or `npx expo export --platform web`) before claiming a UI change is done. Type-check ≠ feature-correct.
- **Memory / persistence**: Treat each session as cold; rely on `AGENTS.md`, the spec, and the codebase. If the user wants something durable, write it into `AGENTS.md` or `HAFIZ_SPEC.md`.
