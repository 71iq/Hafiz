# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hafiz is an Expo (React Native) Quran retention app combining a Mushaf reader with SM-2 spaced repetition flashcards. Core reading/study works 100% offline via local SQLite; community features and sync use Supabase.

**Stack:** Expo 55, React 19, React Native 0.83, TypeScript 5.9, NativeWind (Tailwind), expo-sqlite, Supabase, expo-router (file-based routing).

## Commands

```bash
npm install                      # Install dependencies
npm start                        # Expo dev server
npm run web                      # Web dev server
npm run android                  # Android dev
npm run ios                      # iOS dev
npm run generate-db              # Rebuild quran.db from source data (scripts/generate-db.js)
```

No test suite exists yet.

## Architecture

### Routing (`app/`)
File-based routing via expo-router. `app/_layout.tsx` is the root (initializes SQLite, wraps with Auth/Settings providers). `app/(tabs)/` contains the five tab screens: Mushaf, Flashcards, Search, Community, Profile. `app/open.tsx` handles `hafiz://open?surah=X&ayah=Y` deep links.

### Database (`src/db/database.ts`)
Single file containing all SQLite queries (~370 lines). All operations are async (`db.runAsync`, `db.getFirstAsync`, `db.getAllAsync`). Static tables: `surahs`, `quran_text`, `word_roots`, `juz_map`. Runtime table: `study_log` (tracks spaced repetition state with `synced` flag for cloud sync).

Web platform loads the database from a JSON file (`public/quran-data.json`) via batched inserts rather than a pre-built `.db` file.

### Spaced Repetition (`src/lib/sm2.ts`, `src/lib/uniqueness.ts`)
SM-2 algorithm with grades: Again(0)→q0, Hard(1)→q3, Good(2)→q4, Easy(3)→q5. `uniqueness.ts` handles duplicate verse disambiguation by prepending context verses until the card is unique.

### Sync (`src/lib/sync.ts`, `src/hooks/useSync.ts`)
Offline-first: local writes set `synced=0`, sync pushes unsynced rows to Supabase then pulls remote, upserts with timestamp-based conflict resolution (remote wins if newer). Supabase RPCs `recalc_score()` and `update_streak()` run after sync.

### Context Providers (`src/context/`)
- `AuthContext.tsx` — Supabase auth session, signIn/signUp/signOut
- `SettingsContext.tsx` — fontSize, hideAyahs, colorScheme

### Community (`src/lib/community-api.ts`, `src/components/community/`)
Posts tied to specific ayahs, text-only. Paginated feed (20/page). Likes, comments, leaderboard ranked by score/streaks.

### Supabase Schema (`supabase-schema.sql`)
Full DDL with RLS policies, triggers, and functions. Required for community/auth features.

## Key Conventions

- All database calls must be async (web platform requirement after dc3475a fix)
- UI components use NativeWind className strings (Tailwind syntax)
- FlashList (`@shopify/flash-list`) for virtualized lists, not FlatList
- Union types for list data: `ListItem = SurahHeaderItem | AyahItem`
- Environment variables in `.env.local`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Metro config adds cross-origin isolation headers for web (SharedArrayBuffer support)
