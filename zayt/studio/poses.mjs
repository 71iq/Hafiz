export function rest() {
  return {
    root: [0, 0, 0],
    height: 1,
    width: 1,
    sit: 0,
    spin: 0,
    lean: 0,
    reach: 0,
    burst: 0,
    sparkleCount: 0,
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
    face: { joy: 0, eyeOpen: 1, browHeight: 0, browTilt: 0, mouthCurve: 0, blush: 0.5, highlight: 1 },
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
  return (
    29 +
    121 * gate(time, 0.2, 0.6, 1.3, 1.6) -
    20 * gate(time, 0.6, 0.81, 0.81, 1.02) +
    10 * gate(time, 0.81, 1.05, 1.05, 1.3)
  );
}
// Heights are measured from the feet in units of the oil body (twig excluded).
const bodyHeight = 2.58;
function keys(time, points) {
  for (let n = 1; n < points.length; n++) {
    const [end, value] = points[n];
    if (time <= end) {
      const [start, previous] = points[n - 1];
      return previous + (value - previous) * ease(time, start, end);
    }
  }
  return points.at(-1)[1];
}
function arc(time, start, end, height) {
  const t = unit(time, start, end);
  return bodyHeight * height * 4 * t * (1 - t);
}
function stretch(pose, amount) {
  pose.height = 1 + amount;
  pose.width = 1 / Math.sqrt(pose.height);
}

function milestoneJump(pose, time, juz) {
  const launch = juz ? 0.6 : 0.35,
    arrive = juz ? 1.2 : 0.85,
    fall = juz ? 1.55 : 1.1,
    land = juz ? 1.74 : 1.25,
    release = juz ? 1.8 : 1.4,
    settle = juz ? 3.1 : 2.1,
    rise = unit(time, launch, arrive),
    descent = unit(time, fall, land),
    lift = juz ? 0.45 : 0.35,
    peak = juz ? 1.75 : 1.35;
  // The reach opens into the spin. At the apex the knees tuck and the sprig
  // trails, leaving headroom in the existing poster's fixed camera.
  pose.root[1] = bodyHeight * lift * (1 - (1 - rise) ** 2) * (1 - descent ** 2);
  pose.root[1] *= 0.94 + 0.06 * Math.sin(Math.PI * unit(time, arrive, fall));
  pose.spin = 2 * Math.PI * ease(time, launch, arrive);
  const tuck = juz ? -0.095 : -0.045;
  const shape = keys(time, [
    [0, 0],
    [launch - 0.07, -0.18],
    [launch, -0.06],
    [launch + 0.075, 0.18],
    [arrive - 0.18, tuck],
    [arrive, tuck],
    [fall, tuck],
    [land - 0.045, 0.045],
    [land + 0.035, -0.18],
    [release, -0.09],
  ]);
  let spring = 0;
  if (juz) {
    pose.root[1] += arc(time, release, 2.4, 0.15);
    spring = keys(time, [
      [release, -0.09],
      [1.91, 0.078],
      [2.13, -0.015],
      [2.39, 0.035],
      [2.46, -0.1],
      [2.55, 0.048],
      [2.73, -0.027],
      [2.89, 0.014],
      [settle, 0],
    ]);
  } else {
    spring = keys(time, [
      [release, -0.09],
      [1.52, 0.075],
      [1.67, -0.046],
      [1.84, 0.026],
      [settle, 0],
    ]);
  }
  stretch(pose, time < release ? shape : spring);
  // Launch the cheers wide. After the apex the hands move to a lower,
  // lateral open pose for the landing and, at a juz, the second hop.
  const angle = keys(time, [
    [0, 29],
    [launch - 0.07, 22],
    [launch + 0.1, 36],
    [arrive - 0.15, 66],
    [arrive, 129],
    [fall, 127],
    [land, 85],
    [release, 85],
    [juz ? 2.4 : 1.52, 78],
    [settle, 29],
  ]);
  pose.arms = [angle, angle];
  pose.reach = gate(time, launch, arrive, release, settle);
  const leafFollow = (t) =>
    keys(t, [
      [0, 0],
      [launch - 0.07, -17],
      [launch, -14],
      [launch + 0.1, -53],
      [arrive - 0.12, -48],
      [fall, -43],
      [land - 0.05, -53],
      [release, 18],
      [juz ? 2.0 : 1.55, -18],
      [juz ? 2.42 : 1.7, 10],
      [settle, 0],
    ]);
  pose.leaf = leafFollow(time);
  pose.leafFollower = 0.7 * leafFollow(time - 0.045);
  pose.face.joy = gate(time, arrive - 0.09, arrive, settle - 0.15, settle);
  // Close the smile first, then reopen the eyes between samples. A slow
  // blend from an arc to a round eye reads as a half-lidded look at 56 pt.
  pose.face.eyeArc = gate(time, arrive - 0.09, arrive, settle - 0.021, settle - 0.002);
  pose.face.browHeight = 0.075 * pose.face.joy;
  pose.face.eyeOpen = blink(time, juz ? 3.46 : 2.46, 0.31, 0.065);
  const light = ease(time, 0, peak);
  pose.glow = light * (1 - 0.65 * ease(time, juz ? 2.4 : 1.4, juz ? 3.46 : 2.48));
  pose.fillHeight = -0.02 + 3.22 * light;
  pose.halo = gate(time, peak - 0.2, peak, peak + 0.08, peak + 0.48);
  pose.burst = unit(time, juz ? 1.71 : 1.3, juz ? 2.38 : 1.97);
  pose.sparkleCount = juz ? 8 : 7;
  if (juz) {
    pose.motes = Array.from({ length: 5 }, (_, i) => unit(time, 2.3 + i * 0.09, 2.94 + i * 0.09));
  }
}
export const peaks = {
  A01: [],
  A02: [2.4, 3.38],
  A04: [0.11, 0.3, 0.53, 0.85, 1.02, 1.21, 1.45, 1.84],
  A06: [0.11, 0.275, 0.48, 0.7, 0.87, 1.27],
  A07: [0.28, 0.48, 0.6, 0.72, 0.96, 1.28, 1.6, 2.64],
  A08: [0.11, 0.3, 0.5, 0.73, 0.97, 1.27, 1.84],
  A10: [0.5, 0.92, 1.4],
  A11: [0.46, 0.63, 0.82, 1, 1.19, 1.45],
  A15: [0.53, 0.72, 0.9, 1.06, 1.38, 1.78, 2.06, 2.54, 2.83, 3.66],
  A17: [0.11, 0.28, 0.45, 0.63],
  A19: [0.08, 0.2, 0.3, 0.39, 0.5, 0.64, 1.55, 2.35],
};
export function hold(name) {
  const pose = rest();
  if (name.startsWith("warm_smile")) pose.face.mouthCurve = 1;
  if (name === "warm_smile_glow_35") pose.glow = 0.35;
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
    case "A06":
    case "A17": {
      const tap = id === "A17",
        daily = id === "A06";
      const land = daily || tap ? 0.4 : 0.45;
      pose.root[1] = arc(time, 0.15, land, tap ? 0.06 : daily ? 0.12 : 0.1);
      const end = tap ? 0.55 : 0.9;
      stretch(
        pose,
        keys(time, [
          [0, 0],
          [0.11, daily ? -0.1 : -0.08],
          [0.205, tap ? 0.06 : 0.1],
          [land - 0.05, 0],
          [land + 0.052, tap ? -0.08 : daily ? -0.14 : -0.12],
          [land + 0.11, tap ? 0.025 : 0.05],
          [end, tap ? 0 : -0.008],
          [end + 0.1, 0],
        ]) + (tap ? 0 : 0.029 * ring(time, land + 0.1, end)),
      );
      const flick = (t) =>
        keys(t, [
          [0, 0],
          [0.12, 8],
          [0.23, tap ? -12 : -22],
          [land - 0.03, -7],
          [land + 0.07, tap ? 12 : 23],
          [land + 0.17, -7],
          [tap ? 0.7 : 0.84, 0],
        ]);
      pose.leaf = flick(time);
      pose.leafFollower = 0.72 * flick(time - 0.038);
      face.joy = gate(
        time,
        tap ? 0.15 : daily ? 0.235 : 0.2,
        tap ? 0.23 : daily ? 0.3 : 0.25,
        tap ? 0.62 : daily ? 0.67 : 1.22,
        tap ? 0.7 : daily ? 0.75 : 1.3,
      );
      if (tap) face.mouthCurve = 1;
      if (daily) {
        if (time >= 0.45 && time <= 1.05) pose.sweep = -0.24 + 3.45 * unit(time, 0.45, 1.05);
        face.eyeOpen = blink(time, 1.1, 0.31, 0.065);
      }
      if (id === "A04") {
        pose.arms[0] = keys(time, [
          [0, 29],
          [0.55, 29],
          [0.85, 155],
          [1.015, 135],
          [1.19, 165],
          [1.37, 135],
          [1.55, 160],
          [1.8, 27],
          [2, 29],
        ]);
        pose.reach = gate(time, 0.55, 0.85, 1.55, 1.8);
        pose.lean =
          ((4 * Math.PI) / 180) * gate(time, 0.65, 0.85, 1.55, 1.8) * Math.cos(((time - 0.85) * 4 * Math.PI) / 0.7);
        pose.height += 0.025 * ring(time, 1.8, 2);
        pose.width = 1 / Math.sqrt(pose.height);
      }
      break;
    }
    case "A07":
    case "A15":
      milestoneJump(pose, time, id === "A15");
      break;
    case "A08": {
      pose.root[1] = arc(time, 0.15, 0.45, 0.12) + arc(time, 0.55, 0.9, 0.2);
      stretch(
        pose,
        keys(time, [
          [0, 0],
          [0.11, -0.1],
          [0.21, 0.1],
          [0.39, 0],
          [0.49, -0.12],
          [0.6, 0.12],
          [0.69, -0.055],
          [0.78, -0.045],
          [0.88, 0.04],
          [0.97, -0.14],
          [1.08, 0.065],
          [1.21, -0.041],
          [1.35, 0.025],
          [1.5, 0],
        ]),
      );
      const angle = keys(time, [
        [0, 29],
        [0.48, 29],
        [0.73, 92],
        [1.04, 84],
        [1.4, 90],
        [1.7, 29],
      ]);
      pose.arms = [angle, angle];
      pose.reach = gate(time, 0.52, 0.73, 1.4, 1.7);
      const leaf = (t) =>
        keys(t, [
          [0, 0],
          [0.22, -18],
          [0.46, 12],
          [0.6, -22],
          [0.74, 35],
          [0.87, 26],
          [0.99, -11],
          [1.13, 7],
          [1.48, 0],
        ]);
      pose.leaf = leaf(time);
      pose.leafFollower = 0.67 * leaf(time - 0.04);
      face.joy = gate(time, 0.6, 0.68, 1.19, 1.3);
      face.eyeOpen = blink(time, 1.58, 0.34, 0.055);
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
      face.eyeOpen = blink(time, 0.443, 0.329, 0.019);
      break;
    case "A19":
      pose.opacity = ease(time, 0, 0.08);
      pose.root[1] = 0.61 * (1 - unit(time, 0, 0.3) ** 2);
      face.eyeOpen = ease(time, 0.13, 0.2);
      pose.height +=
        0.05 * gate(time, 0, 0.19, 0.27, 0.3) -
        0.075 * gate(time, 0.3, 0.365, 0.365, 0.42) +
        0.027 * ring(time, 0.42, 0.75);
      pose.arms[0] = wave(((time - 0.75) * 1.8) / 1.6);
      pose.leaf = 11 * ring(time, 0.42, 0.75);
      pose.leafFollower = 8 * ring(time, 0.45, 0.77);
      face.mouthCurve = ease(time, 0.75, 1.05);
      break;
  }
  if (job.register === "celebration") face.browHeight = 0.052 * face.joy;
  if (id === "A19") pose.width = 1 / Math.sqrt(pose.height);
  if (id === "A11") pose.leafFollower = pose.leaf * 0.65;
  return pose;
}
