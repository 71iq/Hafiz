import type { PlatformOSType } from "react-native";

/**
 * Zayt's prerendered 3D animations. Each once clip starts on the rest pose, plays once and
 * holds its last frame. Its poster is that last frame, shown whenever the clip must not play.
 * Identical end frames share one poster file.
 */
export type ZaytSmallAnimation = "A04" | "A06" | "A07" | "A08" | "A10" | "A11";
export type ZaytMediumAnimation = "A06" | "A10" | "A15";
export type ZaytTier = "S" | "M";

type Asset = number;
export type ZaytClip = Readonly<{ animated: Asset; poster: Asset; start: Asset }>;
type ThemedClip = Readonly<{ light: ZaytClip; dark: ZaytClip }>;

const REST = {
  S: require("../../assets/zayt/S/A01_rest_pose.webp") as Asset,
  M: require("../../assets/zayt/M/A01_rest_pose.webp") as Asset,
};
const WARM_SMILE = {
  S: require("../../assets/zayt/S/warm_smile_poster.webp") as Asset,
  M: require("../../assets/zayt/M/warm_smile_poster.webp") as Asset,
};

function shared(tier: ZaytTier, animated: Asset, poster: Asset = WARM_SMILE[tier]): ThemedClip {
  const clip = { animated, poster, start: REST[tier] };
  return { light: clip, dark: clip };
}

/** A glow clip has a light render for beige and white, and a dark one with a halo for dark and AMOLED. */
function themed(tier: ZaytTier, light: Asset, dark: Asset, poster: Asset): ThemedClip {
  return {
    light: { animated: light, poster, start: REST[tier] },
    dark: { animated: dark, poster, start: REST[tier] },
  };
}

const SMALL: Record<ZaytSmallAnimation, ThemedClip> = {
  A04: shared("S", require("../../assets/zayt/S/A04_welcome_wave.webp")),
  A06: shared("S", require("../../assets/zayt/S/A06_wird_done_shimmer.webp")),
  A07: themed(
    "S",
    require("../../assets/zayt/S/A07_milestone_glow_light.webp"),
    require("../../assets/zayt/S/A07_milestone_glow_dark.webp"),
    require("../../assets/zayt/S/A07_milestone_glow_poster.webp"),
  ),
  A08: shared("S", require("../../assets/zayt/S/A08_earned_back_steady.webp")),
  A10: shared("S", require("../../assets/zayt/S/A10_hard_session_compassion.webp")),
  A11: shared(
    "S",
    require("../../assets/zayt/S/A11_rest_sit.webp"),
    require("../../assets/zayt/S/A11_rest_sit_poster.webp"),
  ),
};

const MEDIUM: Record<ZaytMediumAnimation, ThemedClip> = {
  A06: shared("M", require("../../assets/zayt/M/A06_wird_done_shimmer.webp")),
  A10: shared("M", require("../../assets/zayt/M/A10_hard_session_compassion.webp")),
  A15: themed(
    "M",
    require("../../assets/zayt/M/A15_juz_light_light.webp"),
    require("../../assets/zayt/M/A15_juz_light_dark.webp"),
    require("../../assets/zayt/M/A15_juz_light_poster.webp"),
  ),
};

export type ZaytClipRequest =
  | Readonly<{ tier: "S"; animation: ZaytSmallAnimation }>
  | Readonly<{ tier: "M"; animation: ZaytMediumAnimation }>;

export function zaytClip(request: ZaytClipRequest, dark: boolean): ZaytClip {
  const clips = request.tier === "S" ? SMALL[request.animation] : MEDIUM[request.animation];
  return dark ? clips.dark : clips.light;
}

/** The rest pose still (A01), for the sabaq intention and the Show Zayt setting row. */
export function zaytRestPose(tier: ZaytTier): Asset {
  return REST[tier];
}

/** Renders are 4:5 canvases: S is 172 by 216 px and M 308 by 384 px. */
export function zaytWidth(tier: ZaytTier, height: number): number {
  return Math.round(tier === "S" ? (height * 172) / 216 : (height * 308) / 384);
}

/**
 * 10.5 platform gate: a platform plays motion only after the packaged files pass on it (alpha, the
 * held last frame, cadence and interruption). Every other platform shows posters. Web passed in
 * Chromium, and Android on an Android 10 emulator: each clip plays once and holds a frame that
 * matches its poster. There the image is blank for a frame or two as the rest pose hands over to
 * the clip, because Android clears an image while its new source loads. iOS stays on posters until
 * it is checked on a device.
 */
const MOTION_PLATFORMS: ReadonlySet<PlatformOSType> = new Set<PlatformOSType>(["web", "android"]);

export function zaytMotionAllowed(os: PlatformOSType): boolean {
  return MOTION_PLATFORMS.has(os);
}
