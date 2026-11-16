import { toArabicNumber } from "@/lib/arabic";
import type { SchedulerStep } from "@/lib/fsrs/types";

const STEP_TEXT_RE = /^(\d+(?:\.\d+)?)([mhd])$/;
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function normalizeStepDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = ARABIC_DIGITS.indexOf(digit);
    if (arabicIndex >= 0) return String(arabicIndex);
    return String(EASTERN_ARABIC_DIGITS.indexOf(digit));
  });
}

function formatArabicStep(step: SchedulerStep): string {
  const match = step.match(STEP_TEXT_RE);
  if (!match) return step;
  const value = Number(match[1]);
  const unit =
    match[2] === "m"
      ? value === 1
        ? "دقيقة"
        : "دقائق"
      : match[2] === "h"
        ? value === 1
          ? "ساعة"
          : "ساعات"
        : value === 1
          ? "يوم"
          : "أيام";
  return `${toArabicNumber(value)} ${unit}`;
}

export function formatStepText(steps: readonly SchedulerStep[], isRTL = false): string {
  if (!isRTL) return steps.join(", ");
  return steps.map(formatArabicStep).join("، ");
}

function parseStepToken(value: string): SchedulerStep | null {
  const normalized = normalizeStepDigits(value.trim().toLowerCase()).replace(/\s+/g, " ");
  const canonical = normalized.match(/^(\d+(?:\.\d+)?)\s*([mhd])$/);
  if (canonical) return `${canonical[1]}${canonical[2]}` as SchedulerStep;

  const dual = normalized.match(/^(?:2\s*)?(دقيقتان|دقيقتين|ساعتان|ساعتين|يومان|يومين)$/);
  if (dual) {
    const unit = dual[1].startsWith("دقيقت") ? "m" : dual[1].startsWith("ساعت") ? "h" : "d";
    return `2${unit}` as SchedulerStep;
  }

  const arabic = normalized.match(/^(\d+(?:\.\d+)?)\s*(دقيقة|دقائق|دق|ساعة|ساعات|ساعه|س|يوم|أيام|ايام)$/);
  if (!arabic) return null;
  const unit = arabic[2];
  if (unit === "دقيقة" || unit === "دقائق" || unit === "دق") return `${arabic[1]}m` as SchedulerStep;
  if (unit === "ساعة" || unit === "ساعات" || unit === "ساعه" || unit === "س") return `${arabic[1]}h` as SchedulerStep;
  return `${arabic[1]}d` as SchedulerStep;
}

export function parseStepText(value: string, fallback: readonly SchedulerStep[]): SchedulerStep[] {
  if (value.trim().length === 0) return [];
  const commaSeparated = value
    .split(/[,،]+/)
    .map((step) => step.trim())
    .filter(Boolean)
    .map(parseStepToken)
    .filter((step): step is SchedulerStep => step !== null);
  if (commaSeparated.length > 0) return commaSeparated;

  const spaceSeparated = value
    .split(/\s+/)
    .map(parseStepToken)
    .filter((step): step is SchedulerStep => step !== null);
  return spaceSeparated.length > 0 ? spaceSeparated : [...fallback];
}

export type StepTextResult = { ok: true; steps: SchedulerStep[] } | { ok: false };

export function validateStepText(value: string): StepTextResult {
  if (value.trim().length === 0) return { ok: true, steps: [] };
  const result = readStrictSteps(value);
  return result
    ? { ok: true, steps: result.map((step) => `${parseFloat(step)}${step.slice(-1)}` as SchedulerStep) }
    : { ok: false };
}

function readStrictSteps(value: string): SchedulerStep[] | null {
  const steps: SchedulerStep[] = [];
  for (const chunk of value.split(/[,،]/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const whole = parseStepToken(trimmed);
    if (whole) {
      steps.push(whole);
      continue;
    }
    const words = trimmed.split(/\s+/);
    for (let i = 0; i < words.length; i += 1) {
      const single = parseStepToken(words[i]);
      if (single) {
        steps.push(single);
        continue;
      }
      const paired = i + 1 < words.length ? parseStepToken(`${words[i]} ${words[i + 1]}`) : null;
      if (!paired) return null;
      steps.push(paired);
      i += 1;
    }
  }
  return steps;
}

function formatEnglishStep(step: SchedulerStep): string {
  const match = step.match(STEP_TEXT_RE);
  if (!match) return step;
  const value = Number(match[1]);
  if (match[2] === "m") return `${match[1]} min`;
  if (match[2] === "h") return `${match[1]} ${value === 1 ? "hour" : "hours"}`;
  return `${match[1]} ${value === 1 ? "day" : "days"}`;
}

export function formatStepPreview(steps: readonly SchedulerStep[], language: "en" | "ar"): string {
  if (language === "ar") return steps.map(formatArabicStep).join("، ");
  return steps.map(formatEnglishStep).join(", ");
}
