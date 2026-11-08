# Home deck-card characterization

RF-052, 2026-10-26. The home route keeps its private SmartDeckCard and VocabularyDeckCard implementations. Both already use the shared Card and private DeckStats. A new shared presenter would add a contract without removing the different title/filter and settings policies. No extraction, route export, application behavior, dependency or style change is needed for this characterization.

The tests render the actual HomeScreen, Card, DeckStats and locale strings. Service responses, navigation/focus, settings and native sheet boundaries use controlled fixtures. The sheet mocks expose the real route callbacks' targets. The tests do not copy card implementations or load source text to create a test-only export.

## Preserved differences

| Contract               | Smart card                                           | Vocabulary card                                         |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Copy                   | Deck title/subtitle and localized filter summary     | Localized vocabulary title/subtitle                     |
| Settings               | SmartDeckFilterSheet with the selected smart deck ID | DeckReviewSettingsSheet with meanings ID and word mode  |
| Empty total            | Card remains visible and cannot start review         | Home route omits the card                               |
| Settings accessibility | Existing control has no explicit role or label       | Existing button has the localized review-settings label |

The missing smart settings label remains visible as existing accessibility debt. Characterization does not certify that control as accessible or fix it incidentally. Both card types retain their existing cards-sheet targets and review navigation IDs. A nonempty smart deck can start even when its due/new counts are zero.

## Evidence and limits

The 24 React Native Testing Library cases cover English/Arabic, LTR/RTL, light/dark branches, compact/expanded JSX layout, the inclusive phoneLarge boundary and resizing, count/color ownership, empty totals, filter branches, nested cards/settings callbacks, optional stopPropagation and the distinct review/settings targets. They inspect actual rendered props and invoke actual handlers. They do not establish browser/native event bubbling, measured layout, physical touch behavior or all theme palettes.

Seven temporary source regressions each cause assertion failures without runtime-error suites or skipped tests. They change the smart review target, vocabulary settings mode, propagation calls, start eligibility, filter copy, phone breakpoint and vocabulary count ownership. The exact original application source returns after every probe. Final focused tests, strict types, zero-warning new-test lint and scoped formatting pass. Preparation failures and raw results remain under .refactor-baseline/rf052-home-cards-v1/.

The controller must still install the exact artifacts, repeat every frozen verification command and obtain separate stronger read-only evaluation. Primary final acceptance follows the released leases. Existing application/test inputs and protected Quran assets remain hash-frozen. Full Jest, app builds, browser/device and native checks are not repeated for an added characterization test with unchanged application source. No production, push or deployment action runs.
