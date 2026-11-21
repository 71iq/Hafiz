// Skies run from zenith through the horizon. Land runs from distant ridges to the near grove.
export const skies = {
  dawn: ["#9acdc6", "#e7d6bd", "#ffa581", "#fff0bc"],
  morning: ["#8acde4", "#c9eacb", "#ffdfa2", "#fff5cd"],
  day: ["#64bee9", "#89d1eb", "#daf0e7", "#fff7d2"],
  golden: ["#f3ab61", "#ffcb79", "#ffdc9c", "#fff1be"],
  dusk: ["#30234e", "#663761", "#ff739e", "#ffc49f"],
  night: ["#182658", "#304479", "#776f99", "#ffdfb6"],
  midnight: ["#080e24", "#101a37", "#233249", "#a6bed2"],
  sunrise: ["#e7a9a5", "#ffcab2", "#ffe29e", "#fffbd2"],
  radiant: ["#ffdd82", "#ffedb0", "#fff5c4", "#fffae3"],
  radiant_night: ["#252847", "#454057", "#a77449", "#ffd38c"],
  milestone: ["#e6a04e", "#ffc169", "#ffe897", "#fff7be"],
  calm: ["#bbb7da", "#d6cde4", "#bde0d5", "#eef1e9"],
};
const land = {
  dawn: ["#b7aba8", "#a3afa1", "#82a69a", "#669588", "#477d73", "#94b099"],
  morning: ["#b5c2a2", "#a7bd99", "#90ad82", "#82ac84", "#5d8f73", "#cbd3a1"],
  day: ["#8ab8b1", "#81b4a3", "#67a594", "#66a381", "#488b74", "#b2d09a"],
  golden: ["#dbb18c", "#c8a37e", "#b7996f", "#b19b60", "#94875b", "#f1cc89"],
  dusk: ["#a2758b", "#885d7e", "#764f72", "#694866", "#443754", "#9c7583"],
  night: ["#606189", "#51577a", "#464e72", "#393f60", "#2d3655", "#626483"],
  midnight: ["#29354b", "#242f49", "#1e2a41", "#19283b", "#142032", "#354253"],
  sunrise: ["#d6ab92", "#c3a18e", "#b49d83", "#a3a583", "#778b73", "#ded3a0"],
  radiant: ["#e7c68a", "#d8bd7e", "#c4b678", "#b6ac69", "#8d965e", "#ebdb98"],
  radiant_night: ["#997951", "#7a6853", "#60594f", "#515348", "#363f42", "#ab8a59"],
  milestone: ["#d3a064", "#c09858", "#b19355", "#a68348", "#8c764d", "#eacd85"],
  calm: ["#adb4c0", "#a4b7b8", "#8eaaa7", "#78a49b", "#638c85", "#b7c9ba"],
};
// Light direction stays to the left. The disc and land are deliberately at different
// heights through the day. Positions are expressed in units of the visible window.
const places = {
  dawn: [0.27, 0.693, 40, 0.5, 1],
  morning: [0.19, 0.44, 32, 1.3, 3],
  day: [0.32, 0.26, 22, 2.4, 6],
  golden: [0.21, 0.57, 44, 1.8, 2],
  dusk: [0.28, 0.692, 31, 2.9, 4],
  night: [0.14, 0.62, 24, 3.2, 0],
  midnight: [0.28, 0.68, 0, 1.7, 0],
  sunrise: [0.34, 0.671, 48, 2.1, 2],
  radiant: [0.51, 0.76, 0, 0.85, 2],
  radiant_night: [0.55, 0.79, 0, 2.7, 0],
  milestone: [0.56, 0.78, 0, 1.05, 0],
  calm: [0.18, 0.63, 0, 3.7, 4],
};
export const inks = {
  dawn: ["#182C30", "#293E3E"],
  morning: ["#173039", "#263E40"],
  day: ["#142D35", "#203E45"],
  golden: ["#34251C", "#473327"],
  dusk: ["#FFF9EF", "#F9E9EA"],
  night: ["#FFF9ED", "#F2EAF7"],
  midnight: ["#FFFAED", "#D6DBEA"],
  sunrise: ["#32232F", "#44333C"],
  radiant: ["#342B19", "#443723"],
  radiant_night: ["#FFF8E5", "#F4E6D1"],
  milestone: ["#302317", "#44321F"],
  calm: ["#272D3A", "#373D49"],
};

