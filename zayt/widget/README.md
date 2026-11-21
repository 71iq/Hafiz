# Zayt keeps the light

The Android widget layers a sky over the olive grove, a transparent studio render of Zayt, then the native flame, count and copy. Use the square painting for tiles and the wide painting with Android `centerCrop` for the other layouts. Move Zayt between the two ends for Arabic and English. Its right-hand wave stays on the viewer's left.

## Rebuild

From the repository root on the studio's x86-64 Linux toolchain, run the following command.

```sh
node zayt/widget/build.mjs
```

The command renders the 3D rig at twice the output resolution, paints both crops, builds the flames, makes the 3× review sheets and verifies the encoded files. It uses the existing offline packages, headless Chromium and libwebp described in [the studio setup](../studio/README.md). It reads Roboto and Noto Sans Arabic from the host's T3 font directory. On another host, set `ZAYT_FONT_DIR` to a directory containing `Roboto-Regular.ttf`, `Roboto-Bold.ttf`, `NotoSansArabic-Regular.ttf` and `NotoSansArabic-Bold.ttf`. Hashed filename suffixes are also accepted. Use Node 24.18.0 and the same fonts for byte-identical results.

Run `node zayt/widget/build.mjs --verify` to remeasure the current files and compare the manifest. The command checks the byte budget, pixel dimensions, alpha, codecs, clip names and timings, final holds, eye differences and contrast. The [manifest](out/manifest.json) lists the file sizes, hashes, inks and worst-pixel coordinates. Its runtime total includes both JSON files and all nine SVGs. The review PNGs have separate size and hash entries.

## Art and motion

The sky, terrain, cloud banks, olive trees and light shafts are seeded Canvas paintings. Their coordinates are recomposed for each aspect ratio. The horizon and the two sunlit slopes place Zayt on the land. Evening light comes from the west and the drop's own internal glow. The only flame is the counter icon.

All sprite canvases measure 600 × 720. On the standing poster the opaque silhouette spans rows 120 through 703, including the sprig. The feet register at the same baseline across posters and landings. A06 holds its travelling reflection on the upper body. A07 returns to its actual 35% studio glow hold. [The clip list](out/clips.json) gives every drawable filename, in playback order, with its duration in milliseconds. Use the corresponding still after a clip or for reduced motion. The closed portion of the idle blink lasts 250 ms.

The normal sprites and motion frames use lossy VP8. For the eight closed-eye frames the builder starts with the lossy open-eye image, changes two patches taken from the lossy blink render and stores the exact composite in a VP8L WebP. A second VP8 encode changes other blocks on the face and feet. The verification compares all four decoded channels outside both eyes, including the ground light.

The 104 dp short sprite starts at −11 dp and the 72 dp tiny sprite starts at −5 dp in the mockups. Their fixed canvas includes transparent headroom. At the nominal +4 and 0 dp offsets, the short crop cuts through the eyes and the tiny crop clips the seated smile. The adjusted offsets keep the peeking crop and the complete face.

## Contrast and review

Contrast uses WCAG sRGB relative luminance on decoded WebP pixels. The masks include the complete ink bounds of the count, monochrome flame, line and tall-layout plan note in both languages. The whole count row and the wide caption row are protected, including space for longer numbers. The compiler shapes the text using the review fonts. It checks every integer square size from 110 to 190 dp. For both source paintings it projects the layout's bounds through every centered aspect from 1:1 to 5:1. Bounds at the ends of each interval enclose the intermediate crops, with a one-source-pixel filter margin. A sample caption measures the secondary ink on reward scenes without a line. The paint grading follows latitude, so changes in text length or direction leave the painting continuous. The manifest rounds measured contrast down to two decimal places.

[The day strip](review/day.png) shows the six open-day bands and both done states. The [English](review/states.png) and [Arabic](review/states-ar.png) sheets show all 13 states in four layouts. [Resize checks](review/sizes.png) cover the 110 and 190 dp tiles and the 330 × 100 dp wide layout. The [scene thumbnails](review/thumbs.png), [flame scales](review/flames.png) and [launcher mockups](review/home.png) show the individual assets in context. Each mock phone occupies 1080 × 2340 pixels. All copy, launcher icons and plan notes on these sheets are review fixtures.
