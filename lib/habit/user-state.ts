import { addDays, type LocalDate } from "@/lib/habit/dates";

export type UserState =
  | "new"
  | "current"
  | "reactivated"
  | "resurrected"
  | "at_risk_weekly"
  | "at_risk_monthly"
  | "dormant";

export function userState(activeDates: ReadonlySet<LocalDate>, firstDate: LocalDate | null, today: LocalDate): UserState {
  if (firstDate === null || today <= firstDate) return "new";
  const activeOn = (daysAgo: number) => activeDates.has(addDays(today, -daysAgo));
  const anyIn = (from: number, to: number) => {
    for (let daysAgo = from; daysAgo <= to; daysAgo += 1) if (activeOn(daysAgo)) return true;
    return false;
  };
  if (activeOn(0)) {
    if (anyIn(1, 6)) return "current";
    return anyIn(7, 29) ? "reactivated" : "resurrected";
  }
  if (anyIn(1, 6)) return "at_risk_weekly";
  if (anyIn(7, 29)) return "at_risk_monthly";
  return "dormant";
}
