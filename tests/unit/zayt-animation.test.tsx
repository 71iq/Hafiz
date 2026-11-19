import { act, render, screen } from "@testing-library/react-native";
import { SessionHabitCards, sessionZayt, type SessionHabitInput } from "@/components/habit/SessionHabitCards";
import { ZaytAnimation } from "@/components/habit/ZaytAnimation";
import { avatarInitial } from "@/components/profile/ProfileAvatar";
import type { AppDatabase } from "@/lib/database/types";
import type { HabitOverview } from "@/lib/habit/queries";
import { strings } from "@/lib/i18n/strings";
import { isZaytPresented, resetZaytPresentationsForTests } from "@/lib/zayt/presentation";

let mockDark = false;
let mockReduceMotion = false;
let mockMotionAllowed = true;

jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ isDark: mockDark }) }));
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => mockReduceMotion }));
jest.mock("@/lib/zayt/animations", () => ({
  ...jest.requireActual<typeof import("@/lib/zayt/animations")>("@/lib/zayt/animations"),
  zaytMotionAllowed: () => mockMotionAllowed,
}));
jest.mock("@/components/notifications/ReminderPromptCard", () => ({
  ReminderPromptCard: () => null,
  useReminderOffer: () => null,
}));
jest.mock("@/components/habit/WidgetOfferCard", () => ({ WidgetOfferCard: () => null, useWidgetOffer: () => false }));

// React Native's Jest View mock shares these instance methods, so this sets where every View sits.
const measureInWindow = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>("react-native/jest/MockNativeMethods")
  .default.measureInWindow;
/** Zayt is hidden from screen readers, so queries must include hidden elements. */
const HIDDEN = { includeHiddenElements: true } as const;

beforeEach(() => {
  mockDark = false;
  mockReduceMotion = false;
  mockMotionAllowed = true;
  resetZaytPresentationsForTests();
  // Zayt sits fully on screen.
  measureInWindow.mockImplementation((callback: (x: number, y: number, w: number, h: number) => void) =>
    callback(20, 100, 51, 64),
  );
});

function input(overrides: Partial<SessionHabitInput> = {}): SessionHabitInput {
  return {
    event: { kind: "minimum_met", length: 4 } as SessionHabitInput["event"],
    overview: null,
    againCount: 0,
    total: 10,
    durationMs: 10 * 60_000,
    ...overrides,
  };
}

describe("the session-end Zayt (spec 7.1 order)", () => {
  it("puts the rest suggestion first, in the rest card", () => {
    expect(sessionZayt(input({ durationMs: 46 * 60_000, againCount: 5, total: 10 }))).toEqual({ animation: "A11", card: "rest" });
  });

  it("stays warm after a hard session, in the encouragement card", () => {
    expect(sessionZayt(input({ againCount: 3, total: 10 }))).toEqual({ animation: "A10", card: "struggle" });
  });

  it("keeps Zayt for rest and a hard session with no streak event, as before", () => {
    expect(sessionZayt(input({ event: null, durationMs: 50 * 60_000 }))).toEqual({ animation: "A11", card: "rest" });
  });

  it("lets light rise at a streak milestone", () => {
    expect(sessionZayt(input({ event: { kind: "minimum_met", length: 7 } as SessionHabitInput["event"] }))).toEqual({
      animation: "A07",
      card: "streak",
    });
  });

  it("uses the steady leaf for a streak earned back and for a day made up", () => {
    expect(sessionZayt(input({ event: { kind: "earned_back", length: 4 } as SessionHabitInput["event"] }))?.animation).toBe("A08");
    expect(sessionZayt(input({ event: { kind: "made_up", length: 4 } as SessionHabitInput["event"] }))?.animation).toBe("A08");
  });

  it("marks today's minimum with the shimmer, and shows nothing without an event", () => {
    expect(sessionZayt(input())).toEqual({ animation: "A06", card: "streak" });
    expect(sessionZayt(input({ event: null }))).toBeNull();
  });
});

