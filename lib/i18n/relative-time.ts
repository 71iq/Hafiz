type RelativeTimeUnit = "minute" | "hour" | "day";

const EN_FALLBACK_SUFFIX: Record<RelativeTimeUnit, string> = {
  minute: "m",
  hour: "h",
  day: "d",
};

const AR_FALLBACK_SUFFIX: Record<RelativeTimeUnit, string> = {
  minute: "د",
  hour: "س",
  day: "ي",
};

export function formatRelativeTime(dateStr: string, justNowLabel: string, locale: string, now = Date.now()): string {
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return justNowLabel;
  if (diff < 3600) return formatRelative(-Math.floor(diff / 60), "minute", locale);
  if (diff < 86400) return formatRelative(-Math.floor(diff / 3600), "hour", locale);
  if (diff < 604800) return formatRelative(-Math.floor(diff / 86400), "day", locale);
  return new Date(dateStr).toLocaleDateString(locale);
}

function formatRelative(value: number, unit: RelativeTimeUnit, locale: string): string {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" }).format(value, unit);
  } catch {
    const suffixes = locale === "ar" ? AR_FALLBACK_SUFFIX : EN_FALLBACK_SUFFIX;
    return `${Math.abs(value)}${suffixes[unit]}`;
  }
}
