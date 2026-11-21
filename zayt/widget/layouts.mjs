// Android RemoteViews sizes in dp. The compact strip has its count at the
// start, its art at the end and no line. The tiny bucket can show a line alone.
export const wideExamples = [
  ["roomy", 400, 220],
  ["roomy", 330, 190],
  ["wide", 250, 170],
  ["low", 250, 130],
  ["short", 330, 100],
  ["short", 170, 80],
  ["short", 250, 64],
  ["strip", 210, 48],
  ["compact", 130, 48],
  ["tiny", 110, 56],
];

export function columns(layout, w, h) {
  const tall = ["roomy", "wide", "low"].includes(layout);
  const low = layout === "low";
  const horizontal = ["strip", "compact", "tiny"].includes(layout);
  const inset = tall ? 16 : horizontal ? (layout === "tiny" ? 8 : 10) : 12;
  const artEnd = tall ? 8 : 4;
  const artWidth =
    layout === "tiny"
      ? 0
      : Math.min(
          tall ? (layout === "roomy" ? 165 : 112) : horizontal ? 72 : 84,
          ((h + (tall ? (low ? 0 : -2) : 16)) * 5) / 6,
        );
  return {
    tall,
    low,
    horizontal,
    inset,
    artEnd,
    artWidth,
    end: artWidth ? w - artWidth - artEnd - (tall ? 4 : 2) : w - 2,
    number: tall ? (low ? 30 : 34) : horizontal ? 20 : 22,
    flame: tall ? (low ? 24 : 28) : horizontal ? 18 : 20,
    line: tall ? (low ? 13 : 15) : 12,
  };
}

// Centre the visible group as the XML does. The padded line box allows for
// Arabic ascenders/descenders and wrapping. The entire seven-cell band is
// reserved so labels, today's open flame and hollow marks all stay clear.
export function wideRows(layout, w, h, { rtl, lines, count, week }) {
  const m = columns(layout, w, h);
  const numberH = count ? Math.ceil(m.number * (rtl ? 1.48 : 1.2)) : m.flame;
  const lineH = lines ? Math.ceil(m.line * (rtl ? 1.65 : 1.28) * lines) + 3 : 0;
  const labelH = rtl ? 17 : 13;
  const weekH = week ? labelH + 3 + 14 : 0;
  const gap = lineH && !m.horizontal ? (m.tall ? 4 : 2) : 0;
  const weekGap = weekH ? (m.low ? 6 : 8) : 0;
  const stack = m.horizontal ? Math.max(numberH, lineH) : numberH + gap + lineH + weekGap + weekH;
  const top = Math.max(0, (h - stack) / 2);
  const rows = [];
  function add(role, left, y, right, height) {
    if (!height || right <= left) return;
    rows.push({
      role,
      rect: [rtl ? w - right : left, Math.max(0, y), rtl ? w - left : right, Math.min(h, y + height)],
    });
  }
  const countEnd =
    m.horizontal && lines ? Math.min(m.end, m.inset + m.flame + (count ? 4 + m.number * 1.25 : 0)) : m.end;
  add("count", m.inset, m.horizontal ? (h - numberH) / 2 : top, countEnd, numberH);
  const lineTop = m.horizontal ? (h - lineH) / 2 : top + numberH + gap;
  add("line", m.horizontal ? countEnd + (layout === "tiny" ? 4 : 8) : m.inset, lineTop, m.end, lineH);
  if (week) {
    const labelTop = lineTop + lineH + weekGap;
    add("weekLabels", m.inset, labelTop, m.end, labelH);
    add("weekMarks", m.inset, labelTop + labelH + 3, m.end, 14);
  }
  return rows;
}

// A 130 dp tile can show both count and two lines. Smaller tiles show one or
// the other with art. Reserve the full width through 98 dp (10 top, 39 count, 2 gap, 46 line and
// a rounding margin), even on the shortest 130 dp tile that shows both.
// Under centerCrop the lower edge of this band sweeps towards the midpoint.
export const squareInkBottom = 98 / 130;
export function textBounds() {
  const wide = [{ role: "ink", rect: [0, 0, 1, 1] }];
  for (const [layout, w, h] of wideExamples.filter(([kind]) => ["roomy", "wide", "low"].includes(kind))) {
    for (const rtl of [false, true])
      for (const lines of [0, 1, 2])
        for (const count of [false, true]) {
          for (const { role, rect } of wideRows(layout, w, h, { rtl, lines, count, week: true })) {
            if (role === "weekLabels") wide.push({ role, rect: rect.map((v, i) => v / (i % 2 ? h : w)) });
          }
        }
  }
  return { sq: [{ role: "ink", rect: [0, 0, 1, squareInkBottom] }], wide };
}
