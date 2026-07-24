# Repository Guidelines

## Project Structure & Module Organization

Hafiz is an Expo Router application for React Native and static web. Route screens live in `app/`, reusable UI in `components/`, and business logic, stores, database access, and platform adapters in `lib/`. Use `@/` for imports from the repository root.

Quran content, fonts, and images live in `assets/`; do not reformat or edit source datasets without validation. Supabase Edge Functions and SQL changes belong in `supabase/functions/` and `supabase/migrations/`. Utilities are in `scripts/`. Do not commit generated `dist/`, `.expo/`, or `test-results/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies and apply the checked-in patch-package fixes.
- `npm run start`: launch the Expo development server.
- `npm run web`: run the web app locally.
- `npm run typecheck`: run strict TypeScript checks without emitting files.
- `npm run lint`: check JavaScript and TypeScript with Expo ESLint rules.
- `npm run format`: format supported files with Prettier.
- `npm run build:web`: export the static web build to `dist/`.
- `npm run verify:quick`: run type checking, unit tests, and the Chromium smoke test.

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, double quotes, trailing commas, and a 120-character print width. Prettier and ESLint are authoritative. Name components and their files in PascalCase (`ReadingSettingsSheet.tsx`), functions and variables in camelCase, and route files in kebab-case. Mark platform variants with `.native.tsx` and `.web.tsx`.

## Testing Guidelines

Jest uses `jest-expo`; place tests under `tests/` and name them `*.test.ts` or `*.test.tsx`. Run `npm run test:unit`. Playwright specs use `*.spec.ts` under `tests/e2e/`; run `npm run test:e2e:smoke` for the required web smoke flow. Add regression coverage for changed behavior, including RTL and responsive contracts when UI is affected. No numeric coverage threshold is configured.

## Commits & Pull Requests

History uses short, imperative summaries, sometimes with prefixes such as `fix:`, `docs:`, or `chore:`. Keep commits focused. Unsolicited external PRs are not accepted. Maintainer-requested PRs must stay narrowly scoped, describe the change and verification, link the issue, and include before/after screenshots for visual changes.

## Agent Git Workflow

After each change, stage only task files, create a focused commit, and push the branch to `origin` before reporting completion. Never include unrelated work. If commit or push fails, report the blocker and leave the worktree recoverable.

## Security & Configuration

Never commit `.env`, `.env.local`, signing keys, or Supabase credentials. Document any new environment variables and keep browser-exposed values public.
