import { inks, skies } from "./scenes.mjs";
import { states, layoutSizes, isTile } from "./specimens.mjs";

const images = new Map();
let measuring = null;
export async function loadImages(entries) {
  await Promise.all(
    entries.map(async ([name, url]) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      images.set(name, img);
    }),
  );
}
const sheetColor = "#202926",
  paper = "#f5f2e8",
  soft = "#b1beb5";
const layouts = ["tile", "wide", "short", "tiny"];
function sheet(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w * 3;
  canvas.height = h * 3;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.scale(3, 3);
  ctx.fillStyle = sheetColor;
  ctx.fillRect(0, 0, w, h);
  return ctx;
}
function text(ctx, str, x, y, size, ink, opts = {}) {
  const { rtl = false, align = "left", weight = 400 } = opts;
  ctx.save();
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = ink;
  ctx.font = weight + " " + size + "px " + (rtl ? "NotoSansArabic" : "Roboto");
  if (measuring) {
    const m = ctx.measureText(str);
    measuring.push({
      ink,
      rect: [
        x - m.actualBoundingBoxLeft - 1,
        y - m.actualBoundingBoxAscent - 1,
        x + m.actualBoundingBoxRight + 1,
        y + m.actualBoundingBoxDescent + 1,
      ],
    });
  } else ctx.fillText(str, x, y);
  ctx.restore();
}
function round(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}
function cover(ctx, img, w, h) {
  const k = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
}
function icon(ctx, name, x, y, size, tint) {
  const key = name + "@" + tint;
  if (!images.has(key)) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 168;
    const c = canvas.getContext("2d");
    c.drawImage(images.get("flame_" + name), 0, 0, 168, 168);
    if (name === "out" || name === "unlit") {
      c.globalCompositeOperation = "source-in";
      c.fillStyle = tint;
      c.fillRect(0, 0, 168, 168);
    }
    images.set(key, canvas);
  }
  ctx.drawImage(images.get(key), x, y, size, size);
}
function wrap(ctx, message, width, maxLines, font) {
  ctx.save();
  ctx.font = font;
  const lines = [];
  let line = "";
  for (const word of message.split(" ")) {
    const next = line ? line + " " + word : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    while (ctx.measureText(lines.at(-1) + "…").width > width) lines[maxLines - 1] = lines.at(-1).slice(0, -1);
    lines[maxLines - 1] += "…";
  }
  ctx.restore();
  return lines;
}
function tile(ctx, x, y, row, layout, rtl = false, dimensions = layoutSizes[layout]) {
  const [, scene, pose, count, flame, en, ar] = row,
    [w, h] = dimensions;
  const tileMode = isTile(layout),
    wide = layout === "wide" || layout === "medium";
  const tiny = layout === "tiny",
    short = layout === "short",
    line = rtl ? ar : en;
  const [primary, secondary] = inks[scene];
  const pad = tileMode ? 12 : wide ? 14 : tiny ? 8 : 10,
    iconSize = tileMode ? 22 : wide ? 28 : tiny ? 18 : 20;
  const numSize = tileMode ? 26 : wide ? 34 : tiny ? 20 : 22,
    lineSize = tileMode ? 13 : wide ? 15 : 12;
  const font = rtl ? "NotoSansArabic" : "Roboto";
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, Math.min(23, h * 0.23));
  ctx.clip();
  if (!measuring) cover(ctx, images.get("scene_" + scene + "_" + (tileMode ? "sq" : "wide")), w, h);
  const countText = rtl ? new Intl.NumberFormat("ar-EG").format(count) : String(count);
  ctx.font = "700 " + numSize + "px " + font;
  const numWidth = ctx.measureText(countText).width,
    gap = wide ? 6 : 3,
    group = iconSize + numWidth + gap;
  const groupX = tileMode ? (w - group) / 2 : rtl ? w - pad - group : pad;
  const groupY = tileMode ? pad + numSize * 0.5 : wide ? pad + numSize * 0.54 : tiny ? h / 2 : pad + numSize * 0.55;
  const tx = tileMode ? w / 2 : rtl ? w - pad : pad;
  const align = tileMode ? "center" : rtl ? "right" : "left";
  const lineWidth = tileMode ? w - 2 * pad : wide ? w * 0.53 : short ? w - 57 : 0;
  const lines = tiny || !line ? [] : wrap(ctx, line, lineWidth, short ? 1 : 2, "400 " + lineSize + "px " + font);
  const leading = rtl ? lineSize * 1.38 : lineSize * 1.16;
  const lineY = groupY + numSize * 0.53 + lineSize * 0.6 + 1;
  const copyEnd = lines.length ? lineY + (lines.length - 1) * leading + lineSize * 0.6 : groupY + numSize * 0.54;
  // The studio has 16% clear sky above the sprig. Place its visible bounding box,
  // not the empty canvas, against the text and foot-crop lines.
  const sprite = images.get("zayt_" + pose);
  let drawH, drawW, drawX, drawY;
  const baseline = 704 / 720,
    standingHeight = (704 - 120) / 720;
  if (tileMode) {
    drawH = (h + 8 - copyEnd - 2) / standingHeight;
    drawW = (drawH * 5) / 6;
    drawX = (w - drawW) / 2;
    drawY = h + 8 - drawH * baseline;
  } else if (wide) {
    drawH = (h + 6 - 10) / standingHeight;
    drawW = (drawH * 5) / 6;
    drawY = h + 6 - drawH * baseline;
    const center = rtl ? w * 0.255 : w * 0.745;
    drawX = center - drawW * 0.5;
  } else {
    drawH = tiny ? 72 : 104;
    drawW = (drawH * 5) / 6;
    const center = rtl ? (tiny ? 24 : 34) : w - (tiny ? 24 : 34);
    drawX = center - drawW * 0.5;
    // Lift the transparent headroom so the bottom crop clears the seated smile, too.
    drawY = tiny ? -5 : -11;
  }
  if (!measuring) ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
  const iconX = rtl ? groupX + numWidth + gap : groupX;
  if (!measuring) icon(ctx, flame, iconX, groupY - iconSize * 0.5, iconSize, primary);
  else if (["unlit", "out"].includes(flame))
    measuring.push({ ink: primary, rect: [iconX, groupY - iconSize * 0.5, iconX + iconSize, groupY + iconSize * 0.5] });
  text(ctx, countText, rtl ? groupX + numWidth : groupX + iconSize + gap, groupY + 0.3, numSize, primary, {
    weight: 700,
    rtl,
    align: rtl ? "right" : "left",
  });
  lines.forEach((s, i) => text(ctx, s, tx, lineY + i * leading, lineSize, secondary, { rtl, align }));
  if (layout === "wide" && !["radiant", "radiant_night", "milestone", "calm"].includes(scene))
    text(ctx, rtl ? "صفحتان اليوم" : "2 pages today", tx, h - pad - 6, 12, secondary, { rtl, align });
  ctx.restore();
}
function headings(ctx, title, sub) {
  text(ctx, title, 18, 19, 17, paper, { weight: 700 });
  if (sub) text(ctx, sub, 18, 39, 10, soft);
}
function statesSheet(rtl) {
  const xs = [115, 291, 637, 825],
    top = 70,
    stride = 180;
  const c = sheet(952, top + states.length * stride + 7);
  headings(c, rtl ? "Arabic · RTL" : "English · LTR");
  const labels = ["Tile  ·  160 × 160", "Wide  ·  330 × 170", "Short  ·  170 × 80", "Tiny  ·  110 × 56"];
  labels.forEach((s, i) => text(c, s, xs[i], 48, 10, soft));
  for (const [i, row] of states.entries()) {
    const y = top + i * stride;
    text(c, row[0], 12, y + 12, 10, paper);
    for (const [j, layout] of layouts.entries()) tile(c, xs[j], y, row, layout, rtl);
  }
  return c;
}
function daySheet() {
  const c = sheet(710, 407);
  headings(c, "Zayt keeps the light");
  const names = ["Morning", "Midday", "Golden hour", "Dusk", "Night", "Last hour", "Wird done", "Wird done at night"];
  for (let i = 0; i < 8; i++) {
    const x = 14 + (i % 4) * 174,
      y = 53 + Math.floor(i / 4) * 177;
    text(c, names[i], x, y - 8, 10, soft);
    tile(c, x, y, states[i + 1], "tile");
  }
  return c;
}
function thumbsSheet() {
  const c = sheet(464, 205);
  headings(c, "The olive grove at 60 dp");
  for (const [i, scene] of Object.keys(skies).entries()) {
    const x = 13 + (i % 6) * 75,
      y = 38 + Math.floor(i / 6) * 82;
    c.save();
    c.translate(x, y);
    c.beginPath();
    c.roundRect(0, 0, 60, 60, 8);
    c.clip();
    cover(c, images.get("scene_" + scene + "_sq"), 60, 60);
    c.restore();
    text(c, scene.replace("_", " "), x, y + 69, 9, soft);
  }
  return c;
}
function flamesSheet() {
  const c = sheet(708, 269);
  headings(c, "Streak flames");
  const names = ["out", "unlit", ...Array.from({ length: 7 }, (_, i) => "lit_t" + i)];
  for (const [i, name] of names.entries())
    text(c, name.replace("lit_t", "Tier "), 87 + i * 70, 38, 10, paper, { align: "center" });
  for (const [j, scene] of ["radiant", "midnight"].entries()) {
    const y = 50 + j * 104;
    c.save();
    c.translate(42, y);
    c.beginPath();
    c.roundRect(0, 0, 650, 99, 12);
    c.clip();
    cover(c, images.get("scene_" + scene + "_wide"), 650, 99);
    c.restore();
    for (const [k, size] of [18, 24, 48].entries()) {
      const cy = y + [12, 35, 73][k];
      text(c, String(size), 17, cy, 10, soft);
      for (const [i, name] of names.entries())
        icon(c, name, 87 + i * 70 - size * 0.5, cy - size * 0.5, size, inks[scene][0]);
    }
  }
  return c;
}
function sizeSheet() {
  const c = sheet(704, 449);
  headings(c, "Resize checks");
  for (const [i, rtl] of [false, true].entries()) {
    const y = 46 + i * 201;
    tile(c, 14, y, states[1], "smallTile", rtl);
    tile(c, 139, y, states[4], "largeTile", rtl);
    tile(c, 347, y, states[5], "medium", rtl);
  }
  return c;
}
function phone(ctx, offset, night) {
  const w = 360,
    h = 780,
    ink = night ? "#e0e7e9" : "#273b35";
  ctx.save();
  ctx.translate(offset, 0);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  // A generic launcher with original wallpaper, local fixtures and simple utility glyphs.
  const pal = night
    ? ["#111f2b", "#213345", "#35505a", "#253c3e", "#182c30"]
    : ["#e6e7d3", "#d2dec8", "#abc4ae", "#a2bda6", "#689486"];
  const gradient = ctx.createLinearGradient(10, 0, 330, 740);
  gradient.addColorStop(0, pal[0]);
  gradient.addColorStop(1, pal[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    ctx.moveTo(-80, 580 + k * 39);
    ctx.bezierCurveTo(59, 460 + k * 19, 207, 433 + k * 20, 400, 126 + k * 73);
    ctx.lineTo(400, 810);
    ctx.lineTo(-80, 810);
    ctx.fillStyle = pal[(k + 1) % pal.length];
    ctx.fill();
  }
  text(ctx, night ? "23:48" : "09:41", 20, 14, 11, ink, { weight: 700 });
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(300, 10);
  ctx.lineTo(311, 10);
  ctx.lineTo(305.5, 17);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(314, 17);
  ctx.lineTo(323, 8);
  ctx.lineTo(323, 17);
  ctx.fill();
  round(ctx, 327, 10, 13, 7, 1.6, ink);
  round(ctx, 339.3, 12, 2, 3, 1, ink);
  text(ctx, "Saturday, November 21", 17, 66, 17, ink, { weight: 700 });
  text(ctx, night ? "23:48" : "09:41", 12, 117, 64, ink);
  const iconData = [
    ["Calendar", "cal", "#edf2e7", "#3f7469"],
    ["Clock", "clock", "#e5eef4", "#4e647b"],
    ["Files", "files", "#fff1db", "#a67735"],
    ["Camera", "cam", "#e6eae8", "#415e52"],
    ["Photos", "photo", "#ebf0d8", "#74945e"],
    ["Notes", "note", "#fff0cf", "#9d802e"],
    ["Maps", "pin", "#e0efe4", "#4b806c"],
    ["Weather", "weather", "#e3eef5", "#5c8ca8"],
  ];
  function app(x, y, entry, dock = false) {
    const [label, shape, pale, dark] = entry,
      tint = night ? pale : dark,
      bg = night ? dark : pale;
    ctx.save();
    ctx.translate(x, y);
    round(ctx, -21, -21, 42, 42, 16, bg);
    ctx.strokeStyle = tint;
    ctx.fillStyle = tint;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const lines = (pts) => {
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      for (const pt of pts.slice(1)) ctx.lineTo(...pt);
      ctx.stroke();
    };
    const disk = (x, y, r) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
    };
    const ring = (x, y, r) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
    };
    switch (shape) {
      case "cal":
        ctx.strokeRect(-9, -8, 18, 17);
        lines([
          [-9, -3],
          [9, -3],
        ]);
        text(ctx, "21", 0, 3, 8, tint, { align: "center", weight: 700 });
        break;
      case "clock":
        ring(0, 0, 9);
        lines([
          [0, -6],
          [0, 0],
          [5, 2],
        ]);
        break;
      case "files":
        round(ctx, -10, -6, 20, 14, 3, tint);
        round(ctx, -9, -9, 9, 7, 2, tint);
        break;
      case "cam":
        round(ctx, -11, -7, 22, 16, 4, tint);
        round(ctx, -6, -10, 9, 6, 2, tint);
        ctx.fillStyle = bg;
        disk(0, 1, 5);
        ctx.fillStyle = tint;
        disk(0, 1, 3);
        break;
      case "photo":
        ctx.strokeRect(-9, -8, 18, 16);
        lines([
          [-8, 6],
          [-2, 0],
          [1, 3],
          [4, -1],
          [8, 5],
        ]);
        disk(4, -4, 1.7);
        break;
      case "note":
        ctx.strokeRect(-7, -9, 14, 18);
        for (const y of [-4, 0, 4])
          lines([
            [-4, y],
            [4, y],
          ]);
        break;
      case "pin":
        ring(0, -2, 6.8);
        disk(0, -2, 2);
        lines([
          [-5, 3],
          [0, 10],
          [5, 3],
        ]);
        break;
      case "weather":
        disk(-4, 1, 5);
        disk(1, -2, 6);
        disk(6, 2, 4);
        round(ctx, -6, 1, 14, 5, 2, tint);
        break;
      case "phone":
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(5, -6, 13, 0.5 * Math.PI, Math.PI);
        ctx.stroke();
        lines([
          [-8, -6],
          [-6, -9],
        ]);
        lines([
          [4, 7],
          [7, 5],
        ]);
        break;
      case "chat":
        round(ctx, -10, -8, 20, 15, 5, tint);
        ctx.beginPath();
        ctx.moveTo(-6, 4);
        ctx.lineTo(-6, 10);
        ctx.lineTo(2, 5);
        ctx.fill();
        break;
      case "music":
        lines([
          [-4, 6],
          [-4, -6],
          [7, -9],
          [7, 3],
        ]);
        disk(-7, 6, 3);
        disk(4, 4, 3);
        break;
    }
    ctx.restore();
    if (!dock) text(ctx, label, x, y + 30, 11, ink, { align: "center" });
  }
  const row = night ? states[6] : states[1];
  tile(ctx, 16, 174, row, "tile");
  for (let i = 0; i < 4; i++) app(228 + (i % 2) * 79, 207 + Math.floor(i / 2) * 81, iconData[i]);
  tile(ctx, 15, 371, row, "wide");
  for (let i = 0; i < 4; i++) app(49 + i * 87, 594, iconData[i + 4]);
  const dock = [
    ["Phone", "phone", "#e0eee6", "#4e7868"],
    ["Messages", "chat", "#deecf5", "#53768b"],
    ["Music", "music", "#f1e4ed", "#9a698e"],
    iconData[3],
  ];
  for (let i = 0; i < 4; i++) app(49 + i * 87, 684, dock[i], true);
  round(ctx, 17, 720, 326, 39, 20, night ? "#293d43" : "#eff1e5");
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.arc(38, 738, 5.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(42, 742);
  ctx.lineTo(46, 746);
  ctx.stroke();
  text(ctx, "Search apps", 57, 740, 13, ink);
  round(ctx, 140, 772, 80, 3, 2, ink);
  ctx.restore();
}
function homeSheet() {
  const c = sheet(720, 780);
  phone(c, 0, false);
  phone(c, 360, true);
  return c;
}
export function makeSheet(name) {
  const c = {
    states: () => statesSheet(false),
    "states-ar": () => statesSheet(true),
    day: daySheet,
    thumbs: thumbsSheet,
    flames: flamesSheet,
    home: homeSheet,
    sizes: sizeSheet,
  }[name]();
  return c.canvas.toDataURL().split(",")[1];
}

