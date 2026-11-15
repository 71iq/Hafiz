import { REFLECTION_JOURNEY_MAX_RESPONSE_CHARS, REFLECTION_JOURNEY_MIN_RESPONSE_CHARS } from "./schema";
import type { ReflectionJourneyLevelListItem } from "./types";

type LevelStatusView = Pick<ReflectionJourneyLevelListItem, "id" | "status">;

/**
 * The one default-level rule for the Journey screen and the Home summary (W09). Levels arrive in
 * suggested order. A saved draft wins, then the first unfinished level, then the last completed level
 * for revisiting. No levels means the empty-content state.
 */
export function selectDefaultJourneyLevel<T extends LevelStatusView>(levels: readonly T[]): T | null {
  return (
    levels.find((level) => level.status === "draft") ??
    levels.find((level) => level.status !== "completed") ??
    levels[levels.length - 1] ??
    null
  );
}

/**
 * The level that carries the Next marker: the default level only when it is unfinished and has no
 * draft. A draft shows its Draft badge instead, and a fully completed Journey has no marker.
 */
export function journeyNextLevelId(levels: readonly LevelStatusView[]): string | null {
  const level = selectDefaultJourneyLevel(levels);
  return level?.status === "available" ? level.id : null;
}

/** The whole Journey is finished only when every level has its own completion record. */
export function isJourneyComplete(levels: readonly LevelStatusView[]): boolean {
  return levels.length > 0 && levels.every((level) => level.status === "completed");
}

export type JourneyCompletionCheck =
  | { ok: true; length: number }
  | { ok: false; reason: "short"; length: number; remaining: number }
  | { ok: false; reason: "long"; length: number; excess: number };

/**
 * Complete and Save changes need 10..5000 trimmed characters. Drafts keep their own rule and may be
 * shorter, so this check never gates Save draft.
 */
export function checkJourneyCompletion(text: string): JourneyCompletionCheck {
  const length = text.trim().length;
  if (length < REFLECTION_JOURNEY_MIN_RESPONSE_CHARS) {
    return { ok: false, reason: "short", length, remaining: REFLECTION_JOURNEY_MIN_RESPONSE_CHARS - length };
  }
  if (length > REFLECTION_JOURNEY_MAX_RESPONSE_CHARS) {
    return { ok: false, reason: "long", length, excess: length - REFLECTION_JOURNEY_MAX_RESPONSE_CHARS };
  }
  return { ok: true, length };
}
