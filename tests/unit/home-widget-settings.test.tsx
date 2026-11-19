import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { HomeWidgetSettings } from "@/components/settings/HomeWidgetSettings";
import { strings } from "@/lib/i18n/strings";
import { requestWidgetRefresh } from "@/lib/widget/publish";
import { readWidgetShowNumbers, writeWidgetShowNumbers } from "@/lib/widget/settings";

const mockDb = { name: "synthetic" };
let mockCanPin: Promise<boolean> = Promise.resolve(true);
let mockPlacement: Promise<{ small: number; medium: number }> = Promise.resolve({ small: 0, medium: 0 });
let mockPinAccepted = true;
const mockRequestPin = jest.fn(async (_kind: string) => mockPinAccepted);

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    isDark: false,
    isRTL: false,
    uiLanguage: "en",
    themeColors: { surfaceMid: "#F4F4F5", surfaceHigh: "#E5E7EB" },
  }),
}));
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/widget/platform", () => ({
  widgetPlatform: {
    supported: true,
    canRequestPin: () => mockCanPin,
    getPlacement: () => mockPlacement,
    requestPin: (kind: string) => mockRequestPin(kind),
    subscribePlacement: () => () => {},
  },
}));
jest.mock("@/lib/widget/settings", () => ({
  readWidgetShowNumbers: jest.fn(async () => true),
  writeWidgetShowNumbers: jest.fn(async () => undefined),
}));
jest.mock("@/lib/widget/publish", () => ({ requestWidgetRefresh: jest.fn() }));

const s = strings.en;

beforeEach(() => {
  mockCanPin = Promise.resolve(true);
  mockPlacement = Promise.resolve({ small: 0, medium: 0 });
  mockPinAccepted = true;
  mockRequestPin.mockClear();
  jest.mocked(readWidgetShowNumbers).mockReset().mockResolvedValue(true);
  jest.mocked(writeWidgetShowNumbers).mockClear();
  jest.mocked(requestWidgetRefresh).mockClear();
});

describe("Settings > Home screen widget (spec 8.1)", () => {
  it("renders nothing while the placement and setting load", () => {
    mockCanPin = new Promise(() => {});
    mockPlacement = new Promise(() => {});
    jest.mocked(readWidgetShowNumbers).mockReturnValue(new Promise(() => {}));
    render(<HomeWidgetSettings />);
    expect(screen.queryByText(s.widgetAddTitle)).toBeNull();
    expect(screen.queryByText(s.widgetManualTitle)).toBeNull();
    expect(screen.queryByText(s.widgetShowNumbers)).toBeNull();
  });

  it("offers to add the small widget when none is placed", async () => {
    render(<HomeWidgetSettings />);
    fireEvent.press(await screen.findByText(s.widgetAddTitle));
    expect(screen.getByText(s.widgetAddDesc)).toBeTruthy();
    expect(mockRequestPin).toHaveBeenCalledWith("small");
  });

  it("offers the larger widget when only the small one is placed", async () => {
    mockPlacement = Promise.resolve({ small: 1, medium: 0 });
    render(<HomeWidgetSettings />);
    expect(await screen.findByText(s.widgetPlacedTitle)).toBeTruthy();
    fireEvent.press(screen.getByText(s.widgetAddLargerDesc));
    expect(mockRequestPin).toHaveBeenCalledWith("medium");
  });

  it("offers the smaller widget when only the medium one is placed", async () => {
    mockPlacement = Promise.resolve({ small: 0, medium: 2 });
    render(<HomeWidgetSettings />);
    fireEvent.press(await screen.findByText(s.widgetAddSmallerDesc));
    expect(mockRequestPin).toHaveBeenCalledWith("small");
  });

  it("only reports both widgets when both are placed", async () => {
    mockPlacement = Promise.resolve({ small: 1, medium: 1 });
    render(<HomeWidgetSettings />);
    fireEvent.press(await screen.findByText(s.widgetPlacedBothDesc));
    expect(mockRequestPin).not.toHaveBeenCalled();
  });

  it("explains the manual way when the launcher cannot pin", async () => {
    mockCanPin = Promise.resolve(false);
    render(<HomeWidgetSettings />);
    fireEvent.press(await screen.findByText(s.widgetManualTitle));
    expect(screen.getByText(s.widgetManualDesc)).toBeTruthy();
    expect(mockRequestPin).not.toHaveBeenCalled();
  });

  it("switches to the manual way after the launcher refuses a pin request", async () => {
    mockPinAccepted = false;
    render(<HomeWidgetSettings />);
    fireEvent.press(await screen.findByText(s.widgetAddTitle));
    expect(await screen.findByText(s.widgetManualTitle)).toBeTruthy();
  });

  it("turns Show numbers off, saves it and asks the widget to refresh", async () => {
    render(<HomeWidgetSettings />);
    const toggle = await screen.findByRole("switch");
    expect(toggle.props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(toggle);
    await waitFor(() => expect(requestWidgetRefresh).toHaveBeenCalledTimes(1));
    expect(writeWidgetShowNumbers).toHaveBeenCalledWith(mockDb, false);
    expect(screen.getByRole("switch").props.accessibilityState).toMatchObject({ checked: false });
  });
});
