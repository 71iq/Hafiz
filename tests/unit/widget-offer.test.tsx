import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { promptCard, type SessionHabitInput } from "@/components/habit/SessionHabitCards";
import { useWidgetOffer, WidgetOfferCard } from "@/components/habit/WidgetOfferCard";
import type { AppDatabase } from "@/lib/database/types";
import { strings } from "@/lib/i18n/strings";
import { markWidgetOfferShown, readWidgetOfferShown } from "@/lib/widget/settings";

let mockSupported = true;
let mockCanPin = true;
let mockPlacement = { small: 0, medium: 0 };
const mockRequestPin = jest.fn(async (_kind: string) => true);

jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ isDark: false }) }));
jest.mock("@/components/notifications/ReminderPromptCard", () => ({
  ReminderPromptCard: () => null,
  useReminderOffer: () => null,
}));
jest.mock("@/lib/widget/platform", () => ({
  widgetPlatform: {
    get supported() {
      return mockSupported;
    },
    canRequestPin: async () => mockCanPin,
    getPlacement: async () => mockPlacement,
    requestPin: (kind: string) => mockRequestPin(kind),
  },
}));
jest.mock("@/lib/widget/settings", () => ({
  readWidgetOfferShown: jest.fn(async () => false),
  markWidgetOfferShown: jest.fn(async () => undefined),
}));

const db = { name: "synthetic" } as unknown as AppDatabase;

function input(overrides: Partial<SessionHabitInput> = {}): SessionHabitInput {
  return {
    event: { kind: "minimum_met", length: 4 } as SessionHabitInput["event"],
    overview: { goal: null, streak: { length: 4 } } as unknown as SessionHabitInput["overview"],
    againCount: 0,
    total: 10,
    durationMs: 10 * 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  mockSupported = true;
  mockCanPin = true;
  mockPlacement = { small: 0, medium: 0 };
  mockRequestPin.mockClear();
  jest.mocked(readWidgetOfferShown).mockReset().mockResolvedValue(false);
  jest.mocked(markWidgetOfferShown).mockClear();
});

describe("the session-end prompt order (SES-01, WIDGET-08)", () => {
  it("puts rest, struggle, reminders, widget, then goal", () => {
    const rest = input({ durationMs: 46 * 60_000, againCount: 5 });
    const struggle = input({ againCount: 4 });
    expect(promptCard(rest, true, true)).toBe("rest");
    expect(promptCard(struggle, true, true)).toBe("struggle");
    expect(promptCard(input(), true, true)).toBe("reminders");
    expect(promptCard(input(), false, true)).toBe("widget");
    expect(promptCard(input(), false, false)).toBe("goal");
  });

  it("offers the widget only after a wird event with a streak of 3 or more", () => {
    expect(
      promptCard(input({ event: { kind: "made_up", length: 3 } as SessionHabitInput["event"] }), false, true),
    ).toBe("widget");
    expect(
      promptCard(input({ event: { kind: "earned_back", length: 10 } as SessionHabitInput["event"] }), false, true),
    ).toBe("widget");
    expect(
      promptCard(input({ event: { kind: "minimum_met", length: 2 } as SessionHabitInput["event"] }), false, true),
    ).toBe("goal");
    expect(promptCard(input({ event: null }), false, true)).toBeNull();
  });
});

describe("useWidgetOffer (spec 8.2)", () => {
  it("offers when supported, pinnable, nothing placed and never shown", async () => {
    const { result } = renderHook(() => useWidgetOffer(db));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ["unsupported", () => (mockSupported = false)],
    ["the launcher cannot pin", () => (mockCanPin = false)],
    ["a small widget is placed", () => (mockPlacement = { small: 1, medium: 0 })],
    ["a medium widget is placed", () => (mockPlacement = { small: 0, medium: 1 })],
    ["it was shown before", () => jest.mocked(readWidgetOfferShown).mockResolvedValue(true)],
  ])("does not offer when %s", async (_name, change) => {
    change();
    const { result } = renderHook(() => useWidgetOffer(db));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    expect(result.current).toBe(false);
  });
});

describe("WidgetOfferCard", () => {
  it("records the offer as shown on first render, and Add widget asks for the small widget", async () => {
    render(<WidgetOfferCard db={db} language="en" isDark={false} s={strings.en} />);
    expect(screen.getByText(strings.en.widgetOfferTitle)).toBeTruthy();
    await waitFor(() => expect(markWidgetOfferShown).toHaveBeenCalledWith(db, expect.any(Date)));
    fireEvent.press(screen.getByText(strings.en.widgetOfferAdd));
    expect(mockRequestPin).toHaveBeenCalledWith("small");
    expect(screen.queryByText(strings.en.widgetOfferTitle)).toBeNull();
  });

  it("hides on Not now without asking to pin", () => {
    render(<WidgetOfferCard db={db} language="ar" isDark={false} s={strings.ar} />);
    fireEvent.press(screen.getByText(strings.ar.notifSkip));
    expect(mockRequestPin).not.toHaveBeenCalled();
    expect(screen.queryByText(strings.ar.widgetOfferTitle)).toBeNull();
    expect(markWidgetOfferShown).toHaveBeenCalledTimes(1);
  });
});
