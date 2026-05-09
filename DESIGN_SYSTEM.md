# Hafiz — Design System

> **Audience:** This document is a self-contained brief for a designer (human or AI) creating new screens, components, or marketing surfaces for Hafiz. Every screen should feel like it belongs in the same product as the screens already shipped. If you only read one section, read §1 (North Star) and §3 (Tokens).

---

## 1. North Star — "The Digital Sanctuary"

Hafiz is a Quran retention app: a Mushaf reader fused with a spaced-repetition flashcard engine. The product is for memorizers — people returning to the same verse hundreds of times. Every interaction is _repeated_, so every interaction must be _calm_.

The Creative North Star is **"The Digital Sanctuary."** Three principles flow from it:

1. **Editorial, not utilitarian.** Treat each screen like a page in a fine art book, not a dashboard. Generous white space, large display typography, asymmetric composition, intentional restraint.
2. **Felt, not seen.** The UI should disappear in service of the sacred text. Boundaries through tonal shifts, never lines. Depth through luminance, never drop shadows. Motion through springs, never linear easings.
3. **Breathable asymmetry.** Reject the rigid centered grid. Offset titles. Float metadata to one edge while the verse takes the other. Use whitespace as a compositional element, not a margin afterthought.

**Hard rejections** — if a comp shows any of these, send it back:

- 1px solid borders separating sections.
- Drop shadows used to define cards (heavy `0 4px 8px rgba(0,0,0,...)` style).
- Pure black text or pure white surfaces in light mode.
- Geometric Islamic ornamentation (arabesques, geometric tiles, mosque silhouettes). The Uthmani script _is_ the only ornament.
- Square buttons or sharp corners on interactive elements.
- Thick progress bars or chunky loaders.

---

## 2. Voice & Tone (visual)

| Quality         | Means                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| Reverent        | Generous spacing around sacred text. Never crop or overlay verses.                                        |
| Editorial       | Big display headlines (Noto Serif) paired with tight all-caps eyebrow labels.                             |
| Quiet           | Saturated color reserved for primary action only. Everything else is warm neutral.                        |
| Confident       | Pick one focal element per screen. The rest defers.                                                       |
| Heritage-modern | Deep teal + warm gold evokes scholarship. Avoid neon, gradients-for-gradients-sake, or trendy mesh blobs. |

---

## 3. Design Tokens

### 3.1 Color (light)

| Token            | Hex                         | Use                                                                                |
| ---------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `surface`        | `#FFF8F1`                   | App background. The base of every screen.                                          |
| `surface-low`    | `#F9F3EB`                   | Grouped content (e.g., a list section).                                            |
| `surface-mid`    | `#F0EBE3`                   | Elevated content.                                                                  |
| `surface-high`   | `#E8E1DA`                   | Interactive cards, segmented control track.                                        |
| `surface-dim`    | `#DFD9D1`                   | Receded background behind a "lifted" white card.                                   |
| `surface-bright` | `#FFFFFF`                   | The most elevated layer (e.g., active toggle thumb, lifted card on dim bg).        |
| `primary`        | `#003638`                   | Deep teal. Display accents, gradient top.                                          |
| `primary-soft`   | `#1B4D4F`                   | Active nav pill background, gradient bottom.                                       |
| `primary-accent` | `#0d9488`                   | **The CTA color.** Primary buttons, links, focused states.                         |
| `primary-bright` | `#2dd4bf`                   | Dark-mode accent equivalent.                                                       |
| `gold`           | `#FDDC91`                   | Active nav text, secondary button background.                                      |
| `gold-light`     | `#FFF4D9`                   | Lightest secondary surface.                                                        |
| `gold-dark`      | `#785F22`                   | Text on gold backgrounds.                                                          |
| `charcoal`       | `#2D2D2D`                   | **Body text in light mode.** Never use pure black.                                 |
| `warm-400`       | `#b9a085`                   | Muted/secondary text in light mode.                                                |
| `outline`        | `rgba(223, 217, 209, 0.10)` | Ghost border at 10% opacity, only when accessibility absolutely demands a divider. |

### 3.2 Color (dark)

