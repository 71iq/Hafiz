# UI verification

RF048, 2026-11-08, on the static web export (`npm run build:web:test`) in Chrome, plus the Android device checks recorded with each task. Report-only phases are findings, not acceptance gates.

## Report-only phases

`npm run test:ui:phase` ran at 360, 768 and 1440 px wide. `responsive-overflow` (40 route and width cases), `rtl-ui-contract` (10 routes in Arabic) and `ui-contract` (3 checks) all passed with no skips. After RF199 the overflow and RTL phases were repeated at 360 px and still passed.

## Changed features

| Feature                                                                                               | Checked                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translation picker radio roles (RF165)                                                                | Chrome, English and Arabic, all five themes, 390x844 and reduced 390x600: no horizontal overflow, 22 options, one checked. This pass found RF199: Arabic rows were laid out backwards and the selected row was not tinted on the web, for every Pressable that styles itself through a press-state callback. Fixed and re-checked. |
| Home, Leaderboard, Progress, Settings, Reflections, Flashcards                                        | Chrome screenshots in both locales after RF199; no broken layout. Leaderboard and Reflections show their offline error state with the synthetic backend.                                                                                                                                                                           |
| Page-view glyphs (RF189), deep links (RF196), settings and chips (RF186, RF187), bundled data (RF188) | Android device, see each task.                                                                                                                                                                                                                                                                                                     |
| Review session card removal (RF183), home load failure (RF180), reflection decoding (RF192)           | Unit tests in Arabic and English; not exercised in a browser because they need a deleted card, a failing database read or a malformed server row.                                                                                                                                                                                  |

## Not covered

iOS (RF042 deferred), physical tablets, screen readers, hardware keyboards on native, and the web at 1024 px with themes. Hydration error #418 appears on static pages and is a known static-export message (`tests/e2e/helpers.ts`).
