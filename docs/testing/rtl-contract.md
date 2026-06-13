# Hafiz RTL Contract

This is the stable RTL testing contract extracted from `docs/testing/rtl-contract-plan.md`.
It defines what Hafiz automates today and what remains manual or report-only.

## Product Rule

Mirror layout, not content.

Mirror:

- app shells, rows, tabs, segmented controls, menus, form chrome, overlay chrome, navigation, action ordering, and direction-sensitive icons
- text alignment for UI copy and form labels
- chart or progress surrounding chrome when the meaning is directional

Do not mirror:

- Quran glyph content
- QCF2, QPC V4, and QPC V4 Tajweed PUA text
- provider logos, brand marks, avatars, images, Rive/canvas assets, and neutral icons
- chart chronology unless a component has an explicit rule for it

## Current Automation

### Unit Source Contracts

Run:

```text
npm run test:unit -- --testPathPattern=rtl
```

Covered files:

- `tests/unit/rtl-component-registry-coverage.test.ts`
- `tests/unit/rtl-style-contract.test.ts`
- `tests/unit/rtl-quran-source-contract.test.ts`
- `tests/unit/rtl-higher-level-source-contract.test.ts`

These enforce:

- every user-visible component file under `components` has an RTL registry decision
- unconditional physical left/right styles are rejected unless allowlisted
- allowlist entries are documented and still match live source
- Quran display code keeps `direction: "ltr"` plus `flexDirection: "row-reverse"` where required
- Quran display code does not use horizontal mirror transforms
- copy/share paths keep using Uthmani text instead of PUA glyph display text
- heatmap, dropdown, and progress-chart geometry has explicit source-level RTL decisions

### RNTL Component Contracts

Run:

```text
npm run test:unit -- --testPathPattern=rtl
```

Covered files:

- `tests/unit/rtl-component-contracts.test.tsx`
- `tests/unit/rtl-higher-level-component-contracts.test.tsx`

These cover observable props and styles for:

- `Text`
- `Button`
- `Field`, `Label`, `FieldMessage`
- `FormTextField`
- `Input`
- `ToggleGroup`
- `ResponsiveOverlay` header/footer chrome
- `ConfirmDialog`
- `AuthScreenShell` helper rows
- `MushafIndicator`
- `FontSizeControl`
- `JuzNameText`
- `Progress`
- `AchievementProgressBar`

RNTL is not used for pixel geometry. It is used for explicit style props, direction props, class tokens, and interaction callbacks.

### Web Route Contract

Report-only runner:

```text
npm run test:ui:phase -- rtl-ui-contract
```

Blocking runner:

```text
npm run test:ui:rtl
```

The route contract lives in `tests/e2e/report-only/rtl-ui-contract.spec.ts`.
It seeds Arabic mode before app boot with:

```text
localStorage.hafiz_ui_language = "ar"
```

It checks:

- `/qa-ready`
- `/auth/login`
- `/auth/signup`
- `/home`
- `/mushaf`
- `/settings`
- `/progress`
- `/leaderboard`
- `/flashcards`
- `/profile`

Assertions:

- route is nonblank
- no framework error overlay
- no unexpected console or page errors
- `html` and `body` compute to RTL
- document has no horizontal overflow
- auth forms align input chrome to RTL start when inputs are present
- Mushaf route does not apply horizontal mirror transforms to Quran content

`npm run test:ui:rtl` is intentionally not included in `verify:quick` or `verify:web` yet. It builds the web export and runs a focused Playwright phase, so it is a targeted RTL/layout gate rather than a general verification default.

## Helpers And Providers

Unit tests reuse:

- `DirectionProvider` and `useUIDirection` from `lib/ui/direction.tsx`
- `textAlignForDirection`
- `tests/rtl/rtl-test-utils.tsx`

RNTL tests should prefer explicit `dir` props or `DirectionProvider`.
Do not wrap early RTL tests in `SettingsProvider` unless the test genuinely verifies settings behavior; that provider reads SQLite and creates unnecessary setup cost.

Playwright tests reuse:

- `captureConsole`
- `waitForQaReady`
- `assertHealthyPage`

from `tests/e2e/helpers.ts`.

## Registry Levels

The registry in `tests/rtl/rtl-component-registry.ts` classifies each component with a contract and level:

- `source`: source-level checks or documented invariants
- `rntl`: React Native Testing Library coverage
- `playwright`: rendered web route or overlay checks
- `manual`: requires human/native/live-environment verification

New component files must be classified before the registry coverage test will pass.

## Static Style Rule

The style guard scans:

- `components`
- `app`
- `lib/ui`

It flags unconditional physical direction styles and classes such as:

- `marginLeft`, `marginRight`, `paddingLeft`, `paddingRight`
- `left:`, `right:`
- `textAlign: "left"`, `textAlign: "right"`
- `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`
- `text-left`, `text-right`, `rounded-l`, `rounded-r`, `border-l`, `border-r`

Direction-aware contexts using `isRTL`, `dir`, `uiLanguage === "ar"`, `locale === "ar"`, `writingDirection: "rtl"`, or `row-reverse` are allowed.
Exceptions must live in `tests/rtl/rtl-style-allowlist.ts` with a specific reason.

## Quran Invariants

These are blocking:

- Quran text uses bundled Quran page fonts, not system Arabic fonts.
- Page rendering uses `v2_page` and `text_qcf2`.
- Quran word containers keep `direction: "ltr"` plus `flexDirection: "row-reverse"` to avoid double reversal.
- Quran content must not use `scaleX(-1)`, `rotateY(180deg)`, or equivalent horizontal mirror transforms.
- Copy and share use `text_uthmani`, not PUA display glyphs.

## Promotion Rules

Promote an RTL check from report-only to blocking only when:

- it has repeated clean local runs
- it does not depend on Supabase, live auth, device-only APIs, or unstable data timing
- failures point to actionable app code rather than test harness timing
- the command stays explicit enough that developers understand the build cost

Current promotion status:

- RTL source and RNTL checks are blocking through `npm run test:unit`.
- RTL route checks are blocking through `npm run test:ui:rtl`.
- Broad UI baseline phases remain report-only through `npm run test:ui:phase -- <phase>`.
- `verify:quick` and `verify:web` are unchanged intentionally.

## Deferred Areas

Keep these report-only or manual until stable mocks and data states exist:

- database-backed sheets
- Supabase-backed reflections, leaderboard, profile, and sync states
- OAuth/provider-logo behavior
- native-only Modal, FlatList, FlashList, safe-area, and font-loading edge cases
- Safari/iOS text selection and toolbar behavior
- complex chart pixel geometry

## Manual Follow-Up

Use `docs/agent/UI_MANUAL_TESTING_META.md` for broad manual passes.
For RTL-focused manual passes, prioritize:

- 412px Arabic phone
- 768px Arabic sidebar transition
- 1440px Arabic desktop
- Mushaf verse mode
- Mushaf page mode
- settings language/theme controls
- auth forms
- progress heatmap semantics
- one representative overlay and one representative picker
