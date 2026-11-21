import { wideExamples, columns, wideRows } from "./layouts.mjs";
import { inks, skies } from "./scenes.mjs";
import { states, ladder, layoutSizes, isTile, newFaces, ladderPairs } from "./specimens.mjs";

const images = new Map();

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
  ctx.fillText(str, x, y);
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
function tile(ctx, x, y, row, layout, rtl = false, dimensions = layoutSizes[layout], cropFeet = 8) {
  const [, scene, pose, count, flame, en, ar, countInk] = row,
    [w, h] = dimensions;
  if (!isTile(layout)) {
    const kind = { wide: "roomy", medium: "short", short: "short", tiny: "tiny" }[layout];
    wideCard(ctx, x, y, row, kind, w, h, rtl);
    return;
  }
  const line = rtl ? ar : en;
  const [primary] = inks[scene];
  const pad = 12,
    iconSize = 22,
    numSize = 26,
    lineSize = 13;
  const font = rtl ? "NotoSansArabic" : "Roboto";
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, Math.min(23, h * 0.23));
  ctx.clip();
  cover(ctx, images.get("scene_" + scene + "_sq"), w, h);
  const countText = rtl ? new Intl.NumberFormat("ar-EG").format(count) : String(count);
  ctx.font = "700 " + numSize + "px " + font;
  const numWidth = ctx.measureText(countText).width,
    gap = 3,
    group = iconSize + numWidth + gap;
  const groupX = (w - group) / 2,
    groupY = pad + numSize * 0.5;
  const lines = line ? wrap(ctx, line, w - 2 * pad, 2, "400 " + lineSize + "px " + font) : [];
  const leading = rtl ? lineSize * 1.38 : lineSize * 1.16;
  const lineY = groupY + numSize * 0.53 + lineSize * 0.6 + 1;
  const copyEnd = lines.length ? lineY + (lines.length - 1) * leading + lineSize * 0.6 : groupY + numSize * 0.54;
  // The studio has 16% clear sky above the sprig. Place its visible bounding box,
  // not the empty canvas, against the text and foot-crop lines.
  const sprite = images.get("zayt_" + pose);
  const drawH = ((h + cropFeet - copyEnd - 2) * 720) / 584;
  const drawW = (drawH * 5) / 6;
  const drawX = (w - drawW) / 2,
    drawY = h + cropFeet - (drawH * 704) / 720;
  ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
  const iconX = rtl ? groupX + numWidth + gap : groupX;
  if (flame === "waiting") {
    icon(ctx, "out", iconX, groupY - iconSize * 0.5, iconSize, primary);
    const ember = {
      day: "#99602B",
      golden: "#BD4D16",
      dusk: "#FFAB52",
      night: "#FF9657",
      midnight: "#FF7158",
      morning: "#99602B",
      dawn_rose: "#AD5028",
      dawn_red: "#FF985A",
    };
    ctx.fillStyle = ember[scene];
    ctx.beginPath();
    ctx.ellipse(iconX + iconSize * 0.51, groupY + iconSize * 0.22, 1.7, 2.2, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else icon(ctx, flame, iconX, groupY - iconSize * 0.5, iconSize, primary);
  text(ctx, countText, rtl ? groupX + numWidth : groupX + iconSize + gap, groupY + 0.3, numSize, countInk ?? primary, {
    weight: 700,
    rtl,
    align: rtl ? "right" : "left",
  });
  lines.forEach((s, i) => text(ctx, s, w / 2, lineY + i * leading, lineSize, primary, { rtl, align: "center" }));
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
function ladderSheet() {
  const c = sheet(712, 430);
  headings(c, "Time left to keep the streak");
  for (const [i, row] of ladder.entries()) {
    const x = 14 + (i % 4) * 175,
      y = 56 + Math.floor(i / 4) * 192;
    text(c, row[0], x, y - 11, 11, soft);
    tile(c, x, y, row, "tile", false, layoutSizes.tile, 12);
  }
  return c;
}

function specimen(c, x, y, scene, resource, height, headroom = 0) {
  // Height on the sheet measures the registered character, including its sprig.
  const side = height + 6 + headroom,
    spriteH = (height * 720) / 584,
    spriteW = (spriteH * 5) / 6;
  c.save();
  c.translate(x, y);
  c.beginPath();
  c.roundRect(0, 0, side, side, 8);
  c.clip();
  cover(c, images.get("scene_" + scene + "_sq"), side, side);
  c.drawImage(images.get(resource), (side - spriteW) / 2, headroom + 3 - (spriteH * 120) / 720, spriteW, spriteH);
  c.restore();
}
function poseScene(pose) {
  if (newFaces[pose]) return newFaces[pose];
  const base = pose.replace("_halo", "");
  return ladder.find((row) => row[2].replace("_halo", "") === base)[1];
}
function facesSheet() {
  const c = sheet(678, 660);
  headings(c, "Faces at 60 and 120 dp");
  let i = 0;
  for (const row of ladder) {
    if (row[2] === "shimmer") continue;
    const base = row[2].replace("_halo", "");
    for (const pose of [base, base + "_halo"].filter((p) => images.has("zayt_" + p))) {
      const x = 14 + (i % 3) * 222,
        y = 56 + Math.floor(i / 3) * 152;
      text(c, pose.replace("_", " · "), x, y - 10, 11, soft);
      specimen(c, x, y + 60, poseScene(pose), "zayt_" + pose, 60);
      specimen(c, x + 73, y, poseScene(pose), "zayt_" + pose, 120);
      i++;
    }
  }
  return c;
}
function loopsSheet(loops, headroom = 12) {
  const entries = Object.entries(loops);
  const stride = 108 + headroom;
  const c = sheet(572, 52 + entries.length * stride);
  headings(c, "Loop frames");
  for (const [i, [pose, frames]] of entries.entries()) {
    const y = 43 + i * stride;
    text(c, pose.replace("_", " · "), 14, y + 43, 11, paper);
    for (const [j, frame] of frames.entries()) {
      const x = 126 + j * 110;
      specimen(c, x, y, poseScene(pose), frame.file.replace("hafiz_widget_", "").replace(".webp", ""), 80, headroom);
      text(c, frame.durationMs + " ms", x, y + 95 + headroom, 9, soft);
    }
  }
  return c;
}
function thumbsSheet() {
  const c = sheet(464, 40 + Math.ceil(Object.keys(skies).length / 6) * 82);
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
function ladderV3Sheet() {
  const c = sheet(1068, 637);
  headings(c, "Time left to keep the streak");
  for (const [i, [level, scene, first, second, line]] of ladderPairs.entries()) {
    const x = 14 + (i % 3) * 354,
      y = 62 + Math.floor(i / 3) * 194;
    text(c, level, x, y - 12, 13, paper, { weight: 700 });
    for (const [j, pose] of [first, second].entries()) {
      tile(c, x + j * 167, y, [level, scene, pose, 12, "waiting", line], "tile", false, layoutSizes.tile, 8);
      text(c, pose.replace("_halo", ""), x + j * 167, y + 169, 10, soft);
    }
  }
  return c;
}

function facesV3Sheet() {
  const c = sheet(462, 504);
  headings(c, "New faces at 60 and 120 dp");
  for (const [i, [pose, scene]] of Object.entries(newFaces).entries()) {
    const x = 14 + (i % 2) * 228,
      y = 56 + Math.floor(i / 2) * 150;
    text(c, pose.replace("_", " · "), x, y - 10, 11, soft);
    specimen(c, x, y + 60, scene, "zayt_" + pose, 60);
    specimen(c, x + 73, y, scene, "zayt_" + pose, 120);
  }
  return c;
}

export function makeSheet(name, loops) {
  const c = {
    states: () => statesSheet(false),
    "states-ar": () => statesSheet(true),
    day: daySheet,
    ladder: ladderSheet,
    faces: facesSheet,
    loops: () => loopsSheet(Object.fromEntries(Object.entries(loops).filter(([pose]) => !newFaces[pose]))),
    "ladder-v3": ladderV3Sheet,
    "faces-v3": facesV3Sheet,
    "loops-v3": () => loopsSheet(Object.fromEntries(Object.entries(loops).filter(([pose]) => newFaces[pose])), 18),
    thumbs: thumbsSheet,
    flames: flamesSheet,
    home: homeSheet,
    sizes: sizeSheet,
  }[name]();
  return c.canvas.toDataURL().split(",")[1];
}

function wideCard(ctx, x, y, row, kind, w, h, rtl, outline = false) {
  const [, scene, pose, count, flame, en, ar] = row;
  const [primary, secondary, lit] = inks[scene];
  const m = columns(kind, w, h);
  const align = rtl ? "right" : "left",
    font = rtl ? "NotoSansArabic" : "Roboto";
  const countText = rtl ? new Intl.NumberFormat("ar-EG").format(count) : String(count);
  const inlineCount = m.flame + 4 + m.number * 1.25;
  const available = m.end - m.inset - (m.horizontal ? inlineCount + 8 : 0);
  const line = kind === "compact" || kind === "tiny" ? "" : rtl ? ar : en;
  const lines = line ? wrap(ctx, line, available, 2, "400 " + m.line + "px " + font) : [];
  const rows = wideRows(kind, w, h, { rtl, count: true, lines: lines.length, week: m.tall });
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, Math.min(16, h * 0.23));
  ctx.clip();
  cover(ctx, images.get("scene_" + scene + "_wide"), w, h);
  if (m.artWidth) {
    const artH = (m.artWidth * 6) / 5;
    ctx.drawImage(
      images.get("zayt_" + pose),
      rtl ? m.artEnd : w - m.artEnd - m.artWidth,
      h + (m.tall ? 8 : 6) - artH,
      m.artWidth,
      artH,
    );
  }
  for (const {
    role,
    rect: [left, top, right, bottom],
  } of rows) {
    const start = rtl ? right : left;
    const mid = (top + bottom) / 2;
    if (role === "count") {
      icon(ctx, flame, rtl ? start - m.flame : start, mid - m.flame / 2, m.flame, primary);
      text(
        ctx,
        countText,
        start + (rtl ? -1 : 1) * (m.flame + 4),
        mid,
        m.number,
        flame.startsWith("lit") ? lit : primary,
        { rtl, align, weight: 700 },
      );
    } else if (role === "line") {
      const leading = m.line * (rtl ? 1.55 : 1.22);
      lines.forEach((s, i) =>
        text(ctx, s, start, mid + (i - (lines.length - 1) / 2) * leading, m.line, primary, { rtl, align }),
      );
    } else {
      const labels = rtl ? "ح ن ث ر خ ج س" : "S M T W T F S";
      labels.split(" ").forEach((label, i) => {
        const cx = left + ((right - left) * ((rtl ? 6 - i : i) + 0.5)) / 7;
        if (role === "weekLabels") text(ctx, label, cx, mid, 10, secondary, { rtl, align: "center" });
        else if ([0, 2, 3, 5, 6].includes(i)) {
          icon(ctx, i === 6 ? "out" : "lit_t0", cx - 7, mid - 7, 14, primary);
        } else {
          ctx.beginPath();
          ctx.arc(cx, mid, 3.4, 0, Math.PI * 2);
          ctx.strokeStyle = secondary;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
    }
    if (outline) {
      ctx.strokeStyle = primary;
      ctx.globalAlpha = 0.66;
      ctx.lineWidth = 0.65;
      ctx.setLineDash(role.startsWith("week") ? [1, 1.5] : [4, 2]);
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

// Assemble the large sheet from 3× bands so Chromium never needs the full
// contact sheet as a single canvas. Both locales see the identical painting.
export function collisionBand(scene) {
  const c = sheet(2068, 442);
  const pose =
    { night: "nervous_halo", midnight: "frantic_halo", dawn_rose: "fretful", dawn_red: "nervous" }[scene] ??
    states.find((r) => r[1] === scene)[2];
  const row = ["", scene, pose, 12, "out", "Under 2 hours left!", "بقي أقل من ساعتين!"];
  const positions = [
    [0, 42],
    [410, 42],
    [750, 42],
    [0, 281],
    [260, 329],
    [750, 231],
    [410, 247],
    [601, 385],
    [601, 324],
    [830, 336],
  ];
  for (const [j, rtl] of [false, true].entries()) {
    const origin = 12 + j * 1035;
    text(c, scene.replace("_", " ") + (rtl ? "    Arabic" : "    English"), origin, 12, 13, paper, { weight: 700 });
    for (const [i, [kind, w, h]] of wideExamples.entries()) {
      const [px, py] = positions[i];
      text(c, w + " × " + h + (kind === "compact" ? "  compact" : ""), origin + px, py - 7, 9, soft);
      wideCard(c, origin + px, py, row, kind, w, h, rtl, true);
    }
  }
  return c.canvas.toDataURL().split(",")[1];
}