| Token                 | Hex                          | Use                                                   |
| --------------------- | ---------------------------- | ----------------------------------------------------- |
| `surface-dark`        | `#0A0A0A`                    | Base.                                                 |
| `surface-dark-low`    | `#141414`                    | Grouped.                                              |
| `surface-dark-mid`    | `#1A1A1A`                    | Elevated.                                             |
| `surface-dark-high`   | `#262626`                    | Interactive cards.                                    |
| `surface-dark-dim`    | `#0F0F0F`                    | Receded.                                              |
| `surface-dark-bright` | `#2D2D2D`                    | Most elevated.                                        |
| Body text             | `neutral-200` (`#E5E5E5`)    | Never pure white.                                     |
| Muted text            | `neutral-500` (`#737373`)    |                                                       |
| Primary accent        | `primary-bright` (`#2dd4bf`) | CTAs use the brighter teal in dark mode for contrast. |

**Dark mode rule:** the `surface` ladder should feel like _slate stacked on slate_, not gray-on-black. Test that the layers are visually distinguishable but never crisp.

### 3.3 Typography

Two type families, used with deliberate contrast.

| Family               | Use                                                                                                          | Weights                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| **Noto Serif**       | Display, surah titles, headlines. Anything that should feel literary or weighted.                            | Regular 400, Medium 500, Bold 700               |
| **Manrope**          | Body, UI, navigation, metadata, buttons. Geometric sans, neutral.                                            | Regular 400, Medium 500, SemiBold 600, Bold 700 |
| **QCF2 (KFGQPC V2)** | Quran text only. 604 per-page fonts with PUA glyph mapping. Designers do not pick sizes for QCF2 — see §6.1. | —                                               |

**Type scale** (Tailwind sizes; base = 16px):

| Variant      | Family            | Size               | Weight | Use                                      |
| ------------ | ----------------- | ------------------ | ------ | ---------------------------------------- |
| `display-lg` | Noto Serif Bold   | 36 / `text-4xl`    | 700    | Hero titles. One per screen, max.        |
| `display-md` | Noto Serif Bold   | 30 / `text-3xl`    | 700    | Major section opener.                    |
| `display-sm` | Noto Serif Medium | 24 / `text-2xl`    | 500    | Sub-section / surah card name.           |
| `headline`   | Noto Serif Medium | 20 / `text-xl`     | 500    | Card titles.                             |
| `title-lg`   | Manrope Bold      | 18 / `text-lg`     | 700    | UI emphasis.                             |
| `title-md`   | Manrope SemiBold  | 16 / `text-base`   | 600    | Default UI title.                        |
| `title-sm`   | Manrope SemiBold  | 14 / `text-sm`     | 600    | Compact UI title.                        |
| `body`       | Manrope Regular   | 16 / `text-base`   | 400    | Body copy. `leading-relaxed`.            |
| `body-sm`    | Manrope Regular   | 14 / `text-sm`     | 400    | Secondary body.                          |
| `label-lg`   | Manrope Medium    | 14 / `text-sm`     | 500    | Form labels, list labels.                |
| `label-md`   | Manrope Medium    | 12 / `text-xs`     | 500    | Compact label.                           |
| `label-sm`   | Manrope Medium    | 10 / `text-[10px]` | 500    | **Eyebrow:** `tracking-wider uppercase`. |
| `muted`      | Manrope Regular   | 14 / `text-sm`     | 400    | `warm-400` color.                        |
| `caption`    | Manrope Regular   | 12 / `text-xs`     | 400    | `warm-400` color.                        |

**The Big & Small rule:** every screen should pair a display variant with a label-sm eyebrow somewhere. Extreme contrast in size between primary and metadata is the editorial signature.

### 3.4 Spacing & Radius

- **Spacing rhythm:** Tailwind's 4-px scale. The most-used values: `gap-3` (12), `gap-4` (16), `gap-6` (24), `gap-8` (32). For top-of-screen breathing room, use `pt-12` (48) or higher to create a "gallery" feel.
- **Card padding:** `px-6 py-6` (24/24) is the default. Tighter than this feels cramped.
- **Radius ladder:**
  - `rounded-full` — every button, every pill, every nav indicator, every avatar.
  - `rounded-4xl` (32) — cards, sheets, modals.
  - `rounded-3xl` (24) — secondary cards.
  - `rounded-2xl` (16) — small cards, sidebar nav items.
  - `rounded-lg` (8) — inline tags, the rare exception.
  - **Never** use `rounded-md` or smaller on interactive surfaces.

