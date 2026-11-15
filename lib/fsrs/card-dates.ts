import { toArabicNumber } from "@/lib/arabic";

type Language = "en" | "ar";

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function day(n: number, language: Language): string {
  return language === "ar" ? toArabicNumber(n) : String(n);
}

/** "Nov 19" / "١٩ نوفمبر", with the year when it is not the current one. */
export function formatShortCardDate(date: Date, language: Language, now = new Date()): string {
  const year = date.getFullYear() !== now.getFullYear() ? date.getFullYear() : null;
  if (language === "ar") {
    return `${day(date.getDate(), language)} ${MONTHS_AR[date.getMonth()]}${year ? ` ${toArabicNumber(year)}` : ""}`;
  }
  return `${MONTHS_EN[date.getMonth()].slice(0, 3)} ${date.getDate()}${year ? `, ${year}` : ""}`;
}

/** "Thursday, 19 November" / "الخميس ١٩ نوفمبر", with the year when it is not the current one. */
export function formatLongCardDate(date: Date, language: Language, now = new Date()): string {
  const year = date.getFullYear() !== now.getFullYear() ? date.getFullYear() : null;
  if (language === "ar") {
    return `${WEEKDAYS_AR[date.getDay()]} ${day(date.getDate(), language)} ${MONTHS_AR[date.getMonth()]}${year ? ` ${toArabicNumber(year)}` : ""}`;
  }
  return `${WEEKDAYS_EN[date.getDay()]}, ${date.getDate()} ${MONTHS_EN[date.getMonth()]}${year ? ` ${year}` : ""}`;
}

/** A card's due day for lists: Today, Tomorrow, or a short local date. Empty for an unreadable value. */
export function formatCardDueDay(
  value: string,
  language: Language,
  labels: { today: string; tomorrow: string },
  now = new Date(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // Signed local-day difference: an overdue card shows its date, not "Today".
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(date) - start(now)) / 86400000);
  if (diff === 0) return labels.today;
  if (diff === 1) return labels.tomorrow;
  return formatShortCardDate(date, language, now);
}
