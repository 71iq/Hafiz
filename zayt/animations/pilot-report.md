# Budget pilot, v3.1

All five pilot files fit at their declared canvas and 24 fps. The [pilot strip](pilot-slots.png) shows five evenly spaced samples, the actual poster and the gesture peak on both beige and AMOLED. The peak column matters: a five-sample strip alone misses A07's brief exterior spill. S is shown at 56 pt and M at 112 pt. Use [Replay in the gallery](gallery.html) to see the timing.

| Clip | Quality | Bytes / cap | At the real slot |
|---|---:|---:|---|
| A06 S | 75 | 21,824 / 150,000 | The band's centre leads its sides. It softens across the face rather than shining over the eyes. Smallest animation, including review files. |
| A07 S light | 83 | 74,996 / 150,000 | The peak core is `#FFF2C7`; the flank stays `#DFAA21`. The edge still separates from beige. No foot shadow or outside light. |
| A07 S dark | 83 | 107,022 / 150,000 | Warm spill follows the body on black without drawing a ring. It reaches alpha 71/255 and ends within 11 source pixels. No residue in the hold. |
| A04 S | 83 | 48,044 / 150,000 | One rounded hand rises to about 60° above horizontal and sways. The other arm stays down. |
| A15 M light | 83 | 248,134 / 300,000 | Five soft points rise above the leaves. The core reaches H46.91; the eyes remain open until the motes have gone. |

The pilot uses libwebp at effort 6 and alpha quality 100. The wave uses mixed frames with 9/17 keyframe bounds. The three light effects use mixed replacement rectangles and sparse lossless updates. Identical samples share their full duration. Alpha returning to zero forces a replacement, even when the change is below the colour tolerance. Master-to-WebP checks and tool versions are in the [size report](size-report.json).

During revision, overlapping geometry at the tip produced excess alpha in the medium dark spill. The final shader uses maximum coverage rather than stacking overlapping strips. On the non-pilot A15 M dark, the completed effect measured 331,856 bytes at Q83 and 301,820 at Q77. Q70 fit at **286,158 / 300,000** without reducing the halo, dropping motes, shrinking the canvas or changing the frame rate. No owner budget exception is needed.
