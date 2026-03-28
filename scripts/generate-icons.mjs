import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "..", "assets", "images");

const TEAL = "#003638";
const GOLD = "#FDDC91";

/**
 * Creates an SVG string for the open book icon.
 * The book is designed on a 1024x1024 canvas.
 * Two curved pages meeting at a spine, like an open Mushaf.
 */
function bookIconSvg({ size, bookColor, bgColor, bgOpacity = 1, padding = 0, monochrome = false }) {
  const bg =
    bgOpacity > 0 && bgColor
      ? `<rect width="${size}" height="${size}" rx="0" fill="${bgColor}" fill-opacity="${bgOpacity}"/>`
      : "";

  // Apply padding (fraction of size)
  const pad = size * padding;
  const effectiveScale = (size - 2 * pad) / 1024;
  const tx = pad;
  const ty = pad;

  let book;
  if (monochrome) {
    // For Android monochrome: clean silhouette, no detail lines.
    // Android uses the alpha channel and tints with the device theme color.
    book = `
    <g transform="translate(${tx}, ${ty}) scale(${effectiveScale})">
      <!-- Left page -->
      <path d="
        M 509 280
        C 477 270, 380 260, 290 290
        Q 270 298, 270 320
        L 270 700
        Q 270 722, 290 715
        C 380 685, 477 690, 509 700
        Z
      " fill="${bookColor}"/>
      <!-- Right page -->
      <path d="
        M 515 280
        C 547 270, 644 260, 734 290
        Q 754 298, 754 320
        L 754 700
        Q 754 722, 734 715
        C 644 685, 547 690, 515 700
        Z
      " fill="${bookColor}"/>
    </g>
    `;
  } else {
    // The book paths designed on a 1024x1024 canvas:
    // Left page — curved left side, straight spine
    // Right page — straight spine, curved right side
    // Spine line down the center + detail lines for texture
    book = `
    <g transform="translate(${tx}, ${ty}) scale(${effectiveScale})">
      <!-- Left page -->
      <path d="
        M 512 280
        C 480 270, 380 260, 290 290
        Q 270 298, 270 320
        L 270 700
        Q 270 722, 290 715
        C 380 685, 480 690, 512 700
        Z
      " fill="${bookColor}"/>
      <!-- Right page -->
      <path d="
        M 512 280
        C 544 270, 644 260, 734 290
        Q 754 298, 754 320
        L 754 700
        Q 754 722, 734 715
        C 644 685, 544 690, 512 700
        Z
      " fill="${bookColor}"/>
      <!-- Spine -->
      <line x1="512" y1="290" x2="512" y2="700" stroke="${bgColor || TEAL}" stroke-width="5" stroke-opacity="0.4"/>
      <!-- Page detail lines - left -->
      <line x1="330" y1="370" x2="490" y2="350" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
      <line x1="330" y1="420" x2="490" y2="400" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
      <line x1="330" y1="470" x2="490" y2="450" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
      <line x1="330" y1="520" x2="490" y2="500" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
      <line x1="330" y1="570" x2="490" y2="550" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
      <!-- Page detail lines - right -->
      <line x1="534" y1="350" x2="694" y2="370" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
      <line x1="534" y1="400" x2="694" y2="420" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
      <line x1="534" y1="450" x2="694" y2="470" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
      <line x1="534" y1="500" x2="694" y2="520" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
      <line x1="534" y1="550" x2="694" y2="570" stroke="${bgColor || TEAL}" stroke-width="3" stroke-opacity="0.15"/>
    </g>
    `;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}${book}</svg>`;
}

async function generate() {
  console.log("Generating icons...\n");

  // 1. App icon (1024x1024) — gold book on teal background
  const iconSvg = bookIconSvg({
    size: 1024,
    bookColor: GOLD,
    bgColor: TEAL,
  });
  await sharp(Buffer.from(iconSvg))
    .png()
    .toFile(path.join(OUTPUT_DIR, "icon.png"));
  console.log("  icon.png (1024x1024)");

  // 2. Splash icon (200x200) — teal book on transparent background
  const splashSvg = bookIconSvg({
    size: 200,
    bookColor: TEAL,
    bgColor: null,
    bgOpacity: 0,
  });
  await sharp(Buffer.from(splashSvg))
    .png()
    .toFile(path.join(OUTPUT_DIR, "splash-icon.png"));
  console.log("  splash-icon.png (200x200)");

  // 3. Android adaptive icon foreground (1024x1024) — gold book centered with safe zone padding
  const fgSvg = bookIconSvg({
    size: 1024,
    bookColor: GOLD,
    bgColor: null,
    bgOpacity: 0,
    padding: 0.3,
  });
  await sharp(Buffer.from(fgSvg))
    .png()
    .toFile(path.join(OUTPUT_DIR, "android-icon-foreground.png"));
  console.log("  android-icon-foreground.png (1024x1024)");

  // 4. Android adaptive icon background (1024x1024) — solid teal
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${TEAL}"/></svg>`;
  await sharp(Buffer.from(bgSvg))
    .png()
    .toFile(path.join(OUTPUT_DIR, "android-icon-background.png"));
  console.log("  android-icon-background.png (1024x1024)");

  // 5. Android monochrome (1024x1024) — white book silhouette on transparent background
  //    Android tints the alpha channel with the device theme color at runtime
  const monoSvg = bookIconSvg({
    size: 1024,
    bookColor: "#FFFFFF",
    bgColor: null,
    bgOpacity: 0,
    padding: 0.3,
    monochrome: true,
  });
  await sharp(Buffer.from(monoSvg))
    .png()
    .toFile(path.join(OUTPUT_DIR, "android-icon-monochrome.png"));
  console.log("  android-icon-monochrome.png (1024x1024)");

  // 6. Favicon (48x48) — gold book on teal background
  const faviconSvg = bookIconSvg({
    size: 48,
    bookColor: GOLD,
    bgColor: TEAL,
  });
  await sharp(Buffer.from(faviconSvg))
    .png()
    .toFile(path.join(OUTPUT_DIR, "favicon.png"));
  console.log("  favicon.png (48x48)");

  console.log("\nAll icons generated successfully!");
}

generate().catch((err) => {
  console.error("Error generating icons:", err);
  process.exit(1);
});
