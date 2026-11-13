/**
 * Recitation grading (spec 4.2). The rubric follows how hifz competitions mark errors: tanbih (the
 * listener signals an error) costs less than fath (the listener supplies the words), and a
 * self-correction costs nothing.
 */

/** 4.5.1 support ladder, strongest cue first. */
export const SUPPORT_LEVELS = [0, 1, 2, 3, 4] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export const SUPPORT_LEVEL_NAMES: Readonly<Record<SupportLevel, "full" | "first_letters" | "line_by_line" | "swipe" | "hidden">> = {
  0: "full",
  1: "first_letters",
  2: "line_by_line",
  3: "swipe",
  4: "hidden",
};

export type Grader = "self" | "teacher" | "salah" | "asr";
export type Rating = 1 | 2 | 3 | 4;

/** GRD-03: the highest grade a support level allows. L0 is reading, never graded as recall. */
export const GRADE_CAP: Readonly<Record<SupportLevel, 0 | Rating>> = { 0: 0, 1: 2, 2: 3, 3: 4, 4: 4 };

export function isGradable(level: SupportLevel): boolean {
  return GRADE_CAP[level] > 0;
}

export type AttemptEvents = Readonly<{
  /** Show me: the text was revealed (fath). */
  fath: number;
  /** Peek: a word was revealed to notice an error (tanbih). */
  tanbih: number;
  /** Slips the reciter caught and corrected. */
  selfCorrected: number;
  /** Clear errors (lahn jali) noticed only after reveal. */
  uncorrectedJali: number;
  skippedAyah: boolean;
  seamFailed: boolean;
  driftUnnoticed: boolean;
  longHesitations: number;
}>;

export const NO_EVENTS: AttemptEvents = {
  fath: 0,
  tanbih: 0,
  selfCorrected: 0,
  uncorrectedJali: 0,
  skippedAyah: false,
  seamFailed: false,
  driftUnnoticed: false,
  longHesitations: 0,
};

/**
 * GRD-02: the grade the rubric proposes after reveal. Easy needs a fluent attempt with no slips.
 * The proposal is capped by the support level (GRD-03). Returns 0 for L0, which is not graded.
 */
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

/** A grade the user picked, capped by the support level they practiced at. */
export function capRating(rating: Rating, level: SupportLevel): Rating {
  const cap = GRADE_CAP[level];
  if (cap === 0) throw new RangeError("Full-text practice is not graded");
  return Math.min(rating, cap) as Rating;
}

/** MOD-01: the default support level for a page from its recall probability. */
export function defaultSupportLevel(tier: "sabqi" | "manzil", retrievability: number | null): SupportLevel {
  if (tier === "sabqi" || retrievability === null) return 4;
  if (retrievability >= 0.85) return 4;
  if (retrievability >= 0.7) return 3;
  return 2;
}
