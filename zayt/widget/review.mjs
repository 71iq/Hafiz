import fs from "node:fs";
import path from "node:path";
import { sharp, mkdir } from "../studio/common.mjs";
import { art, out, review } from "./paths.mjs";

import { skies } from "./scenes.mjs";

export const sheetNames = [
  "day",
  "thumbs",
  "flames",
  "home",
  "sizes",
  "states",
  "states-ar",
  "ladder",
  "faces",
  "loops",
  "ladder-v3",
  "faces-v3",
  "loops-v3",
  "night-wide",
];

export async function sheets(page) {
  mkdir(review);

  const loops = JSON.parse(fs.readFileSync(path.join(out, "loops.json")));
  const loopFiles = new Set(
    Object.values(loops)
      .flat()
      .map((frame) => frame.file),
  );
  const entries = [];
  for (const file of fs.readdirSync(art)) {
    if (!loopFiles.has(file) && /_\d\d\.webp$|_blink\.webp$/.test(file)) continue;
    entries.push([
      file.replace("hafiz_widget_", "").replace(".webp", ""),
      "data:image/webp;base64," + fs.readFileSync(path.join(art, file)).toString("base64"),
    ]);
  }
  for (const file of fs.readdirSync(path.join(out, "flame"))) {
    entries.push([
      file.replace(".svg", ""),
      "data:image/svg+xml;base64," + fs.readFileSync(path.join(out, "flame", file)).toString("base64"),
    ]);
  }
  await page.evaluate((assets) => artwork.loadImages(assets), entries);
  for (const name of sheetNames) {
    if (name === "night-wide") {
      const scenes = ["night", ...Object.keys(skies).filter((s) => s !== "night")];
      const bands = [];
      let width = 0,
        height = 0;
      for (const scene of scenes) {
        const base64 = await page.evaluate((s) => artwork.collisionBand(s), scene);
        const input = Buffer.from(base64, "base64");
        const size = await sharp(input).metadata();
        bands.push({ input, left: 0, top: height });
        width = size.width;
        height += size.height;
      }
      await sharp({ create: { width, height, channels: 3, background: "#202926" } })
        .composite(bands)
        .removeAlpha()
        .png({ compressionLevel: 9 })
        .toFile(path.join(review, name + ".png"));
      continue;
    }
    const png = await page.evaluate(([name, loops]) => artwork.makeSheet(name, loops), [name, loops]);
    await sharp(Buffer.from(png, "base64"))
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toFile(path.join(review, name + ".png"));
  }
}
