
export const SUPPORT_LEVELS = [0, 1, 2, 3, 4] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export type Grader = "self" | "teacher" | "salah" | "asr";
export type Rating = 1 | 2 | 3 | 4;

export const GRADE_CAP: Readonly<Record<SupportLevel, 0 | Rating>> = { 0: 0, 1: 2, 2: 3, 3: 4, 4: 4 };

export function isGradable(level: SupportLevel): boolean {
  return GRADE_CAP[level] > 0;
}

export type AttemptEvents = Readonly<{
  fath: number;
  tanbih: number;
  selfCorrected: number;
  uncorrectedJali: number;
  skippedAyah: boolean;
  seamFailed: boolean;
  driftUnnoticed: boolean;
  longHesitations: number;
}>;

export function proposeRating(events: AttemptEvents, level: SupportLevel, options: { fluent: boolean }): 0 | Rating {
  const cap = GRADE_CAP[level];
  if (cap === 0) return 0;
  let rating: Rating;
  if (events.fath > 0 || events.skippedAyah || events.seamFailed || events.driftUnnoticed || events.uncorrectedJali >= 2) {
    rating = 1;
  } else if (events.tanbih > 0 || events.uncorrectedJali === 1 || events.longHesitations >= 2) {
    rating = 2;
  } else if (options.fluent && events.selfCorrected === 0) {
    rating = 4;
  } else {
    rating = 3;
  }
  return Math.min(rating, cap) as Rating;
}

export function capRating(rating: Rating, level: SupportLevel): Rating {
  const cap = GRADE_CAP[level];
  if (cap === 0) throw new RangeError("Full-text practice is not graded");
  return Math.min(rating, cap) as Rating;
}

export function defaultSupportLevel(tier: "sabqi" | "manzil", retrievability: number | null): SupportLevel {
  if (tier === "sabqi" || retrievability === null) return 4;
  if (retrievability >= 0.85) return 4;
  if (retrievability >= 0.7) return 3;
  return 2;
}
