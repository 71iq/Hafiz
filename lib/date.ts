export type DueDateInputResult =
  | { ok: true; date: Date }
  | { ok: false; reason: "invalid" | "past" };

export function localStartOfTomorrow(base = new Date()): Date {
  const tomorrow = new Date(base);
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

export function dayDiffLocal(from: Date, to: Date): number {
  const fromStart = new Date(from);
  fromStart.setHours(0, 0, 0, 0);
  const toStart = new Date(to);
  toStart.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((toStart.getTime() - fromStart.getTime()) / 86400000));
}

export function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dayIndexFromLocalDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor(new Date(year, (month || 1) - 1, day || 1).getTime() / 86400000);
}

export function dayIndexFromUtcDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(year, (month || 1) - 1, day || 1) / 86400000);
}

export function todayBounds(base = new Date()): { start: string; end: string } {
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function normalizeDateDigits(value: string): string {
  const western = "0123456789";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const eastern = "۰۱۲۳۴۵۶۷۸۹";
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit);
    if (arabicIndex >= 0) return western[arabicIndex];
    return western[eastern.indexOf(digit)];
  });
}

export function formatLocalDateInput(date: Date): string {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return formatLocalDateKey(safeDate);
}

export function parseDueDateInput(value: string, today = new Date()): DueDateInputResult {
  const normalized = normalizeDateDigits(value.trim());
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { ok: false, reason: "invalid" };
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { ok: false, reason: "invalid" };
  }
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  if (date < todayStart) return { ok: false, reason: "past" };
  return { ok: true, date };
}
