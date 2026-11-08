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
