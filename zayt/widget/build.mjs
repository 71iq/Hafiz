import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sprites } from "./sprites.mjs";
import { flames } from "./flames.mjs";
import { withCanvas, loadFonts } from "./browser.mjs";
import { landscapes } from "./landscapes.mjs";
import { sheets } from "./review.mjs";
import { textBounds } from "./layouts.mjs";
import { manifest } from "./manifest.mjs";

const verifying = process.argv[2] === "--verify";
if (process.argv.length > (verifying ? 3 : 2)) throw Error("Usage: node zayt/widget/build.mjs [--verify]");
const bounds = textBounds();
if (verifying) {
  await manifest(bounds, true);
} else {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hafiz-widget-"));
  try {
    await sprites(work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  flames();
  await withCanvas(async (page) => {
    await loadFonts(page);
    await landscapes(page, bounds);
    await sheets(page);
  });
  await manifest(bounds);
}
