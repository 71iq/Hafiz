---
name: hafiz-quran-display
description: Use when working with Mushaf rendering, Quran text, Arabic fonts, RTL layout, PUA glyphs, page views, surah headers, ayah markers, or WordToken components.
---

# Hafiz Quran Display Skill

## Context

Hafiz renders the Quran with bundled page fonts (QPC V4 by default, optional QPC V4 Tajweed). The Quran text stored in the DB is **PUA glyph strings** (`text_qcf2`), not normal Unicode. Real Unicode lives in `text_uthmani` and is used only for copy/share/search.

## Invariants

- **Direction bug**: Every Quran word container must set `direction: "ltr"` + `flexDirection: "row-reverse"`. The RTL UI direction otherwise double-reverses the ayah.
- **Page assignment**: Use `v2_page`, never `page_map`, when grouping ayahs for page-font rendering. 56 ayahs differ.
- **Font loading**:
  - Web: native `FontFace` API with `display: 'swap'`.
  - Native: `expo-font`.
- **Copy/Share**: use `text_uthmani`. Never copy PUA glyphs.
- **Surah names / basmallah**: use the bundled QPC V4 surah-name font, not the per-page Quran font.

## Where to look

- `lib/database/schema.ts` for `quran_text` columns.
- `lib/mushaf/` for page/verse layout helpers.
- `lib/fonts/loader.ts` and `lib/fonts/qpc-v4-*.ts` for font loading.
- `tests/unit/mushaf-*` and `tests/unit/rtl-*` for layout contracts.
