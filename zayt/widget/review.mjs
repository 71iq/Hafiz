import fs from "node:fs";
import path from "node:path";
import { sharp, mkdir } from "../studio/common.mjs";
import { art, out, review } from "./paths.mjs";

export async function sheets(page) {
  mkdir(review);

  const entries = [];
  for (const file of fs.readdirSync(art)) {
    if (/_\d\d\.webp$|_blink\.webp$/.test(file)) continue;
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
  for (const name of ["day", "thumbs", "flames", "home", "sizes", "states", "states-ar"]) {
    const png = await page.evaluate((name) => artwork.makeSheet(name), name);
    await sharp(Buffer.from(png, "base64"))
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toFile(path.join(review, name + ".png"));
  }
}
