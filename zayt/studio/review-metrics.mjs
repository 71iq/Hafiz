import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { jobs, out, cache, sharp, frameDir, json } from "./common.mjs";
import { camera } from "./capture.mjs";
import { decode, nominal } from "./decoded.mjs";

const round = (value) => Number(value.toFixed(2));
const get = (key) => jobs.find((job) => job.key === key);
const media = (key) => decode(path.join(out, get(key).media));
const capture = (key) => JSON.parse(fs.readFileSync(path.join(frameDir(get(key)), "capture.json")));
function colour(frame, width, col, row) {
  const rgb = frame.subarray((row * width + col) * 4, (row * width + col) * 4 + 3),
    [red, green, blue] = rgb;
  const max = Math.max(...rgb),
    min = Math.min(...rgb),
    span = max - min;
  const sector =
    max === red ? (green - blue) / span : max === green ? 2 + (blue - red) / span : 4 + (red - green) / span;
  return {
    col,
    row,
    rgb: "#" + rgb.toString("hex"),
    h: span ? round((sector * 60 + 360) % 360) : 0,
    s: round((span * 100) / max),
    v: round((max * 100) / 255),
  };
}
const rowAt = (height, y) => Math.round(((4.08 - y) * height) / 4.17 - 0.5);
const colAt = (width, height, x) => Math.round(width / 2 + (x * height) / 4.17 - 0.5);
function samplePoint(d, frame, x, y) {
  return colour(frame, d.width, colAt(d.width, d.height, x), rowAt(d.height, y));
}
function outside(base, pixels, width, minRow = 0) {
  let peak = 0,
    count = 0;
  for (let off = minRow * width * 4 + 3; off < base.length; off += 4)
    if (!base[off] && pixels[off]) {
      count++;
      peak = Math.max(peak, pixels[off]);
    }
  return { peak, count };
}
function reach(base, pixels, width, height, minRow) {
  const radius = Math.ceil((height * 12) / 216) + 2;
  let furthest = 0;
  for (let row = minRow; row < height; row++)
    for (let col = 0; col < width; col++) {
      const offset = (row * width + col) * 4 + 3;
      if (base[offset] || !pixels[offset]) continue;
      let nearest = Infinity;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          if (
            col + dx >= 0 &&
            col + dx < width &&
            row + dy >= 0 &&
            row + dy < height &&
            base[((row + dy) * width + col + dx) * 4 + 3]
          )
            nearest = Math.min(nearest, dx * dx + dy * dy);
        }
      furthest = Math.max(furthest, Math.sqrt(nearest));
    }
  assert.ok(Number.isFinite(furthest));
  return round(furthest);
}
const report = { rest: {}, glow: {}, blinks: {}, gestures: {}, motes: {}, band: {} };
const rest = await media("A01-L");
for (const [name, x, y] of [
  ["centre", 0, 1.21],
  ["left", -0.775, 1.21],
  ["right", 0.775, 1.21],
  ["tip", 0, 2.66],
  ["caustic", 0.57, 0.46],
])
  report.rest[name] = samplePoint(rest, rest.frames[0], x, y);
