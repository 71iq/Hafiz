# Lint warnings

The baseline had 71 warnings with ESLint 9.39.4 and eslint-config-expo 55.0.1. On 2026-11-08 there were 61. RF044 removed the 35 that cannot change behavior, leaving 26.

## Removed in RF044

- 29 unused catch bindings (`catch (_)`) in `lib/database/init.ts`, `lib/database/schema.ts`, `components/mushaf/SurahInfoModal.tsx`, `lib/notes/queries.ts` and `lib/quran-foundation/{cache,content}.ts` became optional catch bindings (`catch {`).
- 6 duplicate imports in `app/(tabs)/mushaf.tsx` and `app/flashcards/session.tsx` were merged.

## Remaining

- 25 `react-hooks/exhaustive-deps` warnings. Adding a dependency can re-run an effect or recreate a callback, so each needs its own task with a behavior test, not a bulk fix. By file: `components/mushaf/AyahDetailModal.tsx` 8, `components/mushaf/PageMushaf.tsx` 3, `components/mushaf/WordDetailSheet.tsx` 3, `app/(tabs)/mushaf.tsx` 2, and one each in `app/(tabs)/reflection-journey.tsx`, `app/flashcards/session.tsx`, `components/SearchCommand.tsx`, `components/flashcards/DeckReviewSettingsSheet.tsx`, `components/flashcards/SmartDeckFilterSheet.tsx`, `components/mushaf/SurahInfoModal.tsx`, `components/mushaf/WordTooltip.tsx`, `components/progress/ActivityHeatmap.tsx` and `components/ui/ResponsiveOverlay.tsx`. Start with AyahDetailModal, which holds a third of them.
- 1 unused loop variable in `scripts/build-page-words.js`. The script generates protected page data, so it is left for an authorized data-pipeline task.

## ESLint 10

ESLint 9 is past upstream maintenance, but the current eslint-plugin-react and eslint-plugin-import releases do not declare ESLint 10 support and Expo's preset still depends on them (TECH_STACK.md). Moving to ESLint 10 is RF198 and must not force peer resolution or drop enabled rules.
