import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { cache, out, jobs, frameDir, nameFrame, sharp, sha, save, json, surfaces, manifest } from "./common.mjs";
import { decode, nominal, bounds } from "./decoded.mjs";
import { cap } from "./encode.mjs";

const read = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts)));
const reference = process.env.ZAYT_MANIFEST;
if (reference) assert.deepEqual(manifest, read(reference));
const rows = [],
  audits = [],
  tools = read(cache, "tools.json"),
  round = (value) => Number(value.toFixed(3));
const display = { S: 72, M: 128, L: 200 },
  checks = (value, message) => assert.ok(value, message);
function row(job, file, kind, d, limit) {
  return {
    path: file,
    role: job.role,
    kind,
    tier: job.tier,
    variant: job.variant || "shared",
    dimensions: [d.width, d.height],
    nominalSamples: kind === "animation" ? job.nominal_samples : 1,
    encodedFrames: d.frames.length,
    milliseconds: d.total,
    loopCount: d.loops,
    alpha: d.alpha,
    bytes: d.bytes.length,
    cap: job.role === "runtime" ? limit : null,
    sha256: sha(d.bytes),
  };
}
function pixelErrors(source, target) {
  const histogram = new Uint32Array(256);
  let square = 0,
    count = 0;
  for (let o = 0; o < source.length; o += 4) {
    const a = source[o + 3],
      b = target[o + 3];
    if (!Math.max(a, b)) continue;
    for (let ch = 0; ch < 3; ch++) {
      const delta = (source[o + ch] * a - target[o + ch] * b) / 255,
        error = Math.round(Math.max(Math.abs(delta), Math.abs(delta + b - a)));
      histogram[error]++;
      square += error * error;
      count++;
    }
  }
  let total = 0,
    p99 = 0;
  for (let n = 0; n < 256; n++) {
    total += histogram[n];
    if (total >= count * 0.99) {
      p99 = n;
      break;
    }
  }
  return { rms: round(Math.sqrt(square / (count || 1))), p99 };
}
function compositeAudit(job, d) {
  let minX = d.width,
    minY = d.height,
    maxX = -1,
    maxY = -1;
  const surfaceEvidence = [];
  for (const pixels of d.frames) {
    const b = bounds(pixels, d.width, d.height);
    if (!b) continue;
    minX = Math.min(b[0], minX);
    minY = Math.min(b[1], minY);
    maxX = Math.max(b[2], maxX);
    maxY = Math.max(b[3], maxY);
  }
  checks(minX > 0 && minY > 0 && maxX + 1 < d.width && maxY + 1 < d.height, job.key + " clips");
  for (const bg of surfaces) {
    const color = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
    const hashParts = [];
    const rgb = Buffer.alloc(d.width * d.height * 3);
    for (const pixels of d.frames) {
      for (let o = 0, dst = 0; o < pixels.length; o += 4, dst += 3) {
        const a = pixels[o + 3];
        for (let ch = 0; ch < 3; ch++) rgb[dst + ch] = Math.round((pixels[o + ch] * a + color[ch] * (255 - a)) / 255);
      }
      hashParts.push(sha(rgb));
    }
    surfaceEvidence.push({ surface: bg, decodedCompositeHash: sha(hashParts.join("\n")) });
  }
  const scale = display[job.tier] / d.height,
    box = [minX, minY, maxX, maxY],
    screenH = display[job.tier],
    screenW = Math.round(screenH * 0.8);
  const scanLeft = new Int32Array(screenH).fill(screenW),
    scanRight = new Int32Array(screenH).fill(-1);
  for (const rgba of d.frames)
    for (let y = 0; y < d.height; y++) {
      let lo = d.width,
        hi = -1;
      for (let x = 0; x < d.width; x++)
        if (rgba[(y * d.width + x) * 4 + 3]) {
          lo = Math.min(lo, x);
          hi = x;
        }
      if (hi < 0) continue;
      for (
        let row = Math.max(0, Math.floor(y * scale) - 2);
        row <= Math.min(screenH - 1, Math.ceil((y + 1) * scale) + 2);
        row++
      ) {
        scanLeft[row] = Math.min(scanLeft[row], Math.max(0, Math.floor((lo * screenW) / d.width) - 2));
        scanRight[row] = Math.max(scanRight[row], Math.min(screenW - 1, Math.ceil(((hi + 1) * screenW) / d.width) + 2));
      }
    }
  const pixels = scanRight.reduce((sum, right, row) => sum + Math.max(0, right - scanLeft[row] + 1), 0);
  checks(pixels < 21824, job.key + " needs temporal flash analysis");
  return {
    alphaBounds: box,
    minimumMarginPx: Math.min(minX, minY, d.width - 1 - maxX, d.height - 1 - maxY),
    maxSlotPt: display[job.tier],
    conservativeFlashAreaPx: pixels,
    referenceAreaLimitPx: 21824,
    surfaceEvidence,
  };
}
async function slotDifferences(job, decoded, poster) {
  const background = job.variant === "dark" ? surfaces[6] : surfaces[0];
  const atSlot = (pixels) =>
    sharp(pixels, { raw: { width: decoded.width, height: decoded.height, channels: 4 } })
      .flatten({ background })
      .resize(45, 56, { fit: "fill" })
      .raw()
      .toBuffer();
  const hold = await atSlot(poster),
    changedPixels = [];
  for (let column = 0; column < 5; column++) {
    const index = Math.round((column * (job.nominal_samples - 1)) / 4);
    const sample = await atSlot(nominal(decoded, job, index));
    let changed = 0;
    for (let offset = 0; offset < sample.length; offset += 3) {
      if ([0, 1, 2].some((channel) => Math.abs(sample[offset + channel] - hold[offset + channel]) >= 24)) changed++;
    }
    changedPixels.push(changed);
  }
  return { width: 45, height: 56, background, channelThreshold: 24, changedPixels };
}
for (const job of jobs) {
  const moving = job.mode !== "still",
    d = await decode(path.join(out, job.media)),
    dir = frameDir(job),
    capture = read(dir, "capture.json");
  assert.deepEqual([d.width, d.height], job.size);
  checks(d.alpha, job.key + " missing alpha");
  assert.equal(d.total, Math.round((job.seconds || 0) * 1000));
  assert.equal(job.nominal_samples, moving ? Math.round(job.seconds * manifest.fps) : 1);
  assert.equal(d.loops, moving ? (job.id === "A02" ? 2 : 1) : 0);
  assert.ok(d.durations.every((ms) => ms > 0));
  assert.equal(capture.hashes.length, job.nominal_samples);
  assert.equal(capture.hashes[0], capture.declared[0]);
  assert.equal(capture.hashes.at(-1), capture.declared[1]);
  if (job.id === "A02") assert.equal(capture.hashes[0], capture.hashes.at(-1));
  const sampleEdges = new Set(
    Array.from({ length: job.nominal_samples + 1 }, (_, index) => Math.round((index * d.total) / job.nominal_samples)),
  );
  let edge = 0;
  for (const ms of d.durations) {
    edge += ms;
    checks(sampleEdges.has(edge), job.key + " off-grid frame");
  }
  rows.push(row(job, job.media, moving ? "animation" : "still", d, cap(job, !moving)));
  let posterDelta = null,
    fiveSamplesVsPoster = null,
    posterSurfaces = null;
  if (moving) {
    const poster = await decode(path.join(out, job.poster));
    assert.deepEqual([poster.width, poster.height], job.size);
    checks(poster.alpha && poster.frames.length === 1, job.key + " poster metadata");
    posterDelta = pixelErrors(poster.frames[0], d.frames.at(-1));
    fiveSamplesVsPoster = await slotDifferences(job, d, poster.frames[0]);
    posterSurfaces = compositeAudit(job, poster).surfaceEvidence;
    if (job.id !== "A02") rows.push(row(job, job.poster, "poster", poster, cap(job, true)));
  }
  let worstRms = 0,
    worstP99 = 0,
    worstSample = 0;
  const closed = [];
  for (let n = 0; n < job.nominal_samples; n++) {
    const source = await sharp(path.join(dir, nameFrame(n)))
        .ensureAlpha()
        .raw()
        .toBuffer(),
      error = pixelErrors(source, nominal(d, job, n));
    if (error.rms > worstRms) {
      worstRms = error.rms;
      worstSample = n;
    }
    worstP99 = Math.max(worstP99, error.p99);
    const pose = capture.poses[n];
    if (pose.face.eyeOpen === 0) closed.push(n);
    assert.equal(pose.face.blush, 0.5);
    assert.equal(pose.face.browTilt, 0);
    assert.equal(pose.arms[1], 29);
    assert.ok(pose.root[1] === 0 || job.id === "A19");
    checks(Math.abs(pose.height - 1) <= 0.080001, job.key + " height");
    if (job.id === "A07" || job.id === "A15")
      if ((n * 0.99 * job.seconds) / (job.nominal_samples - 1) > 0.3) assert.equal(pose.face.mouthCurve, 1);
  }
  const closureMs = closed.reduce(
    (sum, n) =>
      sum + Math.round(((n + 1) * d.total) / job.nominal_samples) - Math.round((n * d.total) / job.nominal_samples),
    0,
  );
  checks(worstRms <= 6.5 && worstP99 <= 25, job.key + " decoded sample diverges from master");
  if (posterDelta)
    checks(posterDelta.rms <= 6 && posterDelta.p99 <= 20, job.key + " poster diverges from final sample");
  if (["A02", "A06", "A07", "A08", "A10", "A11", "A15"].includes(job.id))
    checks(closureMs >= 300 && closureMs <= 400, job.key + " slow blink duration");
  audits.push({
    key: job.key,
    masterSequence: capture.sequence,
    firstMaster: capture.hashes[0],
    lastMaster: capture.hashes.at(-1),
    posterPath: job.poster,
    posterDelta,
    fiveSamplesVsPoster,
    posterSurfaces,
    encodedVsMaster: { worstRms, worstP99, worstSample },
    fullyClosedMs: closureMs,
    ...compositeAudit(job, d),
  });
  console.log(job.key, worstRms, worstP99, posterDelta, audits.at(-1).conservativeFlashAreaPx);
}
assert.equal(new Set(rows.map((item) => item.path)).size, rows.length);
const runtime = rows.filter((item) => item.role === "runtime"),
  total = runtime.reduce((sum, r) => sum + r.bytes, 0);
