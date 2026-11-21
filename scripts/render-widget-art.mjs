// Source: the Zayt v4 studio gallery, commit 278afa4b. Pass its zayt/animations directory.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = process.argv[2];
if (!source) throw new Error("Pass the Zayt v4 studio's zayt/animations directory.");
const res = fileURLToPath(new URL("../android/app/src/main/res/", import.meta.url));
const art = path.join(res, "drawable-nodpi");
await mkdir(art, { recursive: true });

async function readClip(stem) {
  const input = sharp(path.join(source, "S", stem + ".webp"), { animated: true });
  const { width, pageHeight: height, delay } = await input.metadata();
  const pixels = await input.ensureAlpha().raw().toBuffer();
  const stride = width * height * 4;
  return async (ms, name) => {
    let end = 0;
    const index = delay.findIndex((duration) => (end += duration) > ms);
    if (index < 0) throw new Error(stem + " has no frame at " + ms);
    await sharp(pixels.subarray(index * stride, (index + 1) * stride), { raw: { width, height, channels: 4 } })
      .resize({ width: 144 })
      .webp({ quality: 86, alphaQuality: 100, effort: 6 })
      .toFile(path.join(art, "hafiz_widget_zayt_" + name + ".webp"));
  };
}
for (const [clip, ms, name] of [
  ["A04_welcome_wave", 900, "wave"],
  ["A06_wird_done_shimmer", 540, "shimmer"],
  ["A08_earned_back_steady", 1000, "rebound"],
]) {
  const frame = await readClip(clip);
  await frame(ms, name);
}

// Sample the anticipation, full turn, cheer and landing in the original fixed camera.
// The last animation frame is also the static milestone illustration.
const milestone = await readClip("A07_milestone_glow_light");
const samples = [0, 125, 250, 333, 417, 500, 583, 667, 750, 833, 958, 1083, 1167, 1250, 1333, 1417, 1500];
const frames = [];
for (const [i, ms] of samples.entries()) {
  const name = i === samples.length - 1 ? "milestone" : "turn_" + i.toString().padStart(2, "0");
  await milestone(ms, name);
  const duration = (samples[i + 1] ?? 1600) - ms;
  frames.push(`    <item android:drawable="@drawable/hafiz_widget_zayt_${name}" android:duration="${duration}"/>`);
}
await writeFile(
  path.join(res, "drawable", "hafiz_widget_milestone_motion.xml"),
  '<?xml version="1.0" encoding="utf-8"?>\n<animation-list xmlns:android="http://schemas.android.com/apk/res/android" android:oneshot="true">\n' +
    frames.join("\n") +
    "\n</animation-list>\n",
);