### 3.5 Elevation & Shadow

Hafiz achieves elevation by **luminance shift**, not shadow. To make a card feel lifted:

> Place a `surface-bright` (`#FFFFFF`) card on a `surface-dim` (`#DFD9D1`) parent. The 18-point luminance difference reads as "lifted" without a single pixel of shadow.

**Ambient shadow recipe** (only for floating elements like a FAB, sticky bottom bar, or active sheet):

```
shadow-color: #003638  (teal, NOT black)
offset:       0px 4px
blur:         32px
opacity:      4%
```

The teal-tinted whisper mimics light passing through stained glass. If a comp's shadow is darker than this, it's wrong.

### 3.6 Motion

| Interaction                         | Spec                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| Press (button, card, tab)           | `transform: scale(0.98)` while pressed. Spring back on release.  |
| Sheet slide-in                      | Spring: `damping: 25, stiffness: 200`. ~280ms perceived.         |
| Toggle thumb                        | Spring: `bounciness: 4`.                                         |
| Bottom-bar hide on scroll           | `withTiming(visible ? 0 : 1, 200ms)`, slides 120px down + fades. |
| Tab press scale                     | `withSpring(0.9, { damping: 15, stiffness: 400 })`.              |
| Verse opacity reveal (memorization) | Animate `opacity` only. 200ms `easeOut`.                         |

**Never** use linear easings for organic interactions. Linear is only acceptable for indeterminate progress.

---

## 4. Composition Rules

### 4.1 The "No-Line" Rule

Designers are **prohibited from using 1px solid borders to separate sections.**

- Header → body separation: shift `surface` → `surface-low`.
- Highlighted verse: `primary-soft` background at 5% opacity, no border.
- List item separation: `gap-4` vertical spacing (16px) — **never** a divider line.
- If accessibility absolutely demands a divider (e.g., a long settings list on a single surface), use `outline` at 10% opacity. This is a fallback, not a default.

### 4.2 The "Divider Ban" for Lists

List items separate themselves with whitespace and tonal alternation:

- Even items on `surface`, odd items on `surface-low`. Or
- All items on `surface`, separated by `gap-4` (16px) of empty space.

### 4.3 Breathable Asymmetry

- The active verse / focal element gets **40% more whitespace** around it than inactive items.
- Pull metadata (juz number, page number, hizb) to one side; let the verse claim the other. Don't center everything.
- A surah name aligned to the right with stats peeking out from the left edge is more _Hafiz_ than a centered card with stats below.

### 4.4 RTL — first class

This is a Quran app. Arabic-first UI is not a feature, it's a baseline.

- Every layout must mirror perfectly when `direction: rtl`.
- Arrows, chevrons, and progress indicators flip horizontally.
- Quran word rendering is the one exception — Quran word containers explicitly set `direction: ltr` then use `flex-direction: row-reverse` so Arabic word order is visually correct regardless of UI language. Designers don't need to spec this — it's an engineering invariant — but **don't** put body UI text into the same container as Quran text, because the dual direction context will break.

### 4.5 Density

Hafiz is intentionally low-density. If a comp feels "full," remove something. The eye should rest on one focal element per fold.

---

## 5. Components

Every component below already exists in code under `components/ui/`. Specs reflect what is shipped. New components should match these conventions.

### 5.1 Button

- **Shape:** always `rounded-full`. Never square.
- **Heights:** `sm` 36, `default` 44, `lg` 56. Icon-only: 40×40 circle.
- **Variants:**
  - **Default (primary):** solid `primary-accent` (`#0d9488`) background, white text. Use the teal gradient (`primary` → `primary-soft`) for hero CTAs.
  - **Secondary:** `gold` (`#FDDC91`) background, `gold-dark` (`#785F22`) text.
  - **Outline:** transparent background, `charcoal` text. No actual border — it's just text on the surface.
  - **Ghost:** transparent, `charcoal` text. For toolbar / icon-adjacent actions.
  - **Destructive:** `red-500`, white text. Rare; reserved for delete.
