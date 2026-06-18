# AGENTS.md — Hafiz

## Project

**Hafiz** — Quran retention app (iOS / Android / Web via Expo). Mushaf reader, reflection tools, word study, tafsir, translations, notes, FSRS review, and optional Supabase sync.

---

## Developer commands

Default verification path is `npm run typecheck` plus targeted unit/static checks. Do not start Metro/dev servers unless explicitly asked for live visual testing.

Quick checks:

- `npm run typecheck` — first gate.
- `npm run test:unit` — Jest contract tests (`--runInBand`).
- `npm run test:e2e:smoke` — builds web, then Playwright smoke routes.
- `npm run verify:quick` — `typecheck` + `test:unit` + `test:e2e:smoke`.

Build / data:

- `npm run build:web` — static export to `dist/`. Automatically runs `prebuild:web` (`scripts/prepare-web-data.sh`) which copies runtime JSON to `public/data/`.
- `npm run build:db` — regenerates `assets/data/quran.db` from JSON/schema.
- `npm run validate:reflection-journey` — validates `assets/data/reflection-journey.json`.

Focused / report-only Playwright suites:

- `npm run test:ui:phase -- <provider-boundaries|responsive-overflow|route-inventory|rtl-ui-contract|sync-contract|ui-contract|all>`
- `npm run test:ui:baseline` — all report-only checks + summary JSON.
- `npm run test:ui:rtl` — RTL UI contract only.

Formatting:

- `npm run lint` — eslint.
- `npm run format` — prettier (`printWidth: 120`, `trailingComma: all`).

---

## Workflow rules

- **Commit and push to `main` after every change.** After each edit: `git commit` then `git push origin main` immediately — no extra confirmation needed for normal pushes.
- **Destructive ops still need confirmation**: `reset --hard`, `push --force`, branch deletion, `rm -rf`, dropping tables, force-overwriting uncommitted work.
- **No mock data, ever.** Pull real data from `assets/data/`.
- **All user-facing strings are bilingual (en + ar).** `tests/unit/i18n-strings.test.ts` enforces key parity and non-empty values.
- **RTL is first-class.** Every layout must work in RTL; see `tests/rtl/` and `tests/unit/rtl-*`.
- **Quran text uses bundled Quran page fonts.** Default QPC V4; optional QPC V4 Tajweed. Never system Arabic fonts for Quran text.
- **All Quran data reads from local SQLite.** Never block on network for reading features.
- **NativeWind (Tailwind) only.** Avoid inline `StyleSheet`.
- **Sync writes never block local ops.** All `enqueueSync()` calls must be `.catch(console.warn)`.

---

## Tech stack

- Expo SDK 55 + React Native 0.83 + React 19 + TypeScript 5.9.
- Expo Router file-based routes; root layout at `app/_layout.tsx`.
- NativeWind v4 (`darkMode: 'class'`), Babel preset `babel-preset-expo` with `{ jsxImportSource: "nativewind" }`.
- `expo-sqlite` local DB + `expo-font`.
- Zustand v5 (auth only) + TanStack Query v5 (Supabase async state).
- `ts-fsrs` FSRS-6 (`request_retention: 0.95`).
- Supabase auth, sync, reflections, leaderboard.
- Playwright e2e + Jest unit tests.

---

## Architecture

### Entry and routing

- `main`: `expo-router/entry`.
- Root layout (`app/_layout.tsx`): `QueryClientProvider > DatabaseProvider > AudioProviderBoundary`.
- Onboarding gate lives in `app/(tabs)/index.tsx` (reads `user_settings.onboarding_completed`, routes to `/onboarding` or `/home`).
- `app/flashcards/session.tsx` is outside tabs and must wrap itself with its own `SettingsProvider`.
- `/qa-ready` is the Playwright gate: wait for `QA_READY` text before navigating.

### Data layer

- Pre-populated DB source of truth: `assets/data/quran.db`, built by `scripts/build-quran-db.mjs` from `lib/database/schema.ts` + JSON datasets.
- Platform-split loading: native uses static `require()` maps in `lib/database/init.ts`; web fetches from `/data/*` served out of `public/data/` (populated by `scripts/prepare-web-data.sh`).
- Adding a new lazy-loaded runtime asset requires: (1) a native require-map entry in `init.ts`, (2) a copy step in `prepare-web-data.sh`, and (3) a shared load path.
- On web, `DatabaseProvider` uses OPFS + `BroadcastChannel` to host the SQLite DB in one tab and proxy requests from other tabs. Keep Playwright smoke tests in one page context or re-enter via `/qa-ready`.
- Batch writes use `withTransactionAsync`; default runtime batch is 500 rows.
- Sync queue: writes to syncable tables call `enqueueSync()`; push groups by table and upserts; pull is last-write-wins via `updated_at`.

