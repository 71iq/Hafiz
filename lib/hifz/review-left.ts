import type { AppDatabase } from "@/lib/database/types";
import { loadTodayWird, reviewLeftToday } from "@/lib/hifz/pages";
import { countDueRemediation } from "@/lib/hifz/remediation";
import { countAyahReviewsDue } from "@/lib/study/daily-queue";

export type ReviewLeft = Readonly<{
  /** A hifz plan is set up. Without one there is no review list, so the second sitting never reminds. */
  hasPlan: boolean;
  /** Review still due today, by Home's rule (reviewLeftToday, GOAL-04). */
  left: boolean;
}>;

/**
 * Today's review left, with the same counts Home uses: today's page list, the half pages and seams due,
 * and in ayah review the ayah cards due. Shared by the reminder planner, the Home banner, the tray
 * cleanup and the session-end commitment (REMIND-07). loadTodayWird fixes today's page list the first
 * time it runs each day, the same write Home makes on its first load.
 */
export async function loadReviewLeft(db: AppDatabase, now: Date): Promise<ReviewLeft> {
  const wird = await loadTodayWird(db, now);
  if (!wird) return { hasPlan: false, left: false };
  const [remediationDue, ayahReviewsDue] = await Promise.all([
    countDueRemediation(db, now),
    wird.plan.unit === "ayah" ? countAyahReviewsDue(db) : Promise.resolve(0),
  ]);
  return { hasPlan: true, left: reviewLeftToday(wird, { remediationDue, ayahReviewsDue }) };
}