- **Press:** `scale(0.98)`. No color flash.
- **Disabled:** `opacity: 0.5`. Don't change color.
- **Label:** Manrope SemiBold, centered. `text-base` at default size.

### 5.2 Card

- Default shape: `rounded-4xl` (32) with `overflow: hidden`.
- Padding: header `px-6 pt-6 pb-3`, content `px-6 pb-6`, footer `px-6 pb-6 pt-0`.
- Elevation via background tier: `surface` / `surface-low` / `surface-mid` / `surface-high` / `surface-bright`. Pick based on what the card is sitting on (it should be lighter than its parent).
- **No shadow** by default. Lift comes from luminance.

### 5.3 Badge

- `rounded-full`, `px-3 py-1`, Manrope Medium 12.
- Variants: `default` (teal-tinted at 10%), `secondary` (gold-tinted at 30%), `muted` (`surface-high`), `outline` (transparent).
- Use for: ayah count, juz/hizb labels, "New" / "Due" indicators, language tags.

### 5.4 Progress

A **2px hairline arc** (or bar). Track is `outline` at 15% opacity. Fill is `primary-accent`. No labels overlaid on the bar; place them adjacent.

For circular progress (memorization rings, study stats), same recipe: 2px stroke, hairline track, teal fill. Reference: a luxury timepiece, not a fitness tracker.

### 5.5 Toggle / Switch

- 44×24 pill track. Thumb 20×20.
- Off: `surface-high` (`#E8E1DA`). On: `primary-accent` (`#0d9488`).
- Thumb: white with the ambient teal shadow.
- Spring animation, `bounciness: 4`.

### 5.6 ToggleGroup (segmented control)

- Track: `surface-high`, `rounded-full`, `p-1`.
- Active item: `surface-bright` (white) pill with `primary-accent` text.
- Inactive item: `warm-400` text.
- Press: `scale(0.98)`.

### 5.7 Sheet (bottom sheet)

- `rounded-t-4xl`, slides up from bottom with backdrop at 30% black.
- Background: `surface` (light) or `surface-dark-low` (dark).
- Top handle: 40×4 pill in `surface-high`, 12px from top edge.
- Spring: `damping: 25, stiffness: 200`.
- Padding: `px-6 pb-8` for content.
- Tap backdrop to dismiss.

### 5.8 Tab Bar / Sidebar (responsive)

The same nav system shape-shifts at 768px:

- **Bottom bar (mobile, < 768px):** absolute at bottom, `borderTopRadius: 40`, glassmorphic background (`surface` at 80% opacity, `backdrop-blur: 24px` on web). Active item gets a `primary-soft` (`#1B4D4F`) pill with `gold` (`#FDDC91`) icon + label. Press: scale `0.9`.
- **Sidebar (desktop, ≥ 768px):** 220px wide, `surface` background, header reads "Hafiz" / "The Digital Sanctuary" in Noto Serif Bold + Manrope. Same active pill treatment.

**Inactive label color:** 50% opacity charcoal (light) / 50% opacity warm (dark). **Active:** `gold` text on `primary-soft` background.

### 5.9 EmptyState

Centered: 80×80 circle (warm tint at 30% opacity) holding a Lucide icon at 36px stroke 1.5, then `title-md` warm-700 title, then `body-sm` warm-400 subtitle, then optional pill CTA. ~48px vertical padding around the whole thing.

### 5.10 Toast

Self-dismissing pill at the bottom (~80px above safe area), `surface-bright` background, `charcoal` text, ambient teal shadow. 2-second auto-dismiss. No close button.

### 5.11 Skeletons

Pulsing rounded rectangles in `surface-high`. Match the radius of the element they replace (lots of `rounded-full` and `rounded-2xl`). 1.2s ease-in-out pulse between 60% and 100% opacity.

### 5.12 Offline banner

