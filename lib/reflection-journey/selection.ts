import { REFLECTION_JOURNEY_MAX_RESPONSE_CHARS, REFLECTION_JOURNEY_MIN_RESPONSE_CHARS } from "./schema";
import type { ReflectionJourneyLevelListItem } from "./types";

type LevelStatusView = Pick<ReflectionJourneyLevelListItem, "id" | "status">;

export function selectDefaultJourneyLevel<T extends LevelStatusView>(levels: readonly T[]): T | null {
  return (
    levels.find((level) => level.status === "draft") ??
    levels.find((level) => level.status !== "completed") ??
    levels[levels.length - 1] ??
    null
  );
}

export function journeyNextLevelId(levels: readonly LevelStatusView[]): string | null {
  const level = selectDefaultJourneyLevel(levels);
  return level?.status === "available" ? level.id : null;
}

export function isJourneyComplete(levels: readonly LevelStatusView[]): boolean {
  return levels.length > 0 && levels.every((level) => level.status === "completed");
}

export type JourneyCompletionCheck =
  | { ok: true; length: number }
  | { ok: false; reason: "short"; length: number; remaining: number }
  | { ok: false; reason: "long"; length: number; excess: number };

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
