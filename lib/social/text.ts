import { formatNumber } from "@/lib/i18n/count";

type Language = "en" | "ar";

export function socialNumber(n: number, language: Language): string {
  return formatNumber(n, language);
}

/**
 * A calendar date ("2026-11-09") or instant as a short date in the interface language, with
 * Arabic-Indic digits in Arabic as elsewhere in the app. A calendar date is that day wherever the
 * reader is; an instant is shown on the reader's own day and clock.
 */
export function formatSocialDate(value: string, language: Language, withTime = false): string {
  const calendar = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = calendar ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : null),
    ...(calendar ? { timeZone: "UTC" } : null),
  };
  try {
    return new Intl.DateTimeFormat(language === "ar" ? "ar-u-nu-arab" : "en", options).format(date);
  } catch {
    return value;
  }
}
