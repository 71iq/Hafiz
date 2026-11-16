import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import OnboardingScreen from "@/app/onboarding";
import { writeUserSetting } from "@/lib/database/user-settings";
import { strings } from "@/lib/i18n/strings";

const s = strings.en;
const mockReplace = jest.fn();
const mockSetUiLanguage = jest.fn();
const mockSetupDone = jest.fn();
const mockDb = { name: "isolated-onboarding-fixture" };

jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDb,
  useDatabaseStatus: () => ({ isReady: true, progress: null, error: null }),
}));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    isDark: false,
    isLoaded: true,
    isRTL: false,
    uiLanguage: "en",
    setUiLanguage: mockSetUiLanguage,
    themeColors: { surface: "#fff", surfaceBright: "#fff", surfaceLow: "#eee", surfaceHigh: "#ddd" },
  }),
}));
jest.mock("@/lib/database/user-settings", () => ({ writeUserSetting: jest.fn() }));
jest.mock("@/lib/habit/use-habit-overview", () => ({ emitHabitChanged: jest.fn() }));
jest.mock("@/components/hifz/HifzSetupFlow", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  const { DEFAULT_HIFZ_PLAN: plan } = jest.requireActual<typeof import("@/lib/hifz/plan")>("@/lib/hifz/plan");
  return {
    HifzSetupFlow: ({ onDone }: { onDone: (saved: unknown) => void }) => (
      <Pressable
        onPress={() => {
          mockSetupDone();
          onDone({ plan: { ...plan, unit: "page" }, declaredPages: 20 });
        }}
      >
        <Text>save plan</Text>
      </Pressable>
    ),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("onboarding completion", () => {
  it("retries only the completion after the plan saved, then opens the first session once", async () => {
    jest.mocked(writeUserSetting).mockRejectedValueOnce(new Error("synthetic write failure")).mockResolvedValue();
    const view = render(<OnboardingScreen />);
    fireEvent.press(view.getByLabelText(s.onboardingGetStarted));
    await act(async () => fireEvent.press(view.getByText("save plan")));
    expect(view.getByText(s.onboardingSaveFailed)).toBeTruthy();
    expect(view.queryByText("save plan")).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(view.getByText(s.setupRetry)));
    expect(mockSetupDone).toHaveBeenCalledTimes(1);
    expect(writeUserSetting).toHaveBeenCalledTimes(2);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/hifz/review");
  });

  it("offers the other interface language from the welcome step", () => {
    const view = render(<OnboardingScreen />);
    fireEvent.press(view.getByRole("button", { name: "العربية" }));
    expect(mockSetUiLanguage).toHaveBeenCalledWith("ar");
    expect(view.getByText(s.onboardingSubtitle)).toBeTruthy();
  });
});
