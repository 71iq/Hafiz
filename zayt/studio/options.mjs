import fs from "node:fs";
import path from "node:path";
import { cache, select, out, frameDir, mkdir, nameFrame, json } from "./common.mjs";
import { encode } from "./encode.mjs";
import { camera } from "./capture.mjs";
for (const job of select(process.argv.slice(2))) {
  const base = fs.statSync(path.join(out, job.media)).size,
    dir = path.join(cache, "options", job.key);
  mkdir(dir);
  const trials = JSON.parse(fs.readFileSync(path.join(cache, "trials", job.key + ".json"))),
    quality = trials.at(-1).quality;
  const entry = { base, droppingAnimationSaves: base, quality };
  if (job.tier === "S") {
    const hashes = [],
      captured = JSON.parse(fs.readFileSync(path.join(frameDir(job), "capture.json")));
    await camera(async (sample) => {
      for (const [index, pose] of captured.poses.entries())
        hashes.push(
          await sample(
            [144, 180],
            pose,
            { level: captured.level, variant: job.variant },
            null,
            path.join(dir, nameFrame(index)),
          ),
        );
    });
    json(path.join(dir, "capture.json"), { hashes });
    const dest = path.join(dir, "2.5x.webp");
    await encode(job, { quality, dir, dest });
    entry.at2point5x = { bytes: fs.statSync(dest).size, saved: base - fs.statSync(dest).size };
  }
  if (["A07", "A15"].includes(job.id)) {
    const count = Math.round(job.seconds * 20),
      entries = Array.from({ length: count }, (_, n) => Math.round((n / (count - 1)) * (job.nominal_samples - 1))),
      dest = path.join(dir, "20fps.webp");
    await encode(job, { quality, entries, dest });
    entry.at20fps = { bytes: fs.statSync(dest).size, saved: base - fs.statSync(dest).size };
  }
  json(path.join(dir, "result.json"), entry);
  console.log(job.key, entry);
}