const actual = ["S", "M", "L"].flatMap((tier) =>
  fs
    .readdirSync(path.join(out, tier))
    .filter((f) => f.endsWith(".webp"))
    .map((f) => tier + "/" + f),
);
assert.deepEqual(actual.sort(), rows.map((r) => r.path).sort());
assert.equal(
  rows.filter((r) => r.kind === "animation").sort((a, b) => a.bytes - b.bytes)[0].path,
  jobs.find((j) => j.key === "A06-S").media,
);
const overages = runtime.filter((r) => r.bytes > r.cap).map((r) => ({ path: r.path, over: r.bytes - r.cap }));
for (const excess of overages) {
  const job = jobs.find((j) => j.media === excess.path);
  excess.trials = read(cache, "trials", job.key + ".json");
  excess.options = read(cache, "options", job.key, "result.json");
}
const repro = read(cache, "repro.json");
const repeated = audits.find((a) => a.key === repro.key);
assert.equal(repeated.masterSequence, repro.second);
assert.equal(repro.first, repro.second);
const report = {
  manifestVersion: manifest.version,
  tools,
  runtimeBytes: total,
  runtimeCap: manifest.budget_bytes.runtime_total,
  runtimeFits: total <= manifest.budget_bytes.runtime_total,
  overages,
  files: rows,
  audits,
  repro,
};
json(path.join(out, "size-report.json"), report);
const table = rows
  .map(
    (r) =>
      `| ${r.path} | ${r.role} | ${r.variant} | ${r.dimensions.join("×")} | ${r.nominalSamples}/${r.encodedFrames} | ${r.milliseconds} | ${r.loopCount} | ${r.alpha ? "yes" : "no"} | ${r.bytes} | ${r.cap ?? "review"} | \`${r.sha256}\` |`,
  )
  .join("\n");
