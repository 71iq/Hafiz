import { formatNumber } from "@/lib/i18n/count";

type Language = "en" | "ar";

export function socialNumber(n: number, language: Language): string {
  return formatNumber(n, language);
}

/** A calendar date ("2026-11-09") or instant as a short date in the interface language. */
export function formatSocialDate(value: string, language: Language, withTime = false): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = withTime
    ? { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "long", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(language === "ar" ? "ar" : "en", options).format(date);
  } catch {
    return value;
  }
}
