import { textRegions, linearLight, inkLight, luminance } from "./contrast.mjs";

import { lightPosition } from "./scenes.mjs";

function latitudeCoverage(regions, h, role) {
  const d = new Float32Array(h).fill(h);
  for (const box of regions.filter((b) => b.role === role)) d.fill(0, box.rect[1], box.rect[3]);
  for (let y = 1; y < h; y++) d[y] = Math.min(d[y], d[y - 1] + 1);
  for (let y = h - 2; y >= 0; y--) d[y] = Math.min(d[y], d[y + 1] + 1);
  return d;
}
const srgb = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
function opacity(distance, feather) {
  const t = 1 - Math.min(1, distance / feather);
  return t * t * (3 - 2 * t);
}
export function grade(rgb, w, h, crop, inks, horizon, bounds, scene) {
  const regions = textRegions(w, h, crop, bounds);
  const masks = ["primary", "secondary"].map((role) => latitudeCoverage(regions, h, role));
  const dark = inkLight(inks[0]) > 0.45;
  // Reserve a little headroom for the final 4:2:0 encode and resampling.
  const limits = inks.map((ink, i) =>
    dark ? (inkLight(ink) + 0.05) / (i ? 5.25 : 8.05) - 0.05 : (inkLight(ink) + 0.05) * (i ? 5.25 : 8.05) - 0.05,
  );
  const fog = [1, 3, 5].map((i) => linearLight[Math.round(255 * 0.72 + parseInt(horizon.slice(i, i + 2), 16) * 0.28)]);
  const fogLight = fog[0] * 0.2126 + fog[1] * 0.7152 + fog[2] * 0.0722;
  const lightSource = lightPosition(scene, crop);
  const lastInkRow = ["primary", "secondary"].map((role) =>
    Math.max(...regions.filter((region) => region.role === role).map((region) => region.rect[3])),
  );
  // A gradually rising exposure towards the horizon keeps the sky continuous.
  // The shoulder stays within each role's ceiling through its last ink row.
  const exposure = Array.from({ length: h }, (_, y) =>
    Math.min(...limits.map((limit, j) => limit + 5 * Math.max(0, (y - lastInkRow[j]) / h) ** 2)),
  );
  for (let n = 0; n < w * h; n++) {
    const i = n * 3,
      light = luminance(rgb[i], rgb[i + 1], rgb[i + 2]);
    let next = light;
    const y = Math.floor(n / w);
    // Keep the isolated sun or moon luminous where it clears both locale
    // columns. It receives the same atmospheric falloff in either direction.
    let emitter = 0;
    if (dark && lightSource.radius) {
      const distance = Math.hypot((n % w) - w * lightSource.x, y - h * lightSource.y) / (h * lightSource.radius);
      // The ridge occludes the setting sun. Its dark foreground pixels must
      // keep the land exposure even inside the celestial disc's projection.
      const luminous = Math.max(0, Math.min(1, (light - 0.39) / 0.2));
      emitter = opacity(Math.max(0, distance - 0.95), 0.4) * luminous;
    }
    if (dark) {
      const ceiling = exposure[y],
        knee = 0.4 * ceiling;
      if (light > knee) {
        const above = light - knee,
          range = ceiling - knee;
        const mapped = knee + (range * above) / (range + above);
        next = light + (mapped - light) * (1 - emitter);
      }
    } else {
      for (const [j, limit] of limits.entries()) {
        const alpha = opacity(masks[j][y], h * 0.14),
          shoulder = 0.115;
        if (!alpha || light >= limit + shoulder) continue;
        const mapped = limit + shoulder * Math.exp((light - limit - shoulder) / shoulder);
        next = Math.max(next, light + alpha * (mapped - light));
      }
    }
    if (Math.abs(next - light) < 0.00001) continue;
    for (let c = 0; c < 3; c++) {
      const v = linearLight[rgb[i + c]];
      rgb[i + c] = srgb(dark ? (v * next) / light : v + ((fog[c] - v) * (next - light)) / (fogLight - light));
    }
  }
  return rgb;
}
