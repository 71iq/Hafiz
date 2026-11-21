import { rest } from "../studio/poses.mjs";
import { faceArt } from "./expressions.mjs";

export const urgencyPoses = ["eager", "impatient", "worried", "anxious", "panicked", "relieved", "lonely"];
export const urgencyHalos = ["worried", "anxious", "panicked", "relieved"];

// Each first drawing doubles as the reduced-motion poster. The short beats
// settle back onto it, leaving most of each cycle still.
export const loopTiming = {
  eager: [2280, 110, 190, 120],
  impatient: [2050, 430, 125, 135],
  worried: [2180, 240, 250, 155],
  anxious: [2020, 125, 145, 130],
  panicked: [1900, 150, 155, 145],
  lonely: [3200, 120, 250, 160],
};

export function urgencyDrawing(name, i = 0) {
  const pose = rest();
  const face = {};
  switch (name) {
    case "eager": {
      const stretch = [1, 0.93, 1.045, 0.96][i];
      pose.height = stretch;
      pose.width = 1 / Math.sqrt(stretch);
      pose.arms = [58, 53].map((a) => a + [0, -14, 22, -7][i]);
      pose.root[1] = [0, 0, 0.21, 0][i];
      pose.leaf = [0, -12, 14, -8][i];
      pose.face.blush = 0.75;
      break;
    }
    case "impatient":
      pose.arms = [26, 21];
      // One elbow out, hand on the flank. Both hands stay below shoulder height.
      pose.armAnchors = [
        [
          [-0.74, 1.02, 0.08],
          [-1.04, 0.89, 0.13],
          [-1.06, 0.74, 0.25],
          [-0.79, 0.76, 0.39],
        ],
      ];
      pose.torsoLean = -0.048;
      pose.tap = [0.055, 0.055, 0.155, 0][i];
      pose.leaf = 3.5;
      face.lookX = [0, 12.5, 11, 3][i];
      break;
    case "worried":
      pose.arms = [40, 26];
      pose.torsoLean = 0.037;
      pose.leaf = -2;
      pose.glow = 0.19;
      face.drip = [0, 0.38, 0.82, 1][i];
      face.blink = [0, 0, 1, 0][i];
      break;
    case "anxious":
      pose.arms = [44, 64];
      pose.torsoLean = [-0.12, -0.156, -0.084, -0.136][i];
      pose.leaf = [10.7, 6.7, 15.7, 9.7][i];
      pose.glow = 0.43;
      face.lookX = -3;
      break;
    case "panicked":
      pose.arms = [
        [78, 69],
        [84, 73],
        [69, 80],
        [81, 70],
      ][i];
      pose.reach = 0.51;
      pose.torsoLean = [0.018, 0.095, -0.074, 0.055][i];
      pose.glow = [0.79, 0.46, 0.98, 0.67][i];
      pose.leaf = [-1, 10, -17, 3][i];
      break;
    case "relieved":
      // The back of the right hand lies along the forehead. The elbow is
      // lower than the wrist and the other arm hangs loosely at the side.
      pose.armAnchors = [
        [
          [-0.74, 0.99, 0.08],
          [-1.02, 1.09, 0.24],
          [-0.77, 1.48, 0.48],
          [-0.28, 1.39, 0.72],
        ],
      ];
      pose.arms = [29, 33];
      pose.glow = 0.32;
      pose.face.blush = 1;
      break;
    case "lonely":
      pose.arms = [65, 19];
      pose.torsoLean = 0.05;
      pose.leaf = -2.6;
      pose.face.blush = 0.57;
      face.lookY = -6;
      face.blink = [0, 0.55, 1, 0.42][i];
      break;
  }
  pose.leafFollower = pose.leaf * 0.64;
  return { pose, faceArt: faceArt(name, face) };
}
