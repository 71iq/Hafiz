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

For the v4 set, render and encode `pilot` for the two A07 milestone variants. Follow with `A04-S A06-S A08-S`, then `A06-M A15-M-light A15-M-dark`, then `A17-S` for the review-only tap. The other clips and the posters carry over from v3.1. Use `all` to rebuild the entire catalogue. The audit reads capture records for every job, so use the full render on a fresh cache.

```sh
node repro.mjs A06-S
node sheets.mjs pilot && node sheets.mjs all
node sheets.mjs poses all
node gallery.mjs && node gallery-check.mjs
node audit.mjs
node review-metrics.mjs
```

`audit.mjs` checks the vendored v4 manifest. Set `ZAYT_MANIFEST=/path/to/animations.json` to compare it with the reviewed source. If a runtime clip exceeds its cap, run `node options.mjs <job-key>` before the audit to measure the alternatives. A01 S also serves as A02's poster. Do not copy it to another path. `review-metrics.mjs` measures colour and exterior alpha in the decoded candidate files. It reports source-pixel coordinates for each colour sample and compares the eye ink in protected frames with the closed blink.

## Change the art

`model.mjs` owns the lathed drop, forked twig, leaves, rounded arms and feet. The arm surface follows a spline from inside the shoulder to the rounded hand tip. `oil.mjs` owns the reflections, caustic, light core and face. The shader paints the face on the front of the mesh. During a turn it moves out of sight with the body. The eye arc and the open smile can be timed separately as the face returns to rest. The torso cannot pitch. The frontal orthographic camera spans Y = −0.09 to 4.08. Never recenter a frame: the feet must register with the poster. `reference.mjs` crops only the printed comparison. There is no floor or contact shadow in any variant. The dark halo uses the body profile, not the leaves or a rectangular mask. Its width stays fixed in world space across tiers.

Change a beat in `poses.mjs`, then update its peak times there for the contact sheet. Timelines are functions of sample time. There are no accumulated spring steps, wall-clock uniforms or unseeded motes. The start and hold are rendered independently and checked against the masters. The jump height is a fraction of the oil body height without the twig. The cheer reaches diagonally out from the shoulders. The sparkles travel out from the upper body in both variants. A15 adds five rising motes. The dark spill follows the torso during the peak and fades before the hold. Use `ZAYT_WORK` for a second external frame tree during a comparison.

`capture.mjs` takes a 2× RGBA readback and box-filters four samples in premultiplied alpha, then restores straight-alpha sRGB. `encode.mjs` allocates whole milliseconds across nominal samples, including the first and last. It uses mixed libwebp frames, effort 6 and merged holds. For A15, coverage above 208 in intermediate frames is rounded to within two alpha levels before lossless alpha encoding. Edges below that threshold and both endpoints keep their original coverage. Most clips use the 9/17 keyframe interval. `patch-codec.mjs` encodes the three light effects: it tracks a bounded per-pixel difference against the previous **written** canvas. A source rectangle replaces a region outright; a sparse lossless patch blends only opaque changes. This prevents rectangular trails in slow gradients. Posters use the final master and quality 87. If changing anything in the toolchain, repeat the pixel-hash test before comparing new renders.