export function lightPosition(scene, crop) {
  const [sx, sy, radius] = places[scene];
  if (crop === "wide" && scene === "night") return { x: 0.504, y: 0.722, radius: 0.03 };
  if (crop === "wide" && scene === "dusk") return { x: 0.493, y: 0.741, radius: 0.028 };
  return {
    x: crop === "wide" && !radius && scene !== "calm" && scene !== "midnight" ? 0.7 : sx,
    y: sy,
    radius: radius / 600,
  };
}

export function paintGrove(canvas, scene, crop) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const H = 600,
    W = (canvas.width / canvas.height) * H;
  const sky = skies[scene],
    earth = land[scene];
  const [, , , phase, clouds] = places[scene];
  const night = ["night", "midnight", "radiant_night"].includes(scene),
    dark = night || scene === "dusk";
  const beam = ["sunrise", "radiant", "milestone", "radiant_night"].includes(scene);
  const wide = crop === "wide";
  const light = lightPosition(scene, crop);
  const X = W * light.x,
    Y = H * light.y,
    radius = light.radius * H;
  let seed = 81027 + Object.keys(skies).indexOf(scene) * 837;
  const rnd = () => (seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296;
  const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a = 1) => "rgba(" + [...c, a].join(",") + ")";
  const blend = (a, b, t, opacity = 1) => rgb(mix(hex(a), hex(b), t), opacity);
  const color = (s, a) => rgb(hex(s), a);
  const stops = (gradient, values) => {
    for (const [t, c] of values) gradient.addColorStop(t, c);
    return gradient;
  };
  const linear = (x1, y1, x2, y2, values) => stops(ctx.createLinearGradient(x1, y1, x2, y2), values);
  function disc(x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function mist(x, y, rx, ry, tint, opacity) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const g = stops(ctx.createRadialGradient(0, 0, 0, 0, 0, 1), [
      [0, color(tint, opacity)],
      [0.37, color(tint, opacity * 0.68)],
      [0.75, color(tint, opacity * 0.19)],
      [1, color(tint, 0)],
    ]);
    disc(0, 0, 1, g);
    ctx.restore();
  }
  function stroke(points, fill, weight) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i += 3) ctx.bezierCurveTo(...points[i], ...points[i + 1], ...points[i + 2]);
    ctx.strokeStyle = fill;
    ctx.lineWidth = weight;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function glint(x, y, r, tint, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    for (let k = 0; k < 4; k++) {
      ctx.quadraticCurveTo(r * 0.12, -r * 0.12, r * 0.72, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.closePath();
    ctx.fillStyle = color(tint, a);
    ctx.fill();
    ctx.restore();
  }
  function leaf(x, y, length, breadth, angle, fill) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(length * 0.31, -breadth, length * 0.71, -breadth * 0.75, length, 0);
    ctx.bezierCurveTo(length * 0.62, breadth * 0.77, length * 0.35, breadth, 0, 0);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }
  ctx.scale(canvas.height / H, canvas.height / H);
  ctx.fillStyle = linear(0, 0, W * 0.045, H * 0.83, [
    [0, sky[0]],
    [0.53, sky[1]],
    [0.91, sky[2]],
    [1, sky[2]],
  ]);
  ctx.fillRect(0, 0, W, H);
  mist(X, Y, W * 0.82, H * 0.61, sky[3], dark ? 0.2 : 0.42);
  if (scene === "midnight") {
    // Light hangs low in the valley, behind the ridge and the trees.
    mist(W * 0.54, H * 0.72, W * 0.87, H * 0.18, "#9b3946", 0.58);
    mist(W * 0.56, H * 0.715, W * 0.63, H * 0.081, "#d2594d", 0.34);
  }
  if (beam) {
    // Broad, feathered crepuscular rays in the landscape. No ring or crown on the character.
    const rays = scene === "milestone" ? 11 : 7;
    for (let i = 0; i < rays; i++) {
      const a = -3.03 + (i * 2.88) / (rays - 1) + rnd() * 0.07;
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(a);
      const length = W + H;
      const width = 0.06 + rnd() * 0.07;
      const gradient = ctx.createConicGradient(-width, 0, 0);
      const opacity = scene === "radiant_night" ? 0.068 : scene === "milestone" ? 0.26 : 0.17;
      for (const [j, strength] of [
        [0, 0],
        [0.22, 0.36],
        [0.5, 1],
        [0.71, 0.65],
        [1, 0],
      ])
        gradient.addColorStop((j * width) / Math.PI, color(sky[3], strength * opacity));
      gradient.addColorStop(1, color(sky[3], 0));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, length, -width, width);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();
    }
  }
  if (night || scene === "milestone") {
    if (scene === "midnight") ctx.globalAlpha = 0.94;
    const count = scene === "midnight" ? 14 : scene === "milestone" ? 20 : 37;
    for (let i = 0; i < count * (wide ? 1.55 : 1); i++) {
      const x = rnd() * W,
        y = (night ? 0.09 + rnd() * 0.53 : 0.23 + rnd() * 0.47) * H;
      if (night && Math.hypot(x - X, y - Y) < radius * 1.85) continue;
      const r = scene === "milestone" ? 2.6 + rnd() * 5 : 1 + rnd() * 1.5;
      if (i % 4 === 0 || !night) glint(x, y, r * (night ? 1.65 : 1), sky[3], night ? 0.53 : 0.8);
      else disc(x, y, r * 0.7, color(sky[3], 0.3 + rnd() * 0.34));
    }
    ctx.globalAlpha = 1;
  }
  if (radius) {
    mist(X, Y, radius * 5.5, radius * 4.3, sky[3], night ? 0.16 : 0.61);
    disc(
      X,
      Y,
      radius,
      linear(0, Y - radius, 0, Y + radius, [
        [0, color(sky[3], 0.96)],
        [1, blend(sky[3], sky[2], night ? 0.35 : 0.19, 0.97)],
      ]),
    );
  } else if (beam) mist(X, Y, W * 0.52, H * 0.4, sky[3], 0.87);

  // Long wind-sheared bands sit behind a few rounded, hand-modelled cloud banks.
  function cloud(x, y, w, h, opacity) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w, h);
    if (scene === "day" || scene === "calm") {
      // One anvil-shaped bank, with displaced masses and an uneven lit rim.
      ctx.beginPath();
      ctx.moveTo(-0.61, 0.12);
      ctx.bezierCurveTo(-0.53, 0.1, -0.49, 0.08, -0.42, -0.05);
      ctx.bezierCurveTo(-0.41, -0.22, -0.33, -0.32, -0.29, -0.23);
      ctx.bezierCurveTo(-0.28, -0.43, -0.23, -0.57, -0.17, -0.54);
      ctx.bezierCurveTo(-0.15, -0.82, -0.08, -1.04, 0.01, -0.95);
      ctx.bezierCurveTo(0.065, -0.98, 0.116, -0.8, 0.12, -0.64);
      ctx.bezierCurveTo(0.195, -0.72, 0.24, -0.63, 0.26, -0.46);
      ctx.bezierCurveTo(0.34, -0.52, 0.4, -0.31, 0.4, -0.18);
      ctx.bezierCurveTo(0.48, -0.21, 0.49, -0.035, 0.54, -0.01);
      ctx.bezierCurveTo(0.63, 0.02, 0.65, 0.1, 0.71, 0.12);
      ctx.bezierCurveTo(0.45, 0.16, 0.41, 0.23, 0.15, 0.19);
      ctx.bezierCurveTo(-0.07, 0.27, -0.11, 0.16, -0.3, 0.2);
      ctx.closePath();
      ctx.fillStyle = linear(0, -1, 0, 0.3, [
        [0, color(sky[3], opacity)],
        [0.55, color(sky[3], opacity * 0.86)],
        [1, blend(sky[3], sky[0], 0.35, opacity * 0.67)],
      ]);
      ctx.fill();
      ctx.restore();
      return;
    }
    const lobes = 5 + Math.floor(rnd() * 4);
    const peaks = Array.from({ length: lobes }, (_, i) => {
      const f = (i + 0.5) / lobes;
      return Math.sin(Math.PI * f) ** 0.62 * (0.32 + rnd() * 0.72);
    });
    ctx.beginPath();
    ctx.moveTo(-0.53, 0.18);
    for (let i = 0; i < lobes; i++) {
      const x0 = -0.5 + i / lobes,
        d = 1 / lobes,
        high = peaks[i];
      ctx.bezierCurveTo(x0 + 0.1 * d, -high * 0.58, x0 + 0.48 * d, -high * 1.15, x0 + 0.71 * d, -high * 0.82);
      ctx.quadraticCurveTo(x0 + 0.96 * d, -high * 0.86, x0 + d, -Math.min(high, peaks[i + 1] || 0) * 0.47);
    }
    ctx.quadraticCurveTo(0.54, 0.06, 0.57, 0.09);
    ctx.bezierCurveTo(0.28, 0.25, -0.27, 0.32, -0.53, 0.18);
    ctx.fillStyle = linear(0, -1, 0, 0.28, [
      [0, color(sky[3], opacity)],
      [0.67, color(sky[3], opacity * 0.76)],
      [1, blend(sky[3], sky[0], 0.45, opacity * 0.65)],
    ]);
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < clouds * (scene === "day" ? 0.65 : 1) * (wide ? 1.4 : 1); i++) {
    const x = ((i * 0.413 + 0.13 + phase * 0.17) % 1) * W;
    const y = (0.29 + ((i * 0.137 + phase * 0.11) % 0.32)) * H;
    cloud(
      x,
      y,
      (wide ? 125 : 91) + rnd() * 127,
      scene === "day" ? 20 + rnd() * 29 : 7 + rnd() * 16,
      scene === "day" ? 0.91 : scene === "calm" ? 0.68 : dark ? 0.31 : 0.54,
    );
  }
  if (!night) {
    for (let i = 0; i < 15; i++) {
      const x = rnd() * W,
        y = H * (0.46 + rnd() * 0.23),
        w = 19 + rnd() * 103;
      leaf(x, y, w, 1 + rnd() * 2.2, -0.023, color(sky[3], 0.11 + rnd() * 0.15));
    }
  }

  // Smooth ridge silhouettes. Shorter-wavelength facets show only on the far mountains.
  function hill(row, x) {
    const u = x / W,
      t = phase + u * (wide ? 5.1 : 3.5);
    const base = [0.705, 0.747, 0.807, 0.88, 0.99][row];
    const relief = [0.043, 0.036, 0.041, 0.052, 0.062][row];
    return (
      H *
      (base +
        (wide && scene === "night" && row < 2 ? 0.087 * Math.exp(-(((u - 0.504) / 0.11) ** 2)) : 0) +
        relief * (Math.sin(t * 1.61 + row * 1.9) + 0.43 * Math.sin(2.9 * t + row)) +
        (row < 2 ? 0.004 * Math.sin(t * 12 + row) + 0.002 * Math.sin(t * 29) : 0))
    );
  }
  function ridge(row) {
    ctx.beginPath();
    ctx.moveTo(-4, H + 2);
    for (let x = -4; x <= W + 5; x += 3) ctx.lineTo(x, hill(row, x));
    ctx.lineTo(W + 4, H + 2);
    ctx.closePath();
    ctx.fillStyle = linear(0, H * (0.62 + row * 0.05), W * 0.045, H * (1 + row * 0.05), [
      [0, earth[row]],
      [1, blend(earth[row], sky[2], 0.27)],
    ]);
    ctx.fill();
  }
  function tree(x, ground, s, distance) {
    ctx.save();
    ctx.translate(x, ground);
    ctx.scale(s, s);
    const bark = blend(earth[4], dark ? "#171e32" : "#5c5143", 0.37);
    const foliage = blend(earth[4], night ? "#101a33" : "#244e4b", distance ? 0.19 : 0.33);
    const lit = blend(earth[4], earth[5], distance ? 0.35 : 0.54);
    // The low fork and spreading crown distinguish a mature olive from a cypress.
    const side = rnd() > 0.5 ? 1 : -1;
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(-4, 1);
    ctx.bezierCurveTo(1, -5, -3, -10, -1, -15);
    ctx.bezierCurveTo(2, -19, -9, -21, -12, -26);
    ctx.bezierCurveTo(-5, -24, -1, -20, 2, -21);
    ctx.bezierCurveTo(6, -24, 9, -28, 11, -31);
    ctx.bezierCurveTo(10, -24, 6, -19, 3, -16);
    ctx.bezierCurveTo(0, -10, 4, -4, 6, 1);
    ctx.fillStyle = bark;
    ctx.fill();
    const clusters = [
      [-13, -27, 10, 6],
      [-5, -31, 12, 7],
      [8, -33, 12, 8],
      [17, -29, 9, 6],
      [0, -25, 14, 7],
      [-18, -23, 8, 5],
    ];
    for (const [cx, cy, rx, ry] of clusters) {
      ctx.beginPath();
      const points = 19;
      for (let i = 0; i <= points; i++) {
        const a = (i / points) * 2 * Math.PI,
          n = 0.77 + rnd() * 0.28;
        const px = cx + Math.cos(a) * rx * n,
          py = cy + Math.sin(a) * ry * n;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = foliage;
      ctx.fill();
      for (let j = 0; j < 5; j++)
        leaf(
          cx + (rnd() - 0.6) * rx * 1.5,
          cy - (0.2 + rnd() * 0.52) * ry,
          2 + rnd() * 4,
          0.6 + rnd() * 0.7,
          -0.45 + rnd() * 0.6,
          lit,
        );
    }
    ctx.restore();
  }
  ridge(0);
  ridge(1);
  for (let i = 0; i < (wide ? 38 : 19); i++) {
    const x = rnd() * W;
    tree(x, hill(1, x) + 3, 0.12 + rnd() * 0.11, true);
  }
  ridge(2);
  // Terrace lines follow the curve of the planting and fade towards the valley.
  for (let j = 0; j < 5; j++) {
    const start = W * (-0.35 + j * 0.21);
    stroke(
      [
        [start, H * 1.04],
        [start + W * 0.09, H * 0.88],
        [W * 0.63, H * 0.86],
        [W * 0.7 + j * 3, H * 0.79],
      ],
      blend(earth[5], earth[2], 0.12, 0.43),
      2.1 + j * 0.29,
    );
  }
  for (let i = 0; i < (wide ? 32 : 17); i++) {
    const x = ((i + rnd() * 0.9) * W) / (wide ? 32 : 17);
    tree(x, hill(2, x) + 3 + rnd() * 7, 0.21 + rnd() * 0.18, true);
  }
  ridge(3);
  // A sunlit farm track winds into the valley in three narrowing bends.
  const track = W * (0.52 + 0.14 * Math.sin(phase));
  ctx.beginPath();
  ctx.moveTo(track - 17, H * 1.02);
  ctx.bezierCurveTo(track + W * 0.32, H * 0.9, track - W * 0.12, H * 0.89, track + W * 0.02, H * 0.85);
  ctx.bezierCurveTo(track + W * 0.1, H * 0.82, track + W * 0.09, H * 0.817, track + W * 0.03, H * 0.811);
  ctx.bezierCurveTo(track + W * 0.19, H * 0.821, track + W * 0.04, H * 0.845, track + W * 0.027, H * 0.852);
  ctx.bezierCurveTo(track - W * 0.08, H * 0.895, track + W * 0.39, H * 0.901, track + W * 0.12, H * 1.02);
  ctx.fillStyle = blend(earth[5], sky[2], 0.2, 0.87);
  ctx.fill();
  // Sparse, curved marks catch the backs of the terraces. They follow the slope
  // in small clusters rather than outlining each layer.
  for (let i = 0; i < (wide ? 310 : 130); i++) {
    const x = rnd() * W,
      y = hill(3, x) + 2 + rnd() ** 2 * 36;
    const slope = Math.atan((hill(3, x + 5) - hill(3, x)) / 5);
    leaf(x, y, 1 + rnd() * 9, 0.26 + rnd() * 0.85, slope - 0.15 + rnd() * 0.31, color(earth[5], 0.12 + rnd() * 0.25));
  }
  const grouping = wide ? [0.06, 0.12, 0.29, 0.48, 0.77, 0.87, 0.97] : [0.08, 0.26, 0.64, 0.86, 0.96];
  for (const [i, u] of grouping.entries()) {
    const x = W * (u + 0.025 * Math.sin(phase + i));
    tree(x, hill(3, x) + 12, (i % 3 === 0 ? 1.0 : 0.57) * (0.8 + 0.3 * rnd()), false);
  }
  // A closer sentinel in each grove gives the silhouette a sense of scale.
  // The ridge, track and grove keep their bearings as the light changes.
  const sentinel = {
    dawn: [0.89, 2.0],
    morning: [0.09, 1.9],
    day: [0.91, 2.6],
    golden: [0.1, 2.6],
    dusk: [0.91, 2.1],
    night: [0.87, 2.15],
    midnight: [0.08, 2.25],
    sunrise: [0.1, 1.85],
    radiant: [0.1, 2.12],
    radiant_night: [0.12, 2.25],
    milestone: [0.91, 2.05],
    calm: [0.86, 2.42],
  }[scene];
  const tx = W * sentinel[0],
    ty = hill(3, tx) + 29;
  leaf(
    tx - 5,
    ty + 1,
    sentinel[1] * (scene === "golden" ? 47 : 29),
    sentinel[1] * 1.35,
    0.045,
    blend(earth[4], earth[3], 0.24, 0.61),
  );
  tree(tx, ty, sentinel[1], false);
  ridge(4);
  // In the nearest plane, silver-green leaves catch the same upper-left light as the oil.
  function bough(x, y, flip, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flip * scale, scale);
    const bark = blend(earth[4], dark ? "#152237" : "#35554a", 0.48);
    stroke(
      [
        [-15, 16],
        [19, -9],
        [48, -21],
        [76, -59],
      ],
      bark,
      2.2,
    );
    stroke(
      [
        [15, -6],
        [24, -21],
        [26, -35],
        [30, -45],
      ],
      bark,
      1.65,
    );
    for (const [lx, ly, len, ang] of [
      [7, -2, 25, -1.79],
      [12, -5, 32, -0.07],
      [22, -12, 29, -1.31],
      [29, -16, 28, -0.13],
      [42, -25, 29, -1.39],
      [49, -30, 31, -0.32],
      [58, -38, 25, -1.29],
      [66, -47, 21, -0.27],
      [73, -54, 20, -1.02],
      [23, -19, 20, -2.03],
      [26, -28, 20, -1.16],
      [28, -35, 18, -2.05],
    ]) {
      leaf(lx, ly, len, len * 0.15, ang, blend(earth[4], earth[5], 0.12 + rnd() * 0.37));
      leaf(lx, ly, len * 0.92, len * 0.036, ang - 0.025, color(earth[5], 0.58));
    }
    ctx.restore();
  }
  bough(-2, H - 5, 1, wide ? 1.65 : 1.33);
  bough(W + 4, H + 7, -1, wide ? 1.72 : 1.53);
  // Fine, deterministic pigment granulation breaks up the long sky gradients.
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const grain = (rnd() + rnd() - 1) * (dark ? 2.65 : 3.4);
    for (let c = 0; c < 3; c++) data.data[i + c] += grain;
  }
  ctx.putImageData(data, 0, 0);
}
