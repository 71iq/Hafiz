import { formatNumber } from "@/lib/i18n/count";

type Language = "en" | "ar";

export function socialNumber(n: number, language: Language): string {
  return formatNumber(n, language);
}

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
