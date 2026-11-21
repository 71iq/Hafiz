import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { dependency, cache } from "../studio/common.mjs";
import { widget } from "./paths.mjs";

export async function withCanvas(work) {
  const browser = await dependency("playwright").chromium.launch({
    env: {
      ...process.env,
      LD_LIBRARY_PATH:
        process.env.ZAYT_LD_LIBRARY_PATH ||
        "/home/ehab/.local/share/elpsy-browser-runtime/root/usr/lib/x86_64-linux-gnu",
    },
  });
  try {
    const page = await browser.newPage();
    await page.context().setOffline(true);
    await page.route("**/*", (route) => route.abort());
    const bundle = await dependency("esbuild").build({
      stdin: {
        contents: 'export { paintGrove } from "./scenes.mjs"; export * from "./sheets.mjs";',
        resolveDir: widget,
      },
      bundle: true,
      write: false,
      tsconfigRaw: {},
      nodePaths: [path.join(cache, "node_modules")],
      format: "iife",
      globalName: "artwork",
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await work(page);
  } finally {
    await browser.close();
  }
}

export async function loadFonts(page) {
  const versions = path.join(os.homedir(), ".t3/runtime/versions");
  const candidates = process.env.ZAYT_FONT_DIR
    ? [process.env.ZAYT_FONT_DIR]
    : fs
        .readdirSync(versions)
        .sort()
        .reverse()
        .map((v) => path.join(versions, v, "client/assets"));
  const faces = [
    ["Roboto", "Regular", "400"],
    ["Roboto", "Bold", "700"],
    ["NotoSansArabic", "Regular", "400"],
    ["NotoSansArabic", "Bold", "700"],
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    const sources = faces.map(([family, weight]) =>
      files.find((f) => new RegExp("^" + family + "-" + weight + "(?:-.*)?\\.ttf$").test(f)),
    );
    if (sources.some((file) => !file)) continue;
    for (const [i, file] of sources.entries()) {
      const data = fs.readFileSync(path.join(dir, file)).toString("base64");
      await page.evaluate(
        async ([family, weight, data]) => {
          const face = new FontFace(family, "url(data:font/ttf;base64," + data + ")", { weight });
          document.fonts.add(await face.load());
        },
        [faces[i][0], faces[i][2], data],
      );
    }
    return;
  }
  throw Error("Set ZAYT_FONT_DIR to a directory with regular and bold TTFs for Roboto and NotoSansArabic.");
}
