import { I18nManager, Platform } from "react-native";
import { renderHook } from "@testing-library/react-native";
import { useAppLanguage } from "@/lib/i18n/useStrings";

const mockSettings = { uiLanguage: "en" as "en" | "ar", isLoaded: false };
jest.mock("@/lib/settings/context", () => ({ useSettings: () => mockSettings }));

describe("useAppLanguage on native", () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "android");
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    { app: "ar", deviceRTL: false },
    { app: "en", deviceRTL: true },
  ] as const)("follows the $app app language on a phone with isRTL=$deviceRTL", ({ app, deviceRTL }) => {
    jest.replaceProperty(I18nManager, "isRTL", deviceRTL);
    mockSettings.uiLanguage = app;
    mockSettings.isLoaded = true;
    expect(renderHook(() => useAppLanguage()).result.current).toBe(app);
  });

  it.each([false, true])("uses the device direction until settings load (isRTL=%s)", (deviceRTL) => {
    jest.replaceProperty(I18nManager, "isRTL", deviceRTL);
    mockSettings.uiLanguage = "en";
    mockSettings.isLoaded = false;
    expect(renderHook(() => useAppLanguage()).result.current).toBe(deviceRTL ? "ar" : "en");
  });
});