// Capture the painted bounds using the same font shaping, directions, baselines and
// wrapping as the sheets. Include the allowed one- or two-line copy area even when
// a reward specimen has no line, so each scene supplies usable secondary ink.
export function textBounds() {
  const ctx = document.createElement("canvas").getContext("2d");
  const result = {};
  for (const row of states) {
    const scene = row[1],
      [primary] = inks[scene];
    const copy = row[5] ? row : [...row.slice(0, 5), "Review left today", "بقيت مراجعة اليوم"];
    const groups = (result[scene] ??= { sq: [], wide: [] });
    for (const layout of ["tile", "wide", "medium", "short", "tiny"]) {
      const sizes = isTile(layout) ? Array.from({ length: 81 }, (_, i) => [110 + i, 110 + i]) : [layoutSizes[layout]];
      for (const [w, h] of sizes)
        for (const rtl of [false, true]) {
          measuring = [];
          tile(ctx, 0, 0, copy, layout, rtl, [w, h]);
          for (const { ink, rect } of measuring) {
            // Ink at the bottom only occurs on the tall layout.
            const note = layout === "wide" && rect[1] > h * 0.7;
            groups[isTile(layout) ? "sq" : "wide"].push({
              role: ink === primary ? "primary" : "secondary",
              layout: note ? "note" : layout,
              rtl,
              rect: [rect[0] / w, rect[1] / h, rect[2] / w, rect[3] / h],
            });
          }
          measuring = null;
        }
    }
  }
  return result;
}