save(
  path.join(out, "size-report.md"),
  `# Zayt export sizes\n\nRuntime: **${total.toLocaleString("en-US")} / ${manifest.budget_bytes.runtime_total.toLocaleString("en-US")} bytes**. Individual files over cap: ${overages.length}. A01 S is the physical A02 poster; it is counted once. Review-only WebPs, reference artwork, contact sheets and the gallery are excluded from that total. For stills the container has no playback timeline or loop field; both are reported as zero.\n\n| File | Role | Variant | Canvas | Samples/frames | ms | Loops | Alpha | Bytes | Cap | SHA-256 |\n|---|---|---|---|---:|---:|---:|---|---:|---:|---|\n${table}\n\n## Toolchain\n\n\`\`\`json\n${JSON.stringify(tools, null, 2)}\n\`\`\`\n\n## Pixel verification\n\nRe-render: ${repro.key}, ${repro.count} decoded RGBA masters. Both sequence hashes: \`${repro.second}\`. Per-export endpoints, poster error, alpha margins and all eight composited sequence hashes are in size-report.json. The sequence digest is SHA-256 of the newline-separated SHA-256 digests of the decoded 2× RGBA masters, without a trailing newline.\n`,
);
if (overages.length) {
  fs.appendFileSync(
    path.join(out, "size-report.md"),
    "\n## Individual overages and measured alternatives\n\n" +
      overages
        .map(
          ({ path: file, over, trials, options }) =>
            `- ${file}: ${over.toLocaleString("en-US")} bytes over. ${trials.map((t) => `L${t.level}/Q${t.quality}: ${t.bytes}`).join("; ")}. ${options.at2point5x ? `144 × 180 at 24 fps: ${options.at2point5x.bytes} bytes, saving ${options.at2point5x.saved}. ` : ""}${options.at20fps ? `20 fps: ${options.at20fps.bytes} bytes, saving ${options.at20fps.saved}. ` : ""}Omitting the motion file saves ${options.droppingAnimationSaves} bytes before any unshared poster. Neither alternative ships in this branch.`,
        )
        .join("\n") +
      "\n",
  );
}