describe("ZaytAnimation (10.2 and 10.3)", () => {
  it("plays a new event once, and a remount shows the poster", async () => {
    const view = render(<ZaytAnimation tier="S" animation="A06" height={64} presentationId="result:a" />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A06-playing", HIDDEN)).toBeTruthy();
    expect(isZaytPresented("result:a")).toBe(true);
    view.unmount();

    render(<ZaytAnimation tier="S" animation="A06" height={64} presentationId="result:a" />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A06-poster", HIDDEN)).toBeTruthy();
  });

  it("shows only the poster under reduced motion, and keeps the event for later", async () => {
    mockReduceMotion = true;
    render(<ZaytAnimation tier="S" animation="A04" height={56} presentationId="return:2026-11-01" />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A04-poster", HIDDEN)).toBeTruthy();
    expect(isZaytPresented("return:2026-11-01")).toBe(false);
  });

  it("shows only the poster on a platform that has not passed the gate", async () => {
    mockMotionAllowed = false;
    render(<ZaytAnimation tier="M" animation="A15" height={112} presentationId="juz:juz_01_completed:t" />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A15-poster", HIDDEN)).toBeTruthy();
  });

  it("shows the poster for an event that is not new, such as a restored juz notice", async () => {
    render(<ZaytAnimation tier="M" animation="A15" height={112} presentationId={null} />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A15-poster", HIDDEN)).toBeTruthy();
  });

  it("waits on the first frame while Zayt is off screen, then plays when it scrolls in", async () => {
    jest.useFakeTimers();
    measureInWindow.mockImplementation((callback: (x: number, y: number, w: number, h: number) => void) =>
      callback(20, 5000, 51, 64),
    );
    render(<ZaytAnimation tier="S" animation="A08" height={64} presentationId="result:b" />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A08-waiting", HIDDEN)).toBeTruthy();
    expect(isZaytPresented("result:b")).toBe(false);

    measureInWindow.mockImplementation((callback: (x: number, y: number, w: number, h: number) => void) =>
      callback(20, 300, 51, 64),
    );
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("zayt-A08-playing", HIDDEN)).toBeTruthy();
    jest.useRealTimers();
  });

  it("switches to the other theme's poster instead of restarting the clip", async () => {
    const view = render(<ZaytAnimation tier="S" animation="A07" height={64} presentationId="result:c" />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A07-playing", HIDDEN)).toBeTruthy();
    mockDark = true;
    view.rerender(<ZaytAnimation tier="S" animation="A07" height={64} presentationId="result:c" />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A07-poster", HIDDEN)).toBeTruthy();
  });

  it("stops at the poster when reduced motion turns on part way", async () => {
    const view = render(<ZaytAnimation tier="S" animation="A11" height={64} presentationId="result:d" />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A11-playing", HIDDEN)).toBeTruthy();
    mockReduceMotion = true;
    view.rerender(<ZaytAnimation tier="S" animation="A11" height={64} presentationId="result:d" />);
    await act(async () => undefined);
    expect(screen.getByTestId("zayt-A11-poster", HIDDEN)).toBeTruthy();
  });
});

describe("Show Zayt in the session summary (ZAY-02)", () => {
  const db = {} as AppDatabase;
  const overview = (showZayt: boolean) => ({ settings: { showZayt }, streak: { length: 4 }, goal: null }) as unknown as HabitOverview;

  it("shows Zayt only when the setting is known to be on", async () => {
    const shown = render(<SessionHabitCards input={input({ overview: overview(true) })} db={db} language="en" isDark={false} s={strings.en} />);
    await act(async () => undefined);
    expect(screen.queryByTestId("zayt-A06-playing", HIDDEN)).toBeTruthy();
    shown.unmount();

    const hidden = render(<SessionHabitCards input={input({ overview: overview(false) })} db={db} language="en" isDark={false} s={strings.en} />);
    await act(async () => undefined);
    expect(screen.queryByTestId(/^zayt-/, HIDDEN)).toBeNull();
    hidden.unmount();

    render(<SessionHabitCards input={input({ overview: null })} db={db} language="en" isDark={false} s={strings.en} />);
    await act(async () => undefined);
    expect(screen.queryByTestId(/^zayt-/, HIDDEN)).toBeNull();
  });
});

describe("the profile placeholder (7.3)", () => {
  it("uses the first visible character of the trimmed name", () => {
    expect(avatarInitial("  sara")).toBe("S");
    expect(avatarInitial("أحمد")).toBe("أ");
    expect(avatarInitial("   ")).toBeNull();
  });
});
