import fs from "node:fs";
import { sharp } from "./common.mjs";

export async function decode(file) {
  const bytes = fs.readFileSync(file);
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    throw Error(file + " invalid RIFF");
  let loops = 0;
  const durations = [];
  for (let offset = 12; offset < bytes.length; ) {
    const tag = bytes.toString("ascii", offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4),
      start = offset + 8;
    if (tag === "ANIM") loops = bytes.readUInt16LE(start + 4);
    if (tag === "ANMF") durations.push(bytes.readUIntLE(start + 12, 3));
    offset = start + size + (size % 2);
  }
  const input = sharp(bytes, { animated: true }),
    meta = await input.metadata(),
    raw = await input.ensureAlpha().raw().toBuffer();
  const width = meta.width,
    height = meta.pageHeight || meta.height,
    step = width * height * 4;
  const frames = Array.from({ length: raw.length / step }, (_, index) =>
    raw.subarray(index * step, (index + 1) * step),
  );
  if (frames.length !== (durations.length || 1)) throw Error(file + " frame count");
  const total = durations.reduce((sum, ms) => sum + ms, 0),
    at = (ms) => {
      let end = 0;
      for (let n = 0; n < durations.length; n++) {
        end += durations[n];
        if (ms < end) return frames[n];
      }
      return frames.at(-1);
    };
  return { bytes, frames, width, height, loops, durations, total, alpha: meta.hasAlpha, at };
}
export const nominal = (decoded, job, index) => decoded.at(Math.round((index * decoded.total) / job.nominal_samples));
export const bounds = (pixels, width, height) => {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++)
      if (pixels[(row * width + col) * 4 + 3] > 0) {
        left = Math.min(left, col);
        top = Math.min(top, row);
        right = Math.max(right, col);
        bottom = Math.max(bottom, row);
      }
  return right < 0 ? null : [left, top, right, bottom];
};
