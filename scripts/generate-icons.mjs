// Regenerates the native app icons and splash logo from the website logo (public/icon.png), so the
// installed app and hafizquran.app share one mark. Run with `node scripts/generate-icons.mjs`.
// app.json and android/app/src/main/res/values/colors.xml keep the white icon and splash background.
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGES = path.join(ROOT, "assets", "images");
const RES = path.join(ROOT, "android", "app", "src", "main", "res");
const SOURCE = path.join(ROOT, "public", "icon.png");

// The logo is drawn in two inks on white; each pixel is un-mixed from white against the nearer ink.
const INKS = [
  [13, 66, 82], // navy
  [195, 165, 111], // gold
];
// The adaptive icon mask always shows the 66dp circle of the 108dp layer; the logo's diagonal fills it.
const SAFE_DIAGONAL = 0.61;
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

async function transparentLogo() {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 4) {
    let best = { alpha: 0, error: Infinity, ink: INKS[0] };
    for (const ink of INKS) {
      let dot = 0;
      let norm = 0;
      for (let c = 0; c < 3; c++) {
        dot += (255 - data[i + c]) * (255 - ink[c]);
        norm += (255 - ink[c]) ** 2;
      }
      const alpha = Math.min(1, Math.max(0, dot / norm));
      let error = 0;
      for (let c = 0; c < 3; c++) error += (data[i + c] - (alpha * ink[c] + (1 - alpha) * 255)) ** 2;
      if (error < best.error) best = { alpha, error, ink };
    }
    out.set([...best.ink, best.alpha < 0.02 ? 0 : Math.round(best.alpha * 255)], o);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer()
    .then((png) => sharp(png).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer({ resolveWithObject: true }));
}

const logo = await transparentLogo();
const { width: logoWidth, height: logoHeight } = logo.info;

/** The logo centered on a transparent square, scaled by its diagonal or its longer side. */
async function placed(size, { diagonal, longSide }) {
  const scale = diagonal ? (diagonal * size) / Math.hypot(logoWidth, logoHeight) : (longSide * size) / Math.max(logoWidth, logoHeight);
  const width = Math.round(logoWidth * scale);
  const height = Math.round(logoHeight * scale);
  const resized = await sharp(logo.data).resize(width, height).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.floor((size - width) / 2), top: Math.floor((size - height) / 2) }])
    .png()
    .toBuffer();
}

const onWhite = (png) => sharp(png).flatten({ background: "#FFFFFF" });
// Android tints the monochrome layer from its alpha, so the logo becomes a white silhouette.
const monochrome = async (png) => {
  const { width, height } = await sharp(png).metadata();
  const alpha = await sharp(png).extractChannel(3).toBuffer();
  return sharp({ create: { width, height, channels: 3, background: "#FFFFFF" } }).joinChannel(alpha).png();
};
const circle = (size) => Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);

const foreground = await placed(1024, { diagonal: SAFE_DIAGONAL });
await sharp(foreground).toFile(path.join(IMAGES, "android-icon-foreground.png"));
await (await monochrome(foreground)).toFile(path.join(IMAGES, "android-icon-monochrome.png"));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#FFFFFF" } }).png().toFile(path.join(IMAGES, "android-icon-background.png"));
await onWhite(await placed(1024, { longSide: 0.71 })).png().toFile(path.join(IMAGES, "icon.png"));
await sharp(await placed(200, { longSide: 0.9 })).toFile(path.join(IMAGES, "splash-icon.png"));

for (const [density, factor] of Object.entries(DENSITIES)) {
  const layer = Math.round(108 * factor);
  const fg = await sharp(await placed(layer * 4, { diagonal: SAFE_DIAGONAL })).resize(layer, layer).png().toBuffer();
  await sharp(fg).webp({ lossless: true }).toFile(path.join(RES, `mipmap-${density}`, "ic_launcher_foreground.webp"));
  await (await monochrome(fg)).webp({ lossless: true }).toFile(path.join(RES, `mipmap-${density}`, "ic_launcher_monochrome.webp"));

  // Launchers before Android 8 use the square and round bitmaps.
  const legacy = Math.round(48 * factor);
  const square = await onWhite(await placed(legacy * 4, { longSide: 0.72 })).resize(legacy, legacy).png().toBuffer();
  await sharp(square).webp({ lossless: true }).toFile(path.join(RES, `mipmap-${density}`, "ic_launcher.webp"));
  await sharp(square)
    .ensureAlpha()
    .composite([{ input: circle(legacy), blend: "dest-in" }])
    .webp({ lossless: true })
    .toFile(path.join(RES, `mipmap-${density}`, "ic_launcher_round.webp"));

  // Android 12+ splash: a 288dp canvas whose visible circle is 192dp.
  const splash = Math.round(288 * factor);
  await sharp(await placed(splash, { longSide: 0.42 })).toFile(path.join(RES, `drawable-${density}`, "splashscreen_logo.png"));
}

console.log("Icons generated from public/icon.png");
