# Zayt render studio

Open the [gallery](../animations/gallery.html) from disk. Start at actual size, choose a surface, then press Replay. The enlarged view and the two card placements can borrow the same player. The other images stay still. The [acceptance checks](../animations/acceptance.md) record what passed, what did not and what needs an owner decision. Review-only files are not runtime candidates.

## Set up the offline renderer

On x86-64 Linux, use Node **24.18.0**. From the repository root run `node zayt/studio/setup.mjs`. Setup is the only step that downloads anything. It installs the locked studio packages and checksum-verified libwebp release in `~/.cache/hafiz-zayt-studio`, never in `zayt/`. Set `ZAYT_CACHE` to use a different external directory. Raw 2× masters, downsampled straight-alpha PNGs, alternate encodes and trial logs stay there too.

The pinned stack is Playwright **1.60.0**, Chromium headless shell **148.0.7778.96**, revision **1223**, Three.js **0.180.0**, esbuild **0.25.12**, sharp **0.35.5**, libvips **8.18.7** and libwebp **1.6.0**. The headless shell uses `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. On this host its shared libraries are in `/home/ehab/.local/share/elpsy-browser-runtime/root/usr/lib/x86_64-linux-gnu`; override with `ZAYT_LD_LIBRARY_PATH` when necessary. Each capture checks for WebGL2 and SwiftShader. One command opens one browser and renders serially. No Python, Blender, server, system encoder or app build is required.

## Re-render

```sh
cd zayt/studio
node reference.mjs
node render.mjs A04-S && node encode.mjs A04-S
node sheets.mjs A04-S
```

For a full run use `node render.mjs all && node encode.mjs all`. To repeat the approval order instead, render and encode `pilot`, then the remaining P0 entries `A01-S A02-S A08-S A10-S A11-S`, then `A06-M A10-M A15-M-dark`, then `A01-M A01-L P2`. The P0 and P1 selections also include the already produced pilot files. Do not launch different jobs against the same frame directory at the same time.

```sh
node repro.mjs A06-S
node options.mjs A02-S
node sheets.mjs pilot && node sheets.mjs all
node gallery.mjs && node gallery-check.mjs
node audit.mjs
```

`audit.mjs` checks the vendored v3 `animations.json`. Pass `ZAYT_MANIFEST=/path/to/animations.json` to compare with the separately reviewed source. The audit expects a measured option for each over-cap file and a completed independent recapture. A01 S is A02's poster; do not copy it to another path. Runtime vs review comes from the manifest, not from the tier folder.

## Change the art

`model.mjs` owns the lathed drop, forked matte twig, folded leaf blades, capsule arms and oval feet. `oil.mjs` owns the studio reflection map, oil shading, caustic and body-projected face. The face only exposes eye opening and size, brow placement, smile curvature, blush and highlight. The torso cannot pitch. The camera is frontal and orthographic, from Y = −0.09 to 4.08. Tier width follows the exact manifest aspect. Do not recenter a cropped frame: the feet and the hold must register with the poster. `reference.mjs` crops only the printed side-by-side, not a runtime image. Non-glow exports use a common, shadow-free plate so it cannot leave a brown patch on black. The light-specific plates have a soft warm contact shadow; dark plates do not.

Change a beat in `poses.mjs`, then update its peak times there for the contact sheet. Timelines are functions of sample time. There are no accumulated spring steps, wall-clock uniforms or unseeded motes. The canonical start and hold are rendered independently and checked against the masters. The A02 budget variant keeps the face anchored while the upper body lengthens and the lower body widens. Dark glows use the approved short exterior bloom and smaller spill. Set `ZAYT_LEVEL=1`, `2` or `3` to compare the ladder. Use `ZAYT_WORK` for a second external frame tree during a comparison.

`capture.mjs` takes a 2× RGBA readback and box-filters four samples in premultiplied alpha, then restores straight-alpha sRGB. `encode.mjs` allocates whole milliseconds across nominal samples, including the first and last. It uses mixed libwebp frames, effort 6, lossless alpha and merged holds. Most clips use the 9/17 keyframe interval. `patch-codec.mjs` encodes the three light effects: it tracks a bounded per-pixel difference against the previous **written** canvas. A source rectangle replaces a region outright; a sparse lossless patch blends only opaque changes. This prevents rectangular trails in slow gradients. Posters use the final master and quality 87. If changing anything in the toolchain, repeat the pixel-hash test before comparing new renders.
