export function rest() {
  return {
    root: [0, 0, 0],
    height: 1,
    width: 1,
    sit: 0,
    arms: [29, 29],
    chest: 0,
    feet: 0,
    leaf: 0,
    leafFollower: 0,
    glow: 0,
    fillHeight: 3.2,
    sweep: -2,
    halo: 0,
    motes: [],
    drift: 0,
    opacity: 1,
    face: { eyeOpen: 1, browHeight: 0, browTilt: 0, mouthCurve: 0, blush: 0.5, highlight: 1 },
  };
}

const unit = (time, from, to) => Math.max(0, Math.min(1, (time - from) / (to - from)));
const ease = (time, from, to) => (1 - Math.cos(Math.PI * unit(time, from, to))) / 2;
const gate = (time, a, b, c, d) => ease(time, a, b) * (1 - ease(time, c, d));
const blink = (time, start, closed = 0.34, travel = 0.1) =>
  1 - gate(time, start, start + travel, start + travel + closed, start + 2 * travel + closed);
function ring(time, start, end) {
  const phase = unit(time, start, end);
  return Math.sin(phase * Math.PI * 4) * Math.exp(-3 * phase) * Math.sin(Math.PI * phase);
}
const breath = (time) => gate(time, 0, 2.4, 2.4, 4.8);
function wave(time) {
  return 29 + 96 * gate(time, 0.2, 0.6, 1.3, 1.6) + 20 * gate(time, 0.6, 0.95, 0.95, 1.3);
}
export const peaks = {
  A01: [],
  A02: [2.4, 3.38],
  A04: [0.6, 0.95, 1.3, 1.69],
  A06: [0.32, 0.58, 0.82, 1.3],
  A07: [0.9, 1.6, 1.82, 2.33],
  A08: [0.55, 0.78, 0.96, 1.5],
  A10: [0.5, 0.92, 1.4],
  A11: [0.6, 1, 1.19, 1.45, 1.8],
  A15: [1, 1.8, 2.1, 2.45, 2.86],
  A17: [0.13, 0.36, 0.54],
  A19: [0.2, 0.45, 0.55, 0.67, 1.55, 2.35],
};
export function hold(name) {
  const pose = rest();
  if (name.startsWith("warm_smile")) pose.face.mouthCurve = 1;
  if (name === "warm_smile_glow_35") pose.glow = pose.halo = 0.35;
  if (name === "seated") {
    pose.sit = pose.feet = 1;
    pose.height = 0.92;
    pose.width = 1 / Math.sqrt(0.92);
  }
  return pose;
}
export function sample(job, time, level = 1) {
  const { id, seconds, tier } = job,
    small = tier === "S",
    pose = rest();
  if (id === "A01") return pose;
  if (time === seconds) return hold(job.hold);
  const face = pose.face;
  if (!["A02", "A11", "A19"].includes(id)) face.mouthCurve = ease(time, 0, 0.3);
  switch (id) {
    case "A02": {
      const rise = breath(time);
      pose.height += rise * (small ? 0.04 : 0.02);
      pose.width += rise * (small ? 0.02 : 0.01);
      pose.leaf = -(small ? 15 : 7.5) * rise;
      pose.leafFollower = -(small ? 13 : 7) * breath(Math.max(0, time - 0.065)) * (1 - ease(time, 4.6, 4.8));
      if (level >= 2) {
        pose.breathHeight = pose.height - 1;
        pose.baseWidth = pose.width - 1;
        pose.height = pose.width = 1;
      }
      face.eyeOpen = blink(time, 3.155, 0.34, 0.04);
      break;
    }
    case "A04":
      pose.arms[0] = wave(time);
      pose.height -= 0.013 * ring(time, 1.6, 1.8);
      pose.leaf = 4 * ring(time, 1.57, 1.8);
      break;
    case "A06": {
      const phase = unit(time, 0.2, 1);
      const ramp =
        phase < 0.1 ? (phase * phase) / 0.18 : phase > 0.9 ? 1 - (1 - phase) ** 2 / 0.18 : (phase - 0.05) / 0.9;
      pose.sweep = time > 0.2 && time < 1 ? -0.23 + 3.36 * ramp : -2;
      face.eyeOpen = blink(time, 1.1, 0.34, 0.075);
      break;
    }
    case "A07":
    case "A15": {
      const juz = id === "A15",
        peak = juz ? 1.8 : 1.6,
        progress = ease(time, 0.3, peak);
      pose.glow = progress * (1 - 0.65 * ease(time, peak + 0.12, juz ? 3.3 : 2.8));
      pose.fillHeight = -0.02 + 3.22 * progress;
      pose.halo =
        level >= 2
          ? ease(time, peak - (juz ? 0.68 : 0.47), peak) * (1 - 0.65 * ease(time, peak + 0.2, peak + 0.78))
          : pose.glow;
      face.eyeOpen = blink(time, 1.6, 0.35, 0.09);
      if (juz) {
        const count = level >= 3 ? 5 : 6;
        pose.motes = Array.from({ length: count }, (_, idx) => {
          const launch = 1 + (0.88 * idx) / (count - 1);
          return unit(time, launch, launch + 1.12);
        });
      }
      break;
    }
    case "A08": {
      const swell = gate(time, 0.2, 0.57, 0.57, 0.89),
        wobble = ring(time, 0.62, 1.2);
      pose.width += (small ? 0.06 : 0.03) * (swell + 0.65 * wobble);
      pose.height = 1 / Math.sqrt(pose.width);
      pose.leaf = (small ? 22 : 12) * gate(time, 0.24, 0.61, 0.61, 0.97) + 7 * ring(time, 0.7, 1.27);
      pose.leafFollower = (small ? 18 : 10) * gate(time, 0.29, 0.66, 0.66, 1.02) + 5 * ring(time, 0.74, 1.3);
      face.eyeOpen = blink(time, 1.3);
      break;
    }
    case "A10":
      pose.chest = gate(time, 0, 0.5, 1.4, 2);
      face.eyeOpen = blink(time, 0.52, 0.4, 0.22);
      break;
    case "A11":
      pose.sit = pose.feet = ease(time, 0, 1);
      pose.height = 1 - 0.08 * pose.sit + 0.009 * Math.abs(ring(time, 1, 1.6));
      pose.width = 1 / Math.sqrt(pose.height);
      pose.leaf = -9 * gate(time, 0.3, 1, 1, 1.4) + 3 * ring(time, 1.06, 1.6);
      face.eyeOpen = blink(time, 1.45, 0.35, 0.13);
      break;
    case "A17":
      face.mouthCurve = 1 + 0.4 * gate(time, 0, 0.17, 0.17, 0.45);
      face.eyeOpen = blink(time, 0, 0.15, 0.075);
      pose.leaf = -16 * gate(time, 0.1, 0.36, 0.36, 0.68);
      pose.leafFollower = -13 * gate(time, 0.14, 0.4, 0.4, 0.7);
      break;
    case "A19":
      pose.opacity = ease(time, 0, 0.2);
      pose.root[1] = 0.61 * (1 - ease(time, 0, 0.45));
      face.eyeOpen = ease(time, 0.5, 0.7);
      pose.height -= 0.075 * gate(time, 0.45, 0.55, 0.55, 0.66) + 0.014 * ring(time, 0.55, 0.75);
      pose.arms[0] = wave(((time - 0.75) * 1.8) / 1.6);
      pose.leaf = 11 * ring(time, 0.45, 0.79);
      pose.leafFollower = 8 * ring(time, 0.49, 0.82);
      face.mouthCurve = ease(time, 0.75, 1.05);
      break;
  }
  if (["A04", "A19"].includes(id)) pose.width = 1 / Math.sqrt(pose.height);
  if (id !== "A02" && id !== "A08" && id !== "A17" && id !== "A19") pose.leafFollower = pose.leaf * 0.65;
  return pose;
}