assert.ok(Math.abs(report.rest.centre.v - 88) < 2);
for (const flank of [report.rest.left, report.rest.right]) assert.ok(flank.v >= 80 && flank.s >= 88);
const across = [];
for (let col = 0; col < rest.width; col++) {
  if (rest.frames[0][(report.rest.centre.row * rest.width + col) * 4 + 3] >= 128)
    across.push(colour(rest.frames[0], rest.width, col, report.rest.centre.row));
}
const sub80 = across.filter((p) => p.v < 80);
report.rest.flankScan = {
  row: report.rest.centre.row,
  first: across[0].col,
  last: across.at(-1).col,
  sub80Columns: sub80.map((p) => p.col),
};
assert.ok(sub80.every((p) => Math.min(p.col - across[0].col, across.at(-1).col - p.col) < 0.06 * across.length));
// Render the same moving body and sparks without the halo. A rest-pose
// outline would count the squash, raised arms and sparkles as stray light.
const barePeak = {};
await camera(async (render) => {
  for (const key of ["A07-S-light", "A15-M-light"]) {
    const job = get(key);
    const pose = capture(key).poses.find((p) => p.halo === 1);
    const file = path.join(cache, "reference", job.id + "-no-spill.png");
    await render(job.size, { ...pose, halo: 0 }, { variant: "light" }, null, file);
    barePeak[job.id] = await sharp(file).ensureAlpha().raw().toBuffer();
  }
});
for (const key of ["A07-S-light", "A07-S-dark", "A15-M-light", "A15-M-dark"]) {
  const job = get(key),
    d = await media(key),
    base = (await media("A01-" + job.tier)).frames[0],
    poses = capture(key).poses;
  const peakIndex = poses.findIndex((p) => p.halo === 1),
    peak = nominal(d, job, peakIndex),
    hold = d.frames.at(-1);
  const atBodyPoint = (x, y) =>
    samplePoint(
      d,
      peak,
      x * poses[peakIndex].width,
      y * poses[peakIndex].height + 0.19 * (1 - poses[peakIndex].height) + poses[peakIndex].root[1],
    );
  const core = atBodyPoint(0.025, 1.18),
    edge = atBodyPoint(0.775, 1.21);
  const light = await media(key.replace("dark", "light")),
    silhouette = barePeak[job.id];
  const spill = outside(silhouette, peak, d.width),
    holdExterior = outside(base, hold, d.width),
    posterExterior = outside(base, (await decode(path.join(out, job.poster))).frames[0], d.width);
  const extent = reach(silhouette, peak, d.width, d.height, 0);
  let offWindowMax = 0;
  for (const [index, pose] of poses.entries()) {
    if (!pose.halo)
      offWindowMax = Math.max(offWindowMax, outside(nominal(light, job, index), nominal(d, job, index), d.width).peak);
  }
  assert.ok(offWindowMax <= 2, key + " exterior alpha outside peak window: " + offWindowMax);
  report.glow[key] = {
    peakIndex,
    core,
    edge,
    spill,
    reachPx: extent,
    offWindowMax,
    holdExterior,
    posterExterior,
    holdCore: samplePoint(d, hold, 0.025, 1.18),
  };
  assert.ok(core.h >= 44 && core.h <= 48, JSON.stringify(core));
  assert.equal(holdExterior.count + posterExterior.count, 0, key + " hold coverage");
  if (job.variant === "dark")
    assert.ok(
      spill.peak >= 64 && spill.peak <= 76 && extent <= (12 * d.height) / 216,
      key + " " + JSON.stringify({ spill, extent }),
    );
  else assert.equal(spill.count, 0);
}
for (const key of ["A07-S-light", "A15-M-light", "A10-S", "A11-S", "A19-L"]) {
  const job = get(key),
    poses = capture(key).poses,
    decoded = await media(key);
  const edge = (index) => Math.round((index * job.seconds * 1000) / poses.length);
  const closed = poses.flatMap((pose, index) => (pose.face.eyeOpen === 0 && pose.opacity > 0 ? [index] : []));
  const protectedFrames = poses.flatMap((p, i) =>
    (p.sit === 1 || p.glow >= 0.999 || p.motes.some((v) => v > 0 && v < 1) || (job.id === "A19" && p.root[1] === 0)) &&
    !p.face.joy
      ? [i]
      : [],
  );
  const eyeRows = (i) => {
    const p = poses[i],
      pixels = nominal(decoded, job, i),
      screenY = 1.096 * p.height + 0.19 * (1 - p.height) - 0.177 * p.sit + p.root[1];
    const cx = colAt(decoded.width, decoded.height, 0.39 * p.width),
      cy = rowAt(decoded.height, screenY),
      radius = Math.ceil((0.11 * decoded.height) / 4.17);
    let rows = 0;
    for (let y = cy - radius; y <= cy + radius; y++) {
      let ink = 0;
      for (let x = cx - radius; x <= cx + radius; x++) {
        const off = (y * decoded.width + x) * 4;
        if (pixels[off] < 141 && pixels[off + 1] < 100 && pixels[off + 3] > 180) ink++;
      }
      if (ink >= 2) rows++;
    }
    return rows;
  };
  const protectedInk = protectedFrames.map(eyeRows);
  report.blinks[key] = {
    closedFromMs: edge(closed[0]),
    openTransitionFromMs: edge(closed.at(-1) + 1),
    protectedFrames: protectedFrames.length,
    minProtectedEyeInkRows: protectedInk.length ? Math.min(...protectedInk) : null,
    maxClosedEyeInkRows: Math.max(...closed.map(eyeRows)),
    forbiddenOverlaps: protectedFrames.filter((i) => poses[i].face.eyeOpen < 1).length,
  };
  if (protectedInk.length)
    assert.ok(
      Math.min(...protectedInk) > (0.1 * decoded.height) / 4.17,
      key + " closed eye in decoded protected frame",
    );
  assert.equal(report.blinks[key].forbiddenOverlaps, 0);
}
const wave = capture("A04-S").poses,
  lift = capture("A08-S").poses;
