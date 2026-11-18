import fs from "node:fs";
import path from "node:path";
import { cache, select, frameDir, nameFrame, mkdir, json, sha } from "./common.mjs";
import { sample, hold } from "./poses.mjs";
import { camera } from "./capture.mjs";

const jobs = select(process.argv.slice(2));
if (!jobs.length) throw Error("Specify pilot, P0, P1, P2, all or ID-tier[-variant]");
await camera(async (capture) => {
  for (const job of jobs) {
    const level = Number(process.env.ZAYT_LEVEL || 1),
      dir = frameDir(job),
      masters = path.join(process.env.ZAYT_WORK || cache, "masters", job.key),
      count = job.nominal_samples || 1;
    mkdir(dir);
    mkdir(masters);
    const hashes = [],
      poses = [],
      style = { variant: job.variant, level };
    let previous;
    for (let index = 0; index < count; index++) {
      const time = count === 1 ? 0 : job.seconds * (index / (count - 1)),
        pose = sample(job, time, level),
        signature = JSON.stringify(pose),
        file = nameFrame(index);
      if (index && signature === previous) {
        for (const folder of [dir, masters])
          fs.copyFileSync(path.join(folder, nameFrame(index - 1)), path.join(folder, file));
        hashes.push(hashes.at(-1));
      } else hashes.push(await capture(job.size, pose, style, path.join(masters, file), path.join(dir, file)));
      poses.push(pose);
      previous = signature;
    }
    const endpoint = async (name, pose) => capture(job.size, pose, style, null, path.join(dir, name + ".png"));
    const start = job.id === "A19" ? { ...hold("rest"), opacity: 0 } : hold(job.id === "A17" ? "warm_smile" : "rest");
    const declared = [await endpoint("start", start), await endpoint("hold", hold(job.hold))];
    if (hashes[0] !== declared[0] || hashes.at(-1) !== declared[1]) throw Error(job.key + " endpoint mismatch");
    const data = { hashes, sequence: sha(Buffer.from(hashes.join("\n"))), declared, poses, level };
    json(path.join(dir, "capture.json"), data);
    console.log(job.key, count, data.sequence);
  }
});