### Mushaf

- Verse view: FlashList over ~6,350 items (ayahs + 114 surah headers); `getItemType` distinguishes them.
- Page view: FlatList over 604 pages; line layout from `page_lines` (15 lines/page) with precomputed `getItemLayout` offsets.
- Page assignment uses `v2_page`, **not** `page_map` (56 ayahs differ).
- Quran display text is PUA glyph strings (`text_qcf2` / QPC V4 Tajweed). Copy/Share must use `text_uthmani` (real Unicode).
- Web Quran fonts must load via native `FontFace` API (`display: 'swap'`), not `expo-font`. Native uses `expo-font`.
- Quran word containers must set `direction: "ltr"` + `flexDirection: "row-reverse"` to avoid double-reversal under RTL UI.

### Settings and content

- `lib/settings/context.tsx` owns font size, theme, view mode, tafsir source, translation language, test modes.
- Font sizes are indexed into `FONT_SIZE_STEPS` (desktop) and `FONT_SIZE_STEPS_MOBILE`; native always uses mobile scale.
- Default tafsir source is `muyassar`; additional sources live under `assets/data/tafsir-sources/`.
- Translations: English in `translations` table; others lazy-imported into `translation_active`. RTL languages: Urdu, Persian, Pashto, Sindhi, Kurdish.

### Supabase / Quran Foundation

- `isSupabaseConfigured()` (in `lib/supabase.ts`) guards all Supabase use; app works fully offline if unconfigured.
- Supabase client is lazily initialized; unconfigured environments get a safe stub.
- **QF Content API (audio/hadith)** is separate from QF User API. Content API uses backend client credentials via `supabase/functions/qf-content`. Never put `QF_CONTENT_CLIENT_SECRET` / `QF_CLIENT_SECRET` in client bundles.
- Deploy QF content function with `supabase functions deploy qf-content` after setting Supabase secrets.
- QF User API/OAuth needs dedicated callback/logout handling; do not reuse Supabase OAuth routes.

---

## Datasets (`assets/data/`)

Built into `quran.db`: `quran-data.json`, `quran-qcf2.json`, `translation-sahih.json`, `zilal.json`, `page-map.json`, `tajweed.json`, `wbw/wbw.json`, `masaq/masaq-aggregated.json`, `layout/page-lines.json`, `surah-info.json`, `surah-english-names.json`, `reflection-journey.json`.

Lazy-loaded at runtime (must also be copied by `prepare-web-data.sh`): `wbw-arabic-meanings.json`, `irab-per-word.json`, `tajweed-rules-ar.json`, `tajweed-rules-en.json`, `al-qira-at-al-mawsoo-ah-al-qur-aniyyah.json`, `asbab-al-nuzul.json`, `mutashabihat/nourquran_hafiz.json`, `translations/*.json`, `tafsir-sources/*/*.json`.

---

## Key gotchas

1. **Quran glyph direction** — Quran word containers MUST set `direction: "ltr"` + `flexDirection: "row-reverse"`.
2. **`text_qcf2` vs `text_uthmani`** — Copy/Share use `text_uthmani`. PUA glyphs are display-only.
3. **`v2_page` vs `page_map`** — Always use `v2_page` for page-font rendering.
4. **Web font loading** — Use native `FontFace` API with `display: 'swap'` for Quran PUA fonts; `expo-font` on native.
5. **Session route** — `app/flashcards/session.tsx` is outside tabs and needs its own `SettingsProvider`.
6. **Sync never blocks** — every `enqueueSync` is `.catch(console.warn)`.
7. **MASAQ aggregation** — multiple segments per word aggregated into one row via `GROUP_CONCAT`.
8. **Onboarding gate** — `app/(tabs)/index.tsx` reads `user_settings` and `router.replace()`s to `/onboarding` or `/home`.
9. **Lazy asset duality** — every runtime JSON needs both a native require-map entry and a `prepare-web-data.sh` copy step.
10. **Web DB single-host** — multi-tab SQLite relies on one tab holding the OPFS lock.

---

## Conventions

- **Be terse.** State what you're doing in one sentence, then act. End-of-turn summary is one or two sentences max.
- **Prefer editing over creating.** Don't spawn new files when an existing module fits.
- **Comments**: default to none. Only add when the _why_ is non-obvious (hidden constraint, surprising invariant, workaround for a known bug). Never describe what the code does.
- **No speculative abstractions.** Three similar lines beat a premature helper. Don't add error handling for impossible states; trust internal callers, validate only at system boundaries.
- **Reference code with `path:line`** so the user can jump straight there.
- **Memory / persistence**: Treat each session as cold; rely on `AGENTS.md` and the codebase. If the user wants something durable, write it into `AGENTS.md`.
