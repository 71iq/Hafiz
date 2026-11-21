import path from "node:path";
import { save } from "../studio/common.mjs";
import { out } from "./paths.mjs";

// A lamp wick pulls the flame to a narrow, wind-bent tip above a rounded oil bowl.
const silhouette =
  "M13.5 1.35C14.35 5.85 18.6 8.85 19.15 13.5C19.8 18.55 16.75 22.4 12.05 22.5C7.4 22.6 4.28 19.55 4.55 15.05C4.8 10.95 8.45 8.2 9.12 5.3C9.95 6.3 10.24 7.65 10.12 8.7C11.82 6.85 12.8 4.65 13.5 1.35Z";
const innerEdge =
  "M13.18 6.65C14.52 9.45 17.15 11.75 17.43 14.05C17.92 17.89 15.59 20.72 12.02 20.81C8.52 20.87 6.11 18.59 6.26 15.25C6.41 12.85 7.89 11.24 8.75 10.22C8.75 11.16 8.57 12.11 8.15 13.14C10.47 12.07 12.35 9.72 13.18 6.65Z";
const glint = (x, y, s) =>
  `M${x} ${y - s}q.2 ${s * 0.78} ${s * 0.7} ${s}q${-s * 0.53} .22 ${-s * 0.7} ${s}q-.2 ${-s * 0.78} ${-s * 0.7} ${-s}q${s * 0.54} -.17 ${s * 0.7} ${-s}Z`;
export function flames() {
  const palette = [
    ["#ECB354", "#A74422", "#FFC15A"],
    ["#FCBA45", "#BA4320", "#FFD575"],
    ["#FFBA3B", "#C54616", "#FFE99D"],
    ["#FFC647", "#C03C1A", "#FFF2B5"],
    ["#FFCF57", "#C83F19", "#FFF4BE"],
    ["#FFD771", "#C33D1A", "#FFFACE"],
    ["#FFE898", "#B23C1A", "#FFFFE5"],
  ];
  const svg = (body) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">\n' + body + "\n</svg>\n";
  const write = (name, body) => save(path.join(out, "flame", name + ".svg"), svg(body));
  write("flame_unlit", `<path fill="#353934" d="${silhouette}"/>`);
  // Opposite contour winding preserves the hole in VectorDrawable's default nonzero mode too.
  const hole =
    "M12.02 20.48C15.49 20.39 17.53 17.73 17.10 14.03C16.84 11.87 14.75 9.70 13.26 7.10C12.3 9.86 10.51 12.03 7.89 13.54C8.16 12.64 8.28 12.08 8.38 11.42C7.35 12.56 6.62 13.77 6.53 15.27C6.39 18.37 8.64 20.56 12.02 20.48Z";
  write("flame_out", `<path fill="#353934" fill-rule="evenodd" d="${silhouette}${hole}"/>`);
  for (const [tier, [tip, edge, heart]] of palette.entries()) {
    const high = [13.7, 12.1, 10.5, 10.1, 9.9, 9.6, 9.3][tier];
    const core = `M12.2 20.6C9.56 20.67 8.03 18.47 8.62 16.6C8.99 15.43 10.25 14.6 10.69 13.85C10.83 14.48 10.92 15.07 10.78 15.7C12.05 14.79 12.96 12.98 13.25 ${high}C13.7 13.34 15.82 15.5 15.69 17.25C15.54 19.3 14.16 20.5 12.2 20.6Z`;
    let body = `<defs><linearGradient id="oil" gradientUnits="userSpaceOnUse" x1="7" y1="2" x2="11" y2="22"><stop stop-color="${tip}"/><stop offset=".54" stop-color="#EF8731"/><stop offset="1" stop-color="${edge}"/></linearGradient></defs>
<path fill="url(#oil)" d="${silhouette}"/>
<path fill="${tip}" d="${innerEdge}"/>
<path fill="${heart}" d="${core}"/>`;
    if (tier >= 3)
      body +=
        '\n<path fill="#F69C36" d="M6.15 12.21C6.3 11.2 5.79 9.83 5.2 8.84C5.15 11.1 3.22 12.35 3.4 15.23C3.56 17.72 5.36 19.62 7.34 20.01C5.45 17.86 5.24 15.04 6.15 12.21Z"/>';
    if (tier >= 4) body += `\n<path fill="${heart}" d="${glint(18.9, 5.9, 2.4)}"/>`;
    if (tier >= 5) body += `\n<path fill="${tip}" d="${glint(3.3, 6, 2.1)}"/>`;
    if (tier >= 6)
      body += `\n<path fill="${heart}" d="${glint(21.7, 11, 1.7)}"/><path fill="#FFFFFF" d="M11.1 18.94C11.42 17.78 12.7 17.01 13.14 15.42C14.05 16.92 14.02 18.25 13.24 18.99C12.59 19.62 11.64 19.61 11.1 18.94Z"/>`;
    write("flame_lit_t" + tier, body);
  }
}
