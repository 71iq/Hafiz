---
name: hafiz-data-pipeline
description: Use when adding datasets, regenerating the Quran SQLite database, updating prepare-web-data.sh, or adding lazy-loaded runtime JSON assets.
---

# Hafiz Data Pipeline Skill

## Source of truth

The bundled SQLite database `assets/data/quran.db` is built from JSON by `scripts/build-quran-db.mjs` using the schema in `lib/database/schema.ts`. If you change schema or input JSON, rebuild the DB.

## Adding a lazy-loaded runtime asset

Runtime JSON is loaded differently per platform:

1. Add a native `require()` entry in `lib/database/init.ts`.
2. Add a copy step in `scripts/prepare-web-data.sh` so the file lands in `public/data/`.
3. Use a shared load path in `init.ts` so both platforms resolve it correctly.

Web fetches from `/data/*`; native uses Metro's static `require()` map.

## Key commands

- `npm run build:db` — regenerate `assets/data/quran.db`.
- `npm run build:web` — static export; auto-runs `prepare-web-data.sh` via the `prebuild:web` lifecycle script.
- `npm run validate:reflection-journey` — validate the reflection-journey dataset.

## Invariants

- Batch runtime writes use `withTransactionAsync` in 500-row transactions by default.
- `prepare-web-data.sh` gzips tafsir source files. Keep that in mind when adding new tafsir sources.
- Never block local Quran reads on network.
