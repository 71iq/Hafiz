import type { AppDatabase } from "@/lib/database/types";
import { countAyahReviewsDue } from "@/lib/study/daily-queue";
import { loadTodayWird, type TodayWird } from "@/lib/hifz/pages";
import { countDueRemediation } from "@/lib/hifz/remediation";
import { loadReviewLeft } from "@/lib/hifz/review-left";

jest.mock("@/lib/study/daily-queue", () => ({ countAyahReviewsDue: jest.fn() }));
jest.mock("@/lib/hifz/remediation", () => ({ countDueRemediation: jest.fn() }));
jest.mock("@/lib/hifz/pages", () => ({
  ...jest.requireActual("@/lib/hifz/pages"),
  loadTodayWird: jest.fn(),
}));

const db = {} as AppDatabase;
const NOW = new Date("2026-11-12T09:00:00Z");
const wird = (unit: "page" | "ayah", todo: number) =>
  ({ plan: { unit }, todo: Array.from({ length: todo }, () => ({})) }) as unknown as TodayWird;

describe("today's review left for the second sitting (REMIND-07)", () => {
  beforeEach(() => {
    jest.mocked(countDueRemediation).mockResolvedValue(0);
    jest.mocked(countAyahReviewsDue).mockResolvedValue(0);
  });

  it("has nothing without a plan", async () => {
    jest.mocked(loadTodayWird).mockResolvedValue(null);
    expect(await loadReviewLeft(db, NOW)).toEqual({ hasPlan: false, left: false });
  });

  it("counts an ayah-only plan's ayah reviews due, which have no pages", async () => {
    jest.mocked(loadTodayWird).mockResolvedValue(wird("ayah", 0));
    expect(await loadReviewLeft(db, NOW)).toEqual({ hasPlan: true, left: false });
    jest.mocked(countAyahReviewsDue).mockResolvedValue(4);
    expect(await loadReviewLeft(db, NOW)).toEqual({ hasPlan: true, left: true });
  });

  it("counts half pages and seams still due after every review page is done", async () => {
    jest.mocked(loadTodayWird).mockResolvedValue(wird("page", 0));
    expect((await loadReviewLeft(db, NOW)).left).toBe(false);
    jest.mocked(countDueRemediation).mockResolvedValue(1);
    expect((await loadReviewLeft(db, NOW)).left).toBe(true);
    // Ayah cards due do not hold back a page plan, as on Home.
    jest.mocked(countDueRemediation).mockResolvedValue(0);
    jest.mocked(countAyahReviewsDue).mockResolvedValue(9);
    expect((await loadReviewLeft(db, NOW)).left).toBe(false);
  });

  it("counts review pages left", async () => {
    jest.mocked(loadTodayWird).mockResolvedValue(wird("page", 2));
    expect(await loadReviewLeft(db, NOW)).toEqual({ hasPlan: true, left: true });
  });
});
