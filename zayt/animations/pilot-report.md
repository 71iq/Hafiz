# Milestone energy pilot

A07 lasts three seconds. Zayt squashes, jumps 35% of its body height, turns once and opens both arms. Seven sparks move out from the upper body at the landing. The blink comes after the glow falls. Compare the two renders at 56 pt on beige and AMOLED in the [pilot strip](pilot-slots.png) or play them in the [gallery](gallery.html).

| Render | Bytes | Cap | Light at the peak |
| --- | ---: | ---: | --- |
| S light | 238,506 | 300,000 | The gold-edged sparks separate from beige. The body has no outer spill. |
| S dark | 269,630 | 300,000 | The amber spill extends 11.18 source pixels beyond the silhouette and reaches alpha 71/255. |

Both files use 72 nominal samples at 24 fps, libwebp quality 83 and effort 6. The start and end match the existing rest and milestone poses. The final decoded frames have zero visible pixels outside the hold silhouette.

The pilot was rendered first. The full set followed at the requested energy for visual review. The owner's phone-size decision is still open. The [size report](size-report.json) records the hashes and encoder settings.
