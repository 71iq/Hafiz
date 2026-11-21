import path from "node:path";
import { sharp, mkdir } from "../studio/common.mjs";
import { art, sceneName } from "./paths.mjs";
import { grade } from "./grade.mjs";
import { inks, skies } from "./scenes.mjs";

export async function landscapes(page, bounds) {
  mkdir(art);
  for (const scene of Object.keys(skies)) {
    for (const [crop, width, height] of [
      ["sq", 900, 900],
      ["wide", 1500, 600],
    ]) {
      const png = await page.evaluate(
        ([scene, crop, width, height]) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          artwork.paintGrove(canvas, scene, crop);
          return canvas.toDataURL().split(",")[1];
        },
        [scene, crop, width, height],
      );
      const pixels = await sharp(Buffer.from(png, "base64")).removeAlpha().raw().toBuffer();
      grade(pixels, width, height, crop, inks[scene], skies[scene][2], bounds[scene][crop], scene);
      await sharp(pixels, { raw: { width, height, channels: 3 } })
        .webp({ quality: 89, effort: 6, smartSubsample: true })
        .toFile(path.join(art, sceneName(scene, crop)));
    }
  }
}