Animated slide-down banner under the safe-area top, `surface-mid` background, `body-sm` charcoal text, no border. Slides up to dismiss.

### 5.13 Sync indicator

Small icon-only badge in headers showing one of four states: syncing (spinning), synced (check), offline (cloud-off), error (alert). 16–20px Lucide icons; color is `primary-accent` for active states, `warm-400` for idle, `red-500` for error.

---

## 6. The Mushaf — Sacred Surface

The Mushaf reading view is the heart of the product. It deserves its own design rules.

### 6.1 QCF2 Font (Quran text)

- **Don't pick a size.** The user controls Quran font size globally; designers spec only the _baseline_ and minimum/maximum bounds.
- **Don't pick a color.** Quran text uses `on-surface` (charcoal in light, neutral-200 in dark). Period.
- **Line height: 2.0× minimum.** Arabic Quranic text needs vertical breathing room.
- **Word spacing:** rendered by font; do not add letter-spacing or word-spacing CSS to QCF2 elements.
- **Two view modes:**
  - **Verse-by-verse:** each ayah is a card. Word-wrap container with `direction: ltr; flex-direction: row-reverse`. Inline translation/tafseer can sit below.
  - **Page view:** authentic Mushaf page layout — flexbox lines, justified, 15 lines per page (matching the physical Madani Mushaf).

### 6.2 Verse Cards

- Background: `surface` (or `surface-low` for active). No border.
- Padding: `px-6 py-6` minimum, more generous for active.
- Active verse highlight: `primary-soft` at 5% opacity background, never an outline.
- Ayah marker: embedded in the QCF2 glyphs, do not overlay your own circle.
- Metadata (juz, hizb, page, surah) sits in a `label-sm` eyebrow uppercase row above or to the side, never overlapping the script.

### 6.3 Surah Header

A decorative card at the top of each surah:

- Surah Arabic name in Noto Serif (or system Arabic) at display size.
- Surah English name in `label-sm` eyebrow, uppercase, tracked.
- Bismillah in QCF2 font (page 1 PUA glyphs), centered, generous vertical breathing room above and below.
- No ornaments, no calligraphic frames, no geometric tiles. The Bismillah _is_ the ornament.

### 6.4 Word interaction

- **Tap** a word → small teal pill tooltip showing English translation. Tooltip floats just above the tapped word.
- **Long-press** → enter selection range mode. Anchor at this word; tap another word to complete the range, then a `SelectionActionBar` appears with: Copy, Share, Reflect, Highlight, Bookmark.
- **Hover** (web only) → same tooltip behavior as tap.
- **Detail sheet:** tap the tooltip or use a "details" affordance to open a bottom sheet with 7 tabs: English, Meaning, I'rāb, Taṣrīf, Tajwīd, Qirā'āt, Occurrences.
- Selection highlights: 4 colors available, all soft pastels. A highlighted word/range gets a translucent background swatch (NOT an underline or border).

### 6.5 Tajwīd colors

When tajwīd display is on, characters within a word receive colored backgrounds keyed to rule (e.g., Idghām, Ikhfāʾ, Ghunna). These colors are determined by data, not by a designer. Don't override them.

### 6.6 "Hide Ayahs" mode

Memorization-aid mode. Each verse renders at low opacity (~10%) and reveals on tap (animate to 100%). Translation/tafseer hide too. Provide a clear toggle in settings — don't bury it.

---

## 7. Screens — Architecture & Intent

The app has 6 primary tabs, accessed via responsive bottom bar (mobile) or sidebar (desktop):

| Tab                  | Purpose                                                                                               | Hero element                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Home (Sanctuary)** | Daily landing. Progress ring, streak, resume CTA, quick access to last-read surah and due flashcards. | Big Noto Serif greeting + circular memorization ring. |
| **Mushaf**           | Read & study. Verse-by-verse or full Mushaf page view. Toggle, search button, go-to navigator.        | The sacred text itself — UI shrinks.                  |
| **Flashcards**       | Study dashboard: stats, deck list, create deck, start review.                                         | "Due today" count in display-lg.                      |
| **Progress**         | Stats, hadith of the day, activity heatmap, surah-by-surah progress.                                  | Heatmap + hadith card.                                |
| **Leaderboard**      | Daily / Weekly / All-time / Streak.                                                                   | Top 3 podium → ranked list.                           |
| **Settings**         | Theme, font size, translations, tafsir source, account, sync.                                         | Grouped list, no dividers.                            |

