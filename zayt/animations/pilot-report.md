# Budget pilot

The revised pilot uses the deep-gold oil, 70% eyes and rounded capsule arms. `pilot-slots.png` compares five samples and the poster on beige and black. The small rows are 56 pt high. A15 is 112 pt high. Use the gallery to replay the actual files.

| Clip | Bytes / cap | Observation at slot size |
|---|---:|---|
| A06 S | 23,952 / 150,000 | One horizontal band crosses the lower body, face and tip. The arm, highlight and leaves stay still. |
| A07 S light | 89,238 / 150,000 | A bright gold core fills the drop. The darker outline and specular reflection remain visible against beige. No exterior light. |
| A07 S dark | 105,826 / 150,000 | A short, soft spill accompanies peak intensity on black. Its edge is dithered at fixed canvas coordinates. No ring. |
| A04 S | 51,100 / 150,000 | The rounded tip of the right arm lifts clear of the body. The other arm stays at the side. |
| A15 M light | 272,780 / 300,000 | Six small motes rise on vertical tracks. The warm light stays inside the body; the feet stay down. |

## What changed

The first dark S encode measured 339,572 bytes at quality 83. Qualities 77 and 70 measured 307,878 and 291,840. Restricting exterior changes to the peak took those three trials to 187,396, 161,824 and 154,838. Bringing the spill closer to the body passed at 129,228. The revised model keeps that smaller spill. The full inner rise still lasts 1.3 seconds. The blink closes for 350 ms on the timeline, 375 ms in the sampled S file.

The initial peak lost too much saturation. The revised material adds warm light through the core, leaving the edge and reflection intact. Larger decoded frames also revealed rectangular colour steps that were absent in the masters. Lowering quality would not fix these. The three light effects now encode bounded source-replacement rectangles or lossless opaque-pixel updates. Changes below two channel levels accumulate against the last written pixels, not the last nominal sample. The final hold flushes that tolerance. Alpha quality is 100. The pilot uses quality 83, effort 6 and mixed lossy/lossless packets. The arm-only wave uses libwebp's mixed encoder, with 9/17 keyframe bounds. Identical consecutive samples share their full duration.

The final daily shimmer uses quality 75. It measured 27,546 bytes at quality 83, 24,806 at 77 and 24,350 at 76. At 23,952 bytes it is smaller even than the 24,546-byte review-only tap. Comparing the decoded 75 and 77 encodes on beige showed the same soft sweep without streaks. No pilot file needs a resolution or frame-rate exception. These are gallery proofs, not a device playback test.
