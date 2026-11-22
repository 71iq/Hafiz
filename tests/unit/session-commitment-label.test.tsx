import { renderHook, waitFor } from "@testing-library/react-native";
import { useCommitmentLabel } from "@/components/habit/SessionHabitCards";
import type { AppDatabase } from "@/lib/database/types";
import { strings } from "@/lib/i18n/strings";
import { loadReviewSittingAhead } from "@/lib/notifications/review-today";
import { readReminderPrefs } from "@/lib/notifications/settings";

jest.mock("@/lib/notifications/settings", () => ({ readReminderPrefs: jest.fn() }));
jest.mock("@/lib/notifications/review-today", () => ({ loadReviewSittingAhead: jest.fn() }));
jest.mock("@/components/notifications/ReminderPromptCard", () => ({
  ReminderPromptCard: () => null,
  useReminderOffer: () => false,
}));

const db = {} as AppDatabase;
type Prefs = Awaited<ReturnType<typeof readReminderPrefs>>;
const withAnchor = (anchor: Prefs["anchor"]) => jest.mocked(readReminderPrefs).mockResolvedValue({ anchor } as Prefs);

beforeEach(() => jest.mocked(loadReviewSittingAhead).mockReset().mockResolvedValue(null));

describe("the end-of-session commitment (STR-20)", () => {
  it("names the prayer the reminder follows", async () => {
    withAnchor({ kind: "prayer", prayer: "fajr", offsetMinutes: 20 });
    const { result } = renderHook(() => useCommitmentLabel(db, strings.en, "en"));
    // Plain until the anchor is read.
    expect(result.current).toBe(strings.en.habitCommitTomorrow);
    await waitFor(() => expect(result.current).toBe("I'll be back tomorrow after Fajr"));
  });

  it("names the prayer in Arabic", async () => {
    withAnchor({ kind: "prayer", prayer: "fajr", offsetMinutes: 20 });
    const { result } = renderHook(() => useCommitmentLabel(db, strings.ar, "ar"));
    await waitFor(() => expect(result.current).toBe("سأعود غدًا بعد الفجر"));
  });

  it("names the time of a clock anchor", async () => {
    withAnchor({ kind: "clock", minutes: 7 * 60 + 30 });
    const { result } = renderHook(() => useCommitmentLabel(db, strings.en, "en"));
    await waitFor(() => expect(result.current).toBe("I'll be back tomorrow at 7:30 AM"));
  });

  it("stays plain when the anchor cannot be read", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.mocked(readReminderPrefs).mockRejectedValue(new Error("Synthetic read failure"));
    const { result } = renderHook(() => useCommitmentLabel(db, strings.en, "en"));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(result.current).toBe(strings.en.habitCommitTomorrow);
    warn.mockRestore();
  });
});

describe("the commitment with a second sitting ahead (STR-20, REMIND-07)", () => {
  const MAGHRIB = { kind: "prayer", prayer: "maghrib", offsetMinutes: 20 } as const;
  beforeEach(() => withAnchor({ kind: "prayer", prayer: "fajr", offsetMinutes: 20 }));

  it("names the review sitting in English and Arabic", async () => {
    jest.mocked(loadReviewSittingAhead).mockResolvedValue(MAGHRIB);
    const en = renderHook(() => useCommitmentLabel(db, strings.en, "en", { session: 1 }));
    await waitFor(() => expect(en.result.current).toBe("I'll finish my review after Maghrib"));
    const ar = renderHook(() => useCommitmentLabel(db, strings.ar, "ar", { session: 1 }));
    await waitFor(() => expect(ar.result.current).toBe("سأكمل مراجعتي بعد المغرب"));
  });

  it("names a clock time for a clock review sitting", async () => {
    jest.mocked(loadReviewSittingAhead).mockResolvedValue({ kind: "clock", minutes: 20 * 60 });
    const { result } = renderHook(() => useCommitmentLabel(db, strings.en, "en", { session: 1 }));
    await waitFor(() => expect(result.current).toBe("I'll finish my review at 8:00 PM"));
  });

  it("reads the review state again when the session ends, so a finished review shows the usual commitment", async () => {
    // At mount review is left; the session then finishes it.
    jest.mocked(loadReviewSittingAhead).mockResolvedValueOnce(MAGHRIB).mockResolvedValue(null);
    const { result, rerender } = renderHook(({ ended }: { ended: unknown }) => useCommitmentLabel(db, strings.en, "en", ended), {
      initialProps: { ended: undefined as unknown },
    });
    await waitFor(() => expect(result.current).toBe("I'll finish my review after Maghrib"));
    rerender({ ended: { event: "minimum_met" } });
    await waitFor(() => expect(result.current).toBe("I'll be back tomorrow after Fajr"));
    expect(loadReviewSittingAhead).toHaveBeenCalledTimes(2);
  });

  it("waits for the session result before reading the review state", async () => {
    jest.mocked(loadReviewSittingAhead).mockResolvedValue(MAGHRIB);
    const { result } = renderHook(() => useCommitmentLabel(db, strings.en, "en", null));
    await waitFor(() => expect(result.current).toBe("I'll be back tomorrow after Fajr"));
    expect(loadReviewSittingAhead).not.toHaveBeenCalled();
  });
});
