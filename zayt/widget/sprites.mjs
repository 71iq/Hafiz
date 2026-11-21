import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { camera } from "../studio/capture.mjs";
import { bin, select, json, sharp, mkdir } from "../studio/common.mjs";
import { hold, rest, sample } from "../studio/poses.mjs";
import { art, out, spriteName } from "./paths.mjs";

import { loopTiming, urgencyDrawing, urgencyHalos, urgencyPoses } from "./urgency.mjs";

export const stills = ["rest", "warm", "wave", "glow", "open", "shimmer", "milestone", "sit"];
export const nightPoses = ["glow", "open", "warm", "shimmer"];
export const blinks = ["rest", "warm", "wave", "glow", "open", "glow_halo", "open_halo", "warm_halo"];
const size = [600, 720];
const job = (key) => select([key])[0];

function poster(name) {
  if (name === "rest") return rest();
  if (name === "sit") return hold("seated");
  if (name === "milestone") return hold(job("A07-S-light").hold);
  const pose = hold("warm_smile");
  if (name === "wave" || name === "open") {
    // Borrow the arm silhouette at full extension, with both feet planted and a closed smile.
    const gesture = name === "wave" ? sample(job("A04-S"), 1.37) : sample(job("A08-S"), 1.37);
    pose.arms = gesture.arms;
    pose.reach = gesture.reach;
    pose.leaf = gesture.leaf;
    pose.leafFollower = gesture.leafFollower;
  }
  if (name === "glow") pose.glow = 0.65;
  if (name === "shimmer") pose.sweep = 1.77;
  return pose;
}

// The pool belongs to the ground, including while the drop is airborne.
// Render behind the studio's body profile spill, which moves with the rig.
async function addPool(png) {
  const pool = Buffer.from(`<svg width="600" height="720" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="p"><stop stop-color="#ffce6b" stop-opacity=".67"/>
    <stop offset=".25" stop-color="#ffbd57" stop-opacity=".47"/>
    <stop offset=".65" stop-color="#ffa83b" stop-opacity=".15"/>
    <stop offset="1" stop-color="#ffa337" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="300" cy="681" rx="245" ry="37" fill="url(#p)"/></svg>`);
  await sharp(pool)
    .composite([{ input: png }])
    .png()
    .toFile(png + ".pool.png");
  return png + ".pool.png";
}

const doneTimes = [0, 110, 205, 275, 350, 405, 455, 510, 585, 700, 800, 945, 1050, 1165, 1390, 1500];
const turnTimes = [0, 175, 280, 350, 435, 535, 635, 740, 850, 1080, 1250, 1380, 1580, 1840, 2110, 2600, 2850];

export async function sprites(work) {
  mkdir(art);
  mkdir(work);
  const clips = {};
  const loops = {};
  await camera(async (capture) => {
    async function render(name, pose, halo, faceArt) {
      const file = path.join(work, name + ".png");
      if (halo) pose.halo = 1;
      await capture(size, pose, { variant: halo ? "dark" : "light", faceArt }, null, file);
      const input = halo ? await addPool(file) : file;
      execFileSync(path.join(bin, "cwebp"), [
        "-quiet",
        "-q",
        faceArt ? "86" : "94",
        "-alpha_q",
        faceArt ? "85" : "100",
        "-segments",
        "1",
        "-sns",
        "0",
        "-f",
        "0",
        "-m",
        "4",
        input,
        "-o",
        path.join(art, spriteName(name)),
      ]);
    }
    for (const name of [...stills, ...nightPoses.map((n) => n + "_halo"), ...blinks.map((n) => n + "_blink")]) {
      const pose = poster(name.split("_")[0]);
      if (name.endsWith("_blink")) pose.face.eyeOpen = 0;
      await render(name, pose, name.includes("_halo"));
    }
    for (const [clip, times, source, end] of [
      ["done", doneTimes, "A06-S", "shimmer"],
      ["done_halo", doneTimes, "A06-S", "shimmer_halo"],
      ["turn", turnTimes, "A07-S-light", "milestone"],
    ]) {
      const animation = job(source);
      const duration = Math.round(animation.seconds * 1000);
      clips[clip] = [];
      for (const [index, ms] of times.entries()) {
        const name = clip + "_" + String(index).padStart(2, "0");
        if (index === times.length - 1) {
          fs.copyFileSync(path.join(art, spriteName(end)), path.join(art, spriteName(name)));
        } else {
          const pose = sample(animation, ms / 1000);
          // Let the travelling band settle at the level of the requested lit hold.
          if (source === "A06-S" && ms >= 450)
            pose.sweep = Math.min(poster("shimmer").sweep, -0.24 + 3.45 * ((ms - 450) / 600));
          await render(name, pose, clip.endsWith("_halo"));
        }
        clips[clip].push({ file: spriteName(name), durationMs: (times[index + 1] ?? duration) - ms });
      }
    }
    for (const name of urgencyPoses) {
      for (const halo of urgencyHalos.includes(name) ? [false, true] : [false]) {
        const key = halo ? name + "_halo" : name;
        const still = urgencyDrawing(name);
        await render(key, still.pose, halo, still.faceArt);
        if (!loopTiming[name]) continue;
        loops[key] = [];
        for (const [index, durationMs] of loopTiming[name].entries()) {
          const frame = key + "_loop_" + String(index).padStart(2, "0");
          if (index === 0) {
            fs.copyFileSync(path.join(art, spriteName(key)), path.join(art, spriteName(frame)));
          } else {
            const drawing = urgencyDrawing(name, index);
            await render(frame, drawing.pose, halo, drawing.faceArt);
          }
          loops[key].push({ file: spriteName(frame), durationMs });
        }
      }
    }
  });
  json(path.join(out, "loops.json"), loops);
  await lockBlinks(work);
  json(path.join(out, "clips.json"), clips);
}

// VP8 intra prediction can carry a changed eye into untouched blocks below it.
// Keep the lossy decoded pose and two lossy eye patches, then store their exact
// composite with VP8L. Android can swap these independent single-frame bitmaps.
async function lockBlinks(work) {
  const [width, height] = size;
  const raw = async (file) => sharp(fs.readFileSync(file)).ensureAlpha().raw().toBuffer();
  for (const pose of blinks) {
    const blink = pose + "_blink";
    const source = await raw(path.join(work, pose + ".png"));
    const closed = await raw(path.join(work, blink + ".png"));
    const base = await raw(path.join(art, spriteName(pose)));
    const eyes = await raw(path.join(art, spriteName(blink)));
    for (const half of [0, 1]) {
      let left = width,
        right = -1,
        top = height,
        bottom = -1;
      for (let y = 0; y < height; y++) {
        for (let x = (half * width) / 2; x < ((half + 1) * width) / 2; x++) {
          const i = (y * width + x) * 4;
          if (source.readUInt32LE(i) === closed.readUInt32LE(i)) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      if (right < left || right - left > 44 || bottom - top > 44) throw Error("Blink moved outside an eye: " + pose);
      for (let y = top - 2; y <= bottom + 2; y++) {
        const start = (y * width + left - 2) * 4,
          end = (y * width + right + 3) * 4;
        eyes.copy(base, start, start, end);
      }
    }
    const master = path.join(work, blink + ".registered.png");
    await sharp(base, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(master);
    const file = path.join(art, spriteName(blink));
    execFileSync(path.join(bin, "cwebp"), ["-quiet", "-lossless", "-exact", "-m", "6", master, "-o", file]);
    if (!base.equals(await raw(file))) throw Error("Blink changed during packing: " + blink);
  }
}
