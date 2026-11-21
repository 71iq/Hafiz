# Zayt keeps the light

The Android widget layers a sky over the olive grove, a transparent studio render of Zayt, then the native flame, count and copy. Use the square painting for tiles and the wide painting with Android `centerCrop` for the other layouts. Move Zayt between the two ends for Arabic and English. Its right-hand wave stays on the viewer's left.

## Rebuild

From the repository root on the studio's x86-64 Linux toolchain, run the following command.

```sh
node zayt/widget/build.mjs
```

The command renders the 3D rig at twice the output resolution, paints both crops, builds the flames, makes the 3× review sheets and verifies the encoded files. It uses the existing offline packages, headless Chromium and libwebp described in [the studio setup](../studio/README.md). It reads Roboto and Noto Sans Arabic from the host's T3 font directory. On another host, set `ZAYT_FONT_DIR` to a directory containing `Roboto-Regular.ttf`, `Roboto-Bold.ttf`, `NotoSansArabic-Regular.ttf` and `NotoSansArabic-Bold.ttf`. Hashed filename suffixes are also accepted. Use Node 24.18.0 and the same fonts for byte-identical results.

Run `node zayt/widget/build.mjs --verify` to remeasure the current files and compare the manifest. The command checks the byte budget, pixel dimensions, alpha, codecs, clip and loop names and timings, final holds, loop starts, eye differences and contrast. The [manifest](out/manifest.json) lists the file sizes, hashes, inks and worst-pixel coordinates. Its runtime total includes all three JSON files and all nine SVGs. The review PNGs have separate size and hash entries.

## Art and motion

The sky, terrain, cloud banks, olive trees and light shafts are seeded Canvas paintings. Their coordinates are recomposed for each aspect ratio. The horizon and the two sunlit slopes place Zayt on the land. Evening light comes from the west and the drop's own internal glow. The native streak count and week marks carry the flame icons.

All sprite canvases measure 600 × 720. On the standing poster the opaque silhouette spans rows 120 through 703, including the sprig. The feet register at the same baseline across posters and landings. A06 holds its travelling reflection on the upper body. A07 returns to its actual 35% studio glow hold. [The clip list](out/clips.json) gives every drawable filename, in playback order, with its duration in milliseconds. Use the corresponding still after a clip or for reduced motion. The closed portion of the idle blink lasts 250 ms.

The [urgency loop list](out/loops.json) uses the same filename and millisecond fields as the one-shot clips. Repeat these loops while their state is active. Frame 00 is a byte-for-byte copy of the corresponding still. Each loop holds that pose for most of its cycle. Zayt bounces early in the day, then taps a foot and glances aside. As dusk approaches, Zayt blinks and a bead of oil slides down one temple. At night the body trembles. In the last hour the movement grows stronger and the inner light flickers. After a break, Zayt holds a low wave and blinks slowly. The late completion still shows Zayt wiping its brow.

The urgency drawings use the same oil, rig and fixed camera as the original studio poses. The eyes, brows, mouths and oil beads in [expressions.mjs](expressions.mjs) are painted on the front surface of the oil, so they move with the torso and the hand can cover the brow. [urgency.mjs](urgency.mjs) sets the poses and beat timing. The halo and pool use the original night lighting.

The normal sprites and motion frames use lossy VP8. For the eight closed-eye frames the builder starts with the lossy open-eye image, changes two patches taken from the lossy blink render and stores the exact composite in a VP8L WebP. A second VP8 encode changes other blocks on the face and feet. The verification compares all four decoded channels outside both eyes, including the ground light.

Fretful shifts to the other foot and looks back from the horizon. Nervous darts its eyes, shivers and balances on its toes with the torso upright and slightly forward. Frantic flings its arms down and out and makes two hops, with a grounded drawing between peaks. Nervous and frantic each have a night halo and a plain version for morning.

## Contrast and review

The square paintings keep the low sun or moon below the tile's text. Wide paintings use diffuse light and matte night stars. The make-up skies share the dawn grove, valley and light direction. Use dawn through nudge, `dawn_rose` for urgent and `dawn_red` for critical and last.

The verifier measures WCAG contrast on decoded sRGB pixels. On square tiles it reserves the full width through the bottom of a count and two Arabic lines on a 130 dp tile. On wides it protects the entire painting, including anywhere the line, flame, count or seven marks can move. It measures the secondary week labels separately over the seven-cell band, for both locales and for zero, one and two lines above the row. The verifier sweeps the bounds through centered 1:1 to 5:1 crops, includes a one-pixel filter margin and checks every disc and bright glint with two extra pixels of clearance. Ratios in the manifest round down to two decimals. The minimums are 7.6:1 for primary ink, 4.7:1 for secondary ink and 3:1 for the lit count.

The paired ladder uses 160 dp tiles and the face comparisons use 60 and 120 dp from sprig to feet. The loop sheet shows each frame with its hold time. The wide sheet shows all skies in English and Arabic with the reserved rows outlined, including a 130 × 48 dp compact strip with the flame and count at the start. These offline compositions use the Android XML dimensions and review fonts. [Ladder](review/ladder-v3.png) · [Faces](review/faces-v3.png) · [Loops](review/loops-v3.png) · [Wide layouts](review/night-wide.png)

The earlier sheets cover the daily states, reward flames, launcher, sizes and first set of urgency poses. [English states](review/states.png) · [Arabic states](review/states-ar.png) · [Day strip](review/day.png) · [Sizes](review/sizes.png) · [Skies](review/thumbs.png) · [Flames](review/flames.png) · [Launcher](review/home.png) · [First ladder](review/ladder.png) · [First faces](review/faces.png) · [First loops](review/loops.png)
