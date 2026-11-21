// Front-surface artwork in the oil body's coordinates. (200, 170) is the centre
// of the studio eye line. The shader keeps the original cheeks and reflections.
const ink = "#422615";
const stroke = (d, width, color = ink) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const fill = (d, color) => `<path d="${d}" fill="${color}"/>`;
const ellipse = (cx, cy, rx, ry, color) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}"/>`;

const faces = {
  eager: {
    eyes: [123, 277, 159, 25, 27, 0.94],
    brows: ["M96 115 Q113 98 136 108", "M261 108 Q279 98 299 113"],
    mouth: "M158 200 Q197 217 242 194 C230 244 184 255 158 200Z",
    tongue: "M175 227 Q197 216 220 226 Q197 245 175 227Z",
  },
  impatient: {
    eyes: [122, 277, 157, 32, 26, 0.83],
    lids: [0.04, 0.38],
    brows: ["M94 118 Q114 94 144 102", "M254 121 Q278 117 303 126"],
    lip: "M169 215 Q184 207 196 210 L223 212",
  },
  worried: {
    eyes: [131, 268, 159, 29, 32, 0.94],
    brows: ["M100 128 Q133 127 155 100", "M244 100 Q267 127 296 126"],
    lip: "M162 228 C180 203 214 197 237 222",
  },
  anxious: {
    eyes: [126, 268, 154, 40, 43, 0.82],
    brows: ["M90 114 Q118 106 149 77", "M243 79 Q261 103 300 109"],
    lip: "M153 225 Q167 201 181 216 T204 215 Q214 200 227 213 T246 210",
  },
  panicked: {
    eyes: [136, 264, 148, 46, 53, 0.56],
    brows: ["M93 91 C105 86 122 60 153 56", "M245 58 C272 51 284 74 305 81"],
    mouth: "M177 238 C174 216 185 201 198 200 C216 197 226 215 222 238 C219 263 183 267 177 238Z",
    tongue: "M184 247 Q199 233 216 245 C210 260 192 262 184 247Z",
  },
  relieved: {
    eyes: [124, 276, 163, 27, 24, 0.94],
    lids: [0.17, 0.17],
    brows: ["M96 124 Q114 108 138 116", "M256 118 Q280 108 300 122"],
    mouth: "M146 198 C179 218 218 218 252 194 C243 252 178 266 146 198Z",
    tongue: "M170 232 Q195 218 227 231 C211 247 187 250 170 232Z",
  },
  lonely: {
    eyes: [129, 268, 164, 30, 32, 0.86],
    brows: ["M102 126 Q125 125 148 109", "M249 111 Q272 129 297 127"],
    lip: "M176 213 Q196 238 226 206",
  },
};

const definitions = `<defs>
  <linearGradient id="white" x2=".17" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#c7a576"/><stop offset=".35" stop-color="#fff1ca"/><stop offset=".8" stop-color="#fff6df"/><stop offset="1" stop-color="#eacfa3"/></linearGradient>
  <linearGradient id="iris" x2=".28" y2="1"><stop stop-color="#251812"/><stop offset=".53" stop-color="#3a2416"/><stop offset=".85" stop-color="#794b1e"/><stop offset="1" stop-color="#ab7935"/></linearGradient>
  <linearGradient id="smile" x2="0" y2="1"><stop stop-color="#311c17"/><stop offset="1" stop-color="#703c25"/></linearGradient>
  <linearGradient id="oilBead" x1=".1" y1="0" x2=".9" y2="1"><stop stop-color="#fff7cf"/><stop offset=".33" stop-color="#ffdf8a"/><stop offset=".67" stop-color="#c88a2e"/><stop offset="1" stop-color="#fce08b"/></linearGradient>
</defs>`;

function eye(cx, cy, rx, ry, pupil, lid, lookX, lookY, blink, index) {
  const open = 1 - blink;
  if (open === 0) return stroke(`M${cx - rx} ${cy} q${rx} 10 ${2 * rx} -1`, 6);
  const height = ry * open;
  const top = cy - height;
  // The upper edge of the eye itself forms the lid, so no skin-coloured paint
  // covers the oil's highlight when the eyes narrow or glance sideways.
  const aperture = `M${cx - rx} ${cy}
    C${cx - rx} ${top + lid * height} ${cx - rx * 0.43} ${top + lid * height * 2} ${cx} ${top + lid * height * 2}
    S${cx + rx} ${top + lid * height} ${cx + rx} ${cy}
    C${cx + rx} ${cy + 1.33 * height} ${cx - rx} ${cy + 1.33 * height} ${cx - rx} ${cy}Z`;
  const px = cx + lookX,
    py = cy + lookY,
    r = rx * pupil;
  return `<defs><clipPath id="eye${index}"><path d="${aperture}"/></clipPath></defs>
    <path d="${aperture}" fill="url(#white)" stroke="#57381b" stroke-width="3.3"/>
    <g clip-path="url(#eye${index})">
    ${ellipse(px, py, r, r * 1.09, "url(#iris)")}${ellipse(px, py - r * 0.08, r * 0.64, r * 0.69, "#291b14")}
    ${ellipse(px - r * 0.31, py - r * 0.38, r * 0.21, r * 0.23, "#fff9e8")}${ellipse(px + r * 0.31, py - r * 0.04, r * 0.085, r * 0.082, "#ffe7be")}
    </g>`;
}

function bead(x, y, scale, angle) {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
    <path d="M0 -20 C0 -12 -13 -1 -12 7 C-11 23 12 22 12 7 Q12 0 7 -8Z" fill="url(#oilBead)" stroke="#a8782d" stroke-width="2"/>
    ${stroke("M-2 -6 Q-9 3 -7 8", 3.5, "#fff9d7")}</g>`;
}

export function faceArt(name, { lookX = 0, lookY = 0, blink = 0, drip = 0 } = {}) {
  const face = faces[name];
  const [left, right, cy, rx, ry, pupil] = face.eyes;
  let drawing = face.brows
    .map((d) => stroke(d, ["worried", "anxious", "panicked"].includes(name) ? 8.5 : 7.5, "#62401e"))
    .join("");
  for (const [i, cx] of [left, right].entries()) {
    drawing += eye(cx, cy, rx, ry, pupil, face.lids?.[i] || 0, lookX, lookY, blink, i);
  }
  drawing += face.mouth ? fill(face.mouth, "url(#smile)") + fill(face.tongue, "#bc7562") : stroke(face.lip, 7);
  if (name === "worried") drawing += bead(326 + 13 * drip, 118 + drip * 55, 1.14 - 0.14 * drip, -14);
  if (name === "anxious") drawing += bead(325, 110, 1.03, -15) + bead(57, 142, 0.78, 12);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 400 300">${definitions}${drawing}</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