**Auxiliary screens:** onboarding (3 screens: Welcome → pick first surah → create deck), auth (login/signup), flashcard review session, deep-link handler.

**Onboarding rule:** never show the user a chrome-heavy app on first run. Onboarding screens use full-bleed display typography and a single primary CTA per screen.

---

## 8. Iconography

- **Library:** Lucide (`lucide-react-native`).
- **Stroke width:** 1.5 always. Never the default 2.
- **Sizes:** 16, 20, 22, 24, 36 (empty-state hero). Pick the smallest that's legible.
- **Color:** match the text it sits next to. In a tab bar, icons inherit the active/inactive text color.
- **No filled icons.** Outline only — matches the hairline aesthetic.

---

## 9. Imagery & Illustration

- **No stock photography.** No mosques, no Qur'an-on-wood-table photos.
- **No emoji** in production UI (decorative or functional).
- **Illustrations,** if used at all, should be minimal line art in `primary-accent` or `gold-dark`, on a warm-neutral background. Never full-color illustration.
- **The Bismillah and Quranic text are the only ornaments the product needs.** Resist the urge to add anything else.

---

## 10. Accessibility

- **Contrast:** charcoal-on-surface and primary-accent-on-surface both clear AA. Avoid warm-400 on surface for primary copy (use only for secondary/muted).
- **Tap targets:** 44×44 minimum. Buttons hit this with the `default` size.
- **Focus rings (web):** `outline: 2px solid primary-accent; outline-offset: 2px`. Don't suppress them.
- **Reduced motion:** respect `prefers-reduced-motion` — replace springs with 150ms fades, disable scale-on-press.
- **RTL:** see §4.4. Test every screen mirrored.
- **Font scaling:** Quran text size is user-controlled and must scale freely. UI text should respect platform "Larger Text" settings.

---

## 11. Do / Don't (cheat sheet)

### Do

- Use `pt-12` or higher at the top of major screens.
- Pair a `display-*` headline with a `label-sm` eyebrow uppercase above it.
- Use Noto Serif for surah names — heritage, weight, gravitas.
- Give the active verse 40%+ more whitespace than inactive ones.
- Lift cards with luminance, not shadow.
- Use `charcoal` (`#2D2D2D`) for body text in light mode.
- Round every interactive surface (`rounded-full` for actions, `rounded-4xl` for cards).
- Animate with springs.

### Don't

- Don't use 1px solid borders to define sections.
- Don't use heavy `0 4px 8px rgba(0,0,0,...)` drop shadows.
- Don't use pure black text in light mode.
- Don't add Islamic geometric ornament — the script is the ornament.
- Don't crowd the screen — when in doubt, add `gap-8`.
- Don't use square corners on buttons or pills.
- Don't use the default Lucide stroke (2). Always 1.5.
- Don't use linear easings for organic motion.
- Don't put UI text and Quran text in the same direction-controlled container.

---

## 12. File & Token References

For implementation, designers and engineers can audit these source-of-truth files:

- `tailwind.config.js` — color & font tokens, radius scale.
- `lib/fonts/ui-fonts.ts` — Manrope + Noto Serif loader.
- `lib/fonts/loader.ts` — QCF2 per-page font loader.
- `components/ui/` — every primitive (Button, Card, Badge, Sheet, Switch, ToggleGroup, Progress, Tabs, Skeleton, EmptyState, Toast, AppNavigation, etc.).
- `components/mushaf/` — sacred-surface components (AyahBlock, MushafPage, SurahHeader, WordToken, WordTooltip, WordDetailSheet, SelectionActionBar).
- `DESIGN_PHILOSOPHY.md` — companion narrative document (this file is the working spec; that one is the manifesto).
- `stitch_review_session/` — UX reference comps reviewed during the design system refactor.
- `design-references/` — quran.com / wahy.net reference screenshots that informed the Mushaf surface.
