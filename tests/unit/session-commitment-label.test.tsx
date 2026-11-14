import { renderHook, waitFor } from "@testing-library/react-native";
import { useCommitmentLabel } from "@/components/habit/SessionHabitCards";
import type { AppDatabase } from "@/lib/database/types";
import { strings } from "@/lib/i18n/strings";
import { readReminderPrefs } from "@/lib/notifications/settings";

jest.mock("@/lib/notifications/settings", () => ({ readReminderPrefs: jest.fn() }));
jest.mock("@/components/notifications/ReminderPromptCard", () => ({
  ReminderPromptCard: () => null,
  useReminderOffer: () => false,
}));

const db = {} as AppDatabase;
type Prefs = Awaited<ReturnType<typeof readReminderPrefs>>;
const withAnchor = (anchor: Prefs["anchor"]) => jest.mocked(readReminderPrefs).mockResolvedValue({ anchor } as Prefs);

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
