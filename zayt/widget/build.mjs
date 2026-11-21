import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sprites } from "./sprites.mjs";
import { flames } from "./flames.mjs";
import { withCanvas, loadFonts } from "./browser.mjs";
import { landscapes } from "./landscapes.mjs";
import { sheets } from "./review.mjs";
import { manifest } from "./manifest.mjs";

const verifying = process.argv[2] === "--verify";
if (process.argv.length > (verifying ? 3 : 2)) throw Error("Usage: node zayt/widget/build.mjs [--verify]");
if (!verifying) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hafiz-widget-"));
  try {
    await sprites(work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  flames();
}
await withCanvas(async (page) => {
  await loadFonts(page);
  const bounds = await page.evaluate(() => artwork.textBounds());
  if (!verifying) {
    await landscapes(page, bounds);
    await sheets(page);
  }
  await manifest(bounds, verifying);
});