const sway = wave.flatMap((p, i) =>
  (i * 2) / (wave.length - 1) >= 0.85 && (i * 2) / (wave.length - 1) <= 1.55 ? [p.arms[0] - 90] : [],
);
report.gestures = {
  sampledWaveDegrees: sway.map(round),
  liftDegrees: lift.map((p) => round(p.leaf)),
  peakWidth: Math.max(...lift.map((p) => p.width)),
  armLift: round(Math.max(...lift.map((p) => p.arms[1])) - 29),
  chestTipWorld: [0.003, 0.84],
  shoulderWorld: [-0.77, 0.69],
  mouthCentreWorld: [0, 0.925],
};
const moteClip = await media("A15-M-light"),
  moteJob = get("A15-M-light"),
  motePoses = capture(moteJob.key).poses;
const crestIndex = motePoses.findIndex((p) => p.motes[2] > 0.46),
  crest = nominal(moteClip, moteJob, crestIndex);
const topOfLeaves = (await media("A01-M")).frames[0].findIndex((v, i) => i % 4 === 3 && v > 0),
  leafRow = Math.floor(topOfLeaves / (4 * moteClip.width));
let maximum = 0,
  location;
// Ignore the leaf spring below the motes while it settles after landing.
for (let row = 0; row < Math.min(leafRow, rowAt(moteClip.height, 3.55)); row++)
  for (let col = 0; col < moteClip.width; col++) {
    const alpha = crest[(row * moteClip.width + col) * 4 + 3];
    if (alpha > maximum) {
      maximum = alpha;
      location = [col, row];
    }
  }
const [col, row] = location,
  alphaAt = (x) => crest[(row * moteClip.width + x) * 4 + 3];
function chord(threshold) {
  let lo = col,
    hi = col;
  while (lo > 0 && alphaAt(lo - 1) >= threshold) lo--;
  while (hi + 1 < moteClip.width && alphaAt(hi + 1) >= threshold) hi++;
  return hi - lo + 1;
}
report.motes = {
  tracks: Math.max(...motePoses.map((p) => p.motes.length)),
  sample: crestIndex,
  peakAlpha: maximum,
  colour: colour(crest, moteClip.width, col, row),
  diameterAt95Pct: chord(0.95 * maximum),
  diameterAt1Alpha: chord(1),
  leafTopRow: leafRow,
};
assert.ok(report.motes.diameterAt95Pct >= 2 && report.motes.diameterAt95Pct <= 3);
const bandJob = get("A06-S"),
  band = await media(bandJob.key),
  bandPoses = capture(bandJob.key).poses;
for (const [name, target] of [
  ["belowFace", 0.58],
  ["atFace", 1.18],
  ["aboveFace", 1.72],
]) {
  const index = bandPoses.reduce(
      (best, p, i) => (Math.abs(p.sweep - target) < Math.abs(bandPoses[best].sweep - target) ? i : best),
      0,
    ),
    y = bandPoses[index].sweep;
  const pose = bandPoses[index];
  report.band[name] = {
    index,
    ...samplePoint(band, nominal(band, bandJob, index), 0, y * pose.height + 0.19 * (1 - pose.height) + pose.root[1]),
  };
  assert.ok(report.band[name].h >= 46 && report.band[name].h <= 50, name + " band hue");
}
json(path.join(out, "review-metrics.json"), report);
console.log(JSON.stringify(report, null, 2));
