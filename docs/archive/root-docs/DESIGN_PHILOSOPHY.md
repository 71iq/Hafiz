````markdown
# Design System: The Serene Path

## 1. Overview & Creative North Star: "The Digital Sanctuary"

This design system is built to transform the act of Quranic memorization from a digital task into a meditative ritual. Our Creative North Star is **"The Digital Sanctuary"**—an editorial-grade experience that prioritizes cognitive ease, spiritual tranquility, and intentional focus.

To move beyond the "standard app" aesthetic, we embrace **Breathable Asymmetry**. We break the rigid, centered grid by using generous, purposeful white space and offset typography. We treat the screen not as a container for data, but as a series of fine, layered vellum sheets. By removing traditional borders and heavy shadows, we allow the sacred text to remain the absolute focal point, framed by a UI that feels felt rather than seen.

---

## 2. Color & Tonal Depth

We utilize a sophisticated palette of deep teals and warm golds to evoke a sense of heritage and premium quality without relying on dated geometric clichès.

### The "No-Line" Rule

**Explicit Instruction:** Designers are prohibited from using 1px solid borders to define sections. Boundaries must be defined solely through background color shifts.

- To separate a header from a body, transition from `surface` to `surface-container-low`.
- To highlight a focused verse, use a `primary-container` background with a subtle 5% opacity shift rather than an outline.

### Surface Hierarchy & Nesting

Treat the UI as a physical stack of paper.

- **Base Layer:** `surface` (#FFF8F1) – The foundation of the sanctuary.
- **Secondary Layer:** `surface-container-low` (#F9F3EB) – Used for grouping related verses or lesson modules.
- **Interactive Layer:** `surface-container-highest` (#E8E1DA) – Reserved for the most important interactive cards.

### Signature Textures

Avoid flat, "plastic" looks. Use subtle linear gradients on primary CTAs:

- **Teal Depth:** Transition from `primary` (#003638) at the top-left to `primary-container` (#1B4D4F) at the bottom-right.
- **Glassmorphism:** For floating playback bars or navigation hubs, use `surface-variant` at 80% opacity with a `backdrop-blur` of 20px. This allows the Uthmani script to softly bleed through the UI, maintaining a sense of continuity.

---

## 3. Typography: Editorial Authority

The typography is the soul of this system. It balances the timeless authority of the Quran with the modern clarity of a premium reading app.

- **Sacred Text (Display):** Use a high-quality Uthmani font at `display-sm` to `display-lg` (24pt–36pt). It must be the largest element on the screen, treated with `on-surface` color.
- **UI & Navigation (Manrope):** Chosen for its geometric purity and neutrality.
- **Headlines:** `notoSerif` provides a literary, high-end feel for Surah names.
- **Body:** `manrope` ensures maximum legibility for translations and progress notes.
- **Visual Weighting:** Use extreme contrast between `display-lg` (The Verse) and `label-sm` (The Metadata). This "Big & Small" approach creates a sophisticated, editorial rhythm that guides the eye.

---

## 4. Elevation & Depth: Tonal Layering

Traditional shadows are too "heavy" for a spiritual app. We achieve depth through **Natural Lift**.

- **The Layering Principle:** Instead of a shadow, place a `surface-container-lowest` (#FFFFFF) card on a `surface-dim` (#DFD9D1) background. The subtle shift in luminance creates a perceived elevation that is softer and more "premium."
- **Ambient Shadows:** If a floating element (like a FAB) requires a shadow, use a 32px blur with only 4% opacity. The shadow color should be a tinted teal (`primary-fixed-variant`) rather than black, mimicking light passing through colored glass.
- **The "Ghost Border" Fallback:** If a divider is strictly necessary for accessibility, use `outline-variant` at **10% opacity**. It should be a whisper, not a statement.

---

## 5. Components

### Soft Pill Buttons

- **Primary:** Fully rounded (`rounded-full`), using the teal gradient. No borders.
- **Secondary:** `secondary-container` (#FDDC91) background with `on-secondary-container` (#785F22) text.
- **Interaction:** On press, scale down slightly (98%) rather than changing color abruptly.

### Cards & Lists

- **The Divider Ban:** Never use lines between list items. Use a `1.4rem` (`spacing-4`) vertical gap or alternating tonal shifts (`surface` to `surface-container-low`).
- **Verse Cards:** Use `rounded-lg` (2rem) for a soft, approachable feel. Ensure RTL padding is generous—minimum `spacing-6` (2rem) on all sides.

### Progress Arcs

- Avoid "thick" loading bars. Use a 2px stroke `primary` arc. The track should be `outline-variant` at 15% opacity. This creates a "hairline" precision look found in luxury timepieces.

### RTL Mastery

- All layouts must mirror perfectly. Icons with directional meaning (arrows, progress) must be flipped.
- Align the Uthmani script to the right, but keep "Memorization Stats" in an asymmetrical layout to the left to create visual interest.

---

## 6. Do's and Don'ts

### Do:

- **Do** use `spacing-12` (4rem) or higher for top-of-screen margins to create a "Gallery" feel.
- **Do** use `notoSerif` for Surah titles to give them a sense of history.
- **Do** ensure the "Active Verse" has at least 40% more whitespace around it than inactive verses.

### Don't:

- **Don't** use pure black for text in light mode; use `charcoal` (#2D2D2D) to reduce eye strain.
- **Don't** use "Card Shadows" to separate content; use background color nesting.
- **Don't** use heavy geometric patterns or overly ornate borders; let the Uthmani script be the only "ornament."
- **Don't** crowd the screen. If in doubt, add `spacing-8`.```
````
