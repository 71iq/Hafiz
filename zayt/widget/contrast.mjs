// Map text bounds through centerCrop. Source-space rectangle edges are monotone
// on either side of the source aspect. Their endpoint envelope also covers the
// continuum between tested sizes, including subpixel filtering at either edge.
export const linearLight = Array.from({ length: 256 }, (_, i) => {
  const n = i / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
});
export const luminance = (r, g, b) => linearLight[r] * 0.2126 + linearLight[g] * 0.7152 + linearLight[b] * 0.0722;
export const inkLight = (s) => luminance(...[1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)));
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Project the reserved ink bands, including a filter margin in both locales.
// Coordinates start in the widget; square artwork serves square tiles.
export function textRegions(w, h, bounds) {
  const source = w / h,
    result = [];
  function transform(r, rect) {
    const [x0, y0, x1, y1] = rect;
    const width = Math.min(w, h * r),
      height = Math.min(h, w / r);
    return [
      (w - width) / 2 + x0 * width,
      (h - height) / 2 + y0 * height,
      (w - width) / 2 + x1 * width,
      (h - height) / 2 + y1 * height,
    ];
  }
  for (const { role, rect: area } of bounds) {
    // At narrower aspects only X varies; at wider aspects only Y varies.
    // Each continuous sweep therefore occupies its endpoint envelope.
    const sorted = [...new Set([1, source, 5])].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = transform(sorted[i], area),
        b = transform(sorted[i + 1], area);
      result.push({
        role,
        rect: [
          Math.max(0, Math.floor(Math.min(a[0], b[0])) - 1),
          Math.max(0, Math.floor(Math.min(a[1], b[1])) - 1),
          Math.min(w, Math.ceil(Math.max(a[2], b[2])) + 1),
          Math.min(h, Math.ceil(Math.max(a[3], b[3])) + 1),
        ],
      });
    }
  }
  return result;
}

export function measure(pixels, w, h, inks, regions) {
  const results = {};
  for (const [role, color, maskRole] of [
    ["primary", inks[0], "ink"],
    ["secondary", inks[1], "ink"],
    ["lit", inks[2], "ink"],
    ["weekLabels", inks[1], "weekLabels"],
  ]) {
    const boxes = regions.filter((z) => z.role === maskRole);
    if (!boxes.length) continue;
    const ink = inkLight(color),
      target = { ratio: Infinity, x: 0, y: 0 };
    const mask = new Uint8Array(w * h);
    for (const box of boxes) {
      const [x0, y0, x1, y1] = box.rect;
      for (let y = y0; y < y1; y++) mask.fill(1, y * w + x0, y * w + x1);
    }
    for (let n = 0; n < mask.length; n++) {
      if (!mask[n]) continue;
      const offset = n * 3,
        value = ratio(ink, luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]));
      if (value < target.ratio) {
        target.ratio = value;
        target.x = n % w;
        target.y = Math.floor(n / w);
      }
    }
    // Round down so the manifest does not overstate contrast.
    results[role] = { ...target, ratio: Math.floor(target.ratio * 100) / 100 };
  }
  return results;
}
