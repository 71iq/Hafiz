# Zayt v4 animation review

Open the gallery from disk and press Replay. Start at the card size, then compare the last frame with the poster. S uses a 56 pt slot in the gallery and M uses 112 pt. [Offline gallery](gallery.html)

| Moment | Export | What to look for |
| --- | --- | --- |
| Welcome back | A04 S | A hop followed by two waves with Zayt's right hand. |
| Daily wird | A06 S and M | A short hop, followed by a band of light rising from the feet and softening across the face. |
| Streak milestone | A07 S, light and dark | One turn on the way up, a diagonal cheer and seven sparks at landing. |
| Streak earned back | A08 S | Two bounces. The second is higher and opens both arms. |
| Juz complete | A15 M, light and dark | A higher spinning jump, eight sparks, a smaller victory hop and five rising motes. |
| Tap hello | A17 S, review only | A small hop and leaf flick that returns to the original warm smile. |

The comfort, rest, breathing and onboarding art carries over from v3.1. All posters are byte-identical to the earlier set. The original studio acceptance notes include Fable's visual findings and their fixes. [v3.1 production checks](https://github.com/71iq/Hafiz/blob/37acac0a457387ccfdf7e054dba4dfa61cf870d2/zayt/animations/acceptance.md)

## Visual review

Opus distinguished the six gestures at card size. Across the two spinning jumps, the face turns out of sight and returns before the cheer. Both hands stay apart, out to the sides and below the top of the body. The studio review and Opus both read the pose as celebration. The gold edge on the sparks reads on beige and the amber spill follows the silhouette on AMOLED. [56 pt strips](five-samples.png) · [Eight surfaces](surfaces.png)

Opus flagged the expression returning to rest at 2.00 s in A07 and 3.00 s in A15. The revised mouth closes first, and the eyes go directly from arcs to open eyes on the next sample. Opus rechecked the eight adjacent frames around each transition in both themes and passed the correction. The pose audit checks each reopening frame. [A07 frames](contacts/A07-S-light.png) · [A15 frames](contacts/A15-M-dark.png)

## Verification

The audit checks every encoded sample against its master, the registered start and hold poses, transparent margins, all eight background colours and one-play duration. It also checks jump count and height, spin count, cheer duration and sparkle count. The reference flash-area bound applies at the specified display sizes. The runtime candidate set uses 2,610,982 of 5,000,000 bytes. Every file fits its cap. The size report includes per-export hashes, poster differences and a repeated A06 render. [Size report](size-report.md) · [Pixel measurements](review-metrics.json)

The local Chromium gallery covers English and Arabic card placements, reduced-motion posters, Replay and the final hold. Typecheck passes. Repository lint reports its existing render-time assignment error in tests/unit/recitation-range-pause.test.tsx.

The feature branch contains the art for owner review. Physical-phone energy approval, app integration and release are pending.
