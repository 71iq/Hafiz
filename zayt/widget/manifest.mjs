import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { sharp, sha, save } from "../studio/common.mjs";
import { art, out, review, sceneName, spriteName } from "./paths.mjs";
import { inks } from "./scenes.mjs";
import { measure } from "./contrast.mjs";
import { blinks, nightPoses, stills } from "./sprites.mjs";

import { loopTiming, urgencyHalos, urgencyPoses } from "./urgency.mjs";

const read = (file) => fs.readFileSync(file);
const relative = (file) => path.relative(out, file).split(path.sep).join("/");
async function entry(file) {
  const data = read(file);
  const item = { path: relative(file), bytes: data.length, sha256: sha(data) };
  if (/\.(webp|png|svg)$/.test(file)) {
    const { width, height, space, hasAlpha } = await sharp(data).metadata();
    Object.assign(item, { width, height });
    if (file.endsWith(".webp")) {
      // Inspect the top-level image chunk, skipping VP8X and ALPH.
      let payload = "";
      for (let offset = 12; offset + 8 <= data.length; ) {
        const type = data.toString("ascii", offset, offset + 4),
          size = data.readUInt32LE(offset + 4);
        if (type === "VP8L" || type === "VP8 ") payload = type.trim();
        offset += 8 + size + (size % 2);
      }
      assert(payload && space === "srgb", file);
      Object.assign(item, { codec: payload, alpha: hasAlpha });
    }
  }
  return item;
}
export async function manifest(bounds, verifyOnly = false) {
  const clips = JSON.parse(read(path.join(out, "clips.json")));
  const spriteFiles = [...stills, ...nightPoses.map((n) => n + "_halo"), ...blinks.map((n) => n + "_blink")].map(
    spriteName,
  );
  for (const [clip, end, totalMs] of [
    ["done", "shimmer", 1600],
    ["done_halo", "shimmer_halo", 1600],
    ["turn", "milestone", 3000],
  ]) {
    const frames = clips[clip];
    assert.equal(frames.length, clip === "turn" ? 17 : 16);
    assert.equal(
      frames.reduce((sum, f) => sum + f.durationMs, 0),
      totalMs,
    );
    for (const [i, frame] of frames.entries()) {
      assert(frame.durationMs > 0);
      assert.equal(frame.file, spriteName(clip + "_" + String(i).padStart(2, "0")));
      spriteFiles.push(frame.file);
    }
    assert(read(path.join(art, frames.at(-1).file)).equals(read(path.join(art, spriteName(end)))));
  }
  const loops = JSON.parse(read(path.join(out, "loops.json")));
  const expectedLoops = [];
  for (const pose of urgencyPoses) {
    for (const key of urgencyHalos.includes(pose) ? [pose, pose + "_halo"] : [pose]) {
      const still = spriteName(key);
      spriteFiles.push(still);
      // Measure the opaque sprig and feet independently of the translucent halo and ground pool.
      const alpha = await sharp(read(path.join(art, still)))
        .extractChannel("alpha")
        .raw()
        .toBuffer();
      const first = Math.floor(alpha.findIndex((a) => a >= 192) / 600);
      const last = Math.floor(alpha.findLastIndex((a) => a >= 192) / 600);
      assert(Math.abs(first - 120) <= 1 && last === 703, key + " differs from the standing registration");
      const timing = loopTiming[pose];
      if (!timing) continue;
      expectedLoops.push(key);
      const frames = loops[key];
      assert.deepEqual(
        frames.map((f) => f.durationMs),
        timing,
        key,
      );
      const total = timing.reduce((sum, ms) => sum + ms, 0);
      assert(frames.length >= 3 && frames.length <= 5 && total >= 2000 && total <= 4000, key);
      assert(timing[0] > total / 2, key + " must hold its poster for most of the loop");
      const drawings = new Set();
      for (const [i, f] of frames.entries()) {
        assert.equal(f.file, spriteName(key + "_loop_" + String(i).padStart(2, "0")));
        const data = read(path.join(art, f.file));
        if (i === 0) assert(data.equals(read(path.join(art, still))), key + " first frame differs");
        drawings.add(sha(data));
        spriteFiles.push(f.file);
      }
      assert.equal(drawings.size, frames.length, key + " duplicate drawing");
    }
  }
  assert.deepEqual(Object.keys(loops).sort(), expectedLoops.sort());
  const scenes = {},
    files = [];
  for (const [scene, colors] of Object.entries(inks)) {
    const crops = {};
    for (const [crop, w, h] of [
      ["sq", 900, 900],
      ["wide", 1500, 600],
    ]) {
      const file = path.join(art, sceneName(scene, crop)),
        item = await entry(file);
      assert.deepEqual([item.width, item.height, item.alpha, item.codec], [w, h, false, "VP8"]);
      const rgb = await sharp(read(file)).removeAlpha().raw().toBuffer();
      const contrast = measure(rgb, w, h, crop, colors, bounds[scene][crop]);
      assert(
        contrast.primary.ratio >= 7 && contrast.secondary.ratio >= 4.5,
        scene + " " + crop + " " + JSON.stringify(contrast),
      );
      crops[crop] = { file: item.path, contrast };
      files.push(item);
    }
    scenes[scene] = {
      inkPrimary: colors[0],
      inkSecondary: colors[1],
      minimumContrast: {
        primary: Math.min(crops.sq.contrast.primary.ratio, crops.wide.contrast.primary.ratio),
        secondary: Math.min(crops.sq.contrast.secondary.ratio, crops.wide.contrast.secondary.ratio),
      },
      crops,
    };
  }
  for (const name of spriteFiles) {
    const item = await entry(path.join(art, name));
    assert.deepEqual(
      [item.width, item.height, item.alpha, item.codec],
      [600, 720, true, name.endsWith("_blink.webp") ? "VP8L" : "VP8"],
    );
    files.push(item);
  }
  assert.deepEqual(fs.readdirSync(art).sort(), files.map((f) => path.basename(f.path)).sort());
  for (const pose of blinks) {
    const raw = async (n) =>
      sharp(read(path.join(art, spriteName(n))))
        .ensureAlpha()
        .raw()
        .toBuffer();
    const base = await raw(pose),
      blink = await raw(pose + "_blink"),
      changed = [0, 0];
    for (let i = 0; i < base.length; i += 4) {
      if (base.readUInt32LE(i) === blink.readUInt32LE(i)) continue;
      const x = (i / 4) % 600,
        y = Math.floor(i / 2400),
        side = Number(x >= 300);
      assert(y >= 488 && y <= 541 && Math.abs(x - (side ? 367 : 233)) < 28, "Blink changed outside eyes: " + pose);
      assert.equal(base[i + 3], blink[i + 3]);
      changed[side]++;
    }
    assert(
      changed.every((n) => n > 100),
      pose + " blink must change both eyes",
    );
  }
  const icons = ["out", "unlit", ...Array.from({ length: 7 }, (_, i) => "lit_t" + i)].map((s) => "flame_" + s + ".svg");
  assert.deepEqual(fs.readdirSync(path.join(out, "flame")).sort(), icons.slice().sort());
  for (const icon of icons) {
    const file = path.join(out, "flame", icon),
      item = await entry(file);
    assert.deepEqual([item.width, item.height], [24, 24]);
    const svg = read(file).toString();
    assert(svg.includes('viewBox="0 0 24 24"') && !/<(?:filter|mask|text|image)|stroke=/.test(svg));
    files.push(item);
  }
  files.push(await entry(path.join(out, "clips.json")), await entry(path.join(out, "loops.json")));
  assert.deepEqual(
    fs
      .readdirSync(out)
      .filter((n) => n !== "manifest.json")
      .sort(),
    ["clips.json", "flame", "loops.json", "res"],
  );
  const reviewFiles = [];
  for (const name of ["states", "states-ar", "day", "thumbs", "flames", "home", "sizes", "ladder", "faces", "loops"]) {
    reviewFiles.push(await entry(path.join(review, name + ".png")));
  }
  const manifestFile = { path: "manifest.json", bytes: 0 };
  files.push(manifestFile);
  const result = {
    schemaVersion: 1,
    baseStudioCommit: "278afa4b38f036980358c656a9090526f4fc6aaa",
    runtimeBudgetBytes: 4500000,
    runtimeBytes: 0,
    spriteCanvas: { width: 600, height: 720, feetBaselineY: 704 },
    idleBlinkClosedMs: 250,
    scenes,
    files: files.sort((a, b) => (a.path < b.path ? -1 : 1)),
    reviewFiles,
  };
  let encoded;
  do {
    result.runtimeBytes = files.reduce((sum, f) => sum + f.bytes, 0);
    encoded = Buffer.from(JSON.stringify(result, null, 2) + "\n");
    if (manifestFile.bytes === encoded.length) break;
    manifestFile.bytes = encoded.length;
  } while (true);
  assert(result.runtimeBytes <= result.runtimeBudgetBytes, "Widget files exceed budget: " + result.runtimeBytes);
  const output = path.join(out, "manifest.json");
  if (verifyOnly) assert(read(output).equals(encoded), "Manifest differs from independently measured files");
  else save(output, encoded);
  console.log(
    result.files.length +
      " runtime files, " +
      result.runtimeBytes +
      " bytes; all contrast, clip, loop and blink checks passed.",
  );
  return result;
}
