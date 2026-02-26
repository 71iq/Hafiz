export interface SM2Input {
  interval: number;
  repetitions: number;
  easeFactor: number;
}

export interface SM2Result {
  interval: number;
  repetitions: number;
  easeFactor: number;
}

// Grade mapping: Again(0)→q0, Hard(1)→q3, Good(2)→q4, Easy(3)→q5
const QUALITY_MAP: Record<number, number> = { 0: 0, 1: 3, 2: 4, 3: 5 };

export function sm2(grade: number, prev: SM2Input): SM2Result {
  const q = QUALITY_MAP[grade] ?? 0;

  let { interval, repetitions, easeFactor } = prev;

  if (q < 3) {
    // Failed — reset
    interval = 0;
    repetitions = 0;
  } else {
    // Success — advance
    if (repetitions === 0) {
      // First success: differentiate by grade
      if (q === 3) interval = 1;       // Hard → 1 day
      else if (q === 4) interval = 3;  // Good → 3 days
      else interval = 7;               // Easy → 7 days
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  }

  // Update ease factor
  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  return { interval, repetitions, easeFactor };
}

export function getNextReviewDate(intervalDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + intervalDays);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Compute projected interval for each grade (for display on buttons)
export function projectIntervals(prev: SM2Input): number[] {
  return [0, 1, 2, 3].map((grade) => sm2(grade, prev).interval);
}
