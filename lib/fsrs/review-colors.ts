import { State } from "@/lib/fsrs/scheduler";

/**
 * Semantic colors for card states and review sides, one set for the light palettes (White, Beige)
 * and one for the dark ones (Dark, AMOLED); System follows whichever is active. White text reads at
 * 4.5:1 or more on every fill, and each `text` color reads at 4.5:1 or more on its themes' surfaces.
 */
export type ReviewColorToken = { fill: string; onFill: string; text: string };

const LIGHT_STATES: Record<number, ReviewColorToken> = {
  [State.New]: { fill: "#1d4ed8", onFill: "#ffffff", text: "#1d4ed8" },
  [State.Learning]: { fill: "#c2410c", onFill: "#ffffff", text: "#c2410c" },
  [State.Review]: { fill: "#15803d", onFill: "#ffffff", text: "#15803d" },
  [State.Relearning]: { fill: "#b91c1c", onFill: "#ffffff", text: "#b91c1c" },
};

const DARK_STATES: Record<number, ReviewColorToken> = {
  [State.New]: { fill: "#1d4ed8", onFill: "#ffffff", text: "#93c5fd" },
  [State.Learning]: { fill: "#c2410c", onFill: "#ffffff", text: "#fdba74" },
  [State.Review]: { fill: "#15803d", onFill: "#ffffff", text: "#86efac" },
  [State.Relearning]: { fill: "#b91c1c", onFill: "#ffffff", text: "#fca5a5" },
};

export function cardStateColor(state: number, isDark: boolean): ReviewColorToken {
  const palette = isDark ? DARK_STATES : LIGHT_STATES;
  return palette[state] ?? palette[State.New];
}

export type ReviewSideTone = "blue" | "violet" | "teal" | "amber" | "rose";

const LIGHT_SIDES: Record<ReviewSideTone, ReviewColorToken> = {
  blue: { fill: "#1d4ed8", onFill: "#ffffff", text: "#1d4ed8" },
  violet: { fill: "#6d28d9", onFill: "#ffffff", text: "#6d28d9" },
  teal: { fill: "#0f766e", onFill: "#ffffff", text: "#0f766e" },
  amber: { fill: "#b45309", onFill: "#ffffff", text: "#b45309" },
  rose: { fill: "#be123c", onFill: "#ffffff", text: "#be123c" },
};

const DARK_SIDES: Record<ReviewSideTone, ReviewColorToken> = {
  blue: { fill: "#1d4ed8", onFill: "#ffffff", text: "#93c5fd" },
  violet: { fill: "#6d28d9", onFill: "#ffffff", text: "#c4b5fd" },
  teal: { fill: "#0f766e", onFill: "#ffffff", text: "#5eead4" },
  amber: { fill: "#b45309", onFill: "#ffffff", text: "#fcd34d" },
  rose: { fill: "#be123c", onFill: "#ffffff", text: "#fda4af" },
};

export function reviewSideColor(tone: ReviewSideTone, isDark: boolean): ReviewColorToken {
  return (isDark ? DARK_SIDES : LIGHT_SIDES)[tone];
}
