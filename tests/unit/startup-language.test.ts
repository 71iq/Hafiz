import { I18nManager, Platform } from "react-native";
import { getStartupLanguage } from "@/lib/i18n/startup-language";

describe("getStartupLanguage", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const getItem = jest.fn<string | null, [string]>();

  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "web");
    jest.replaceProperty(I18nManager, "isRTL", false);
    getItem.mockReset().mockReturnValue(null);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: { getItem },
        navigator: { language: "ar-SA" },
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  describe.each([false, true])("with isRTL=%s", (isRTL) => {
    beforeEach(() => {
      jest.replaceProperty(I18nManager, "isRTL", isRTL);
    });

    it.each(["en", "ar"])("uses cached %s regardless of direction", (cached) => {
      getItem.mockReturnValue(cached);

      expect(getStartupLanguage()).toBe(cached);
      expect(getItem).toHaveBeenCalledWith("hafiz_ui_language");
    });

    it.each([null, "", "fr", "AR", "ar-SA"])(
      "falls back to direction for cache %s, ignoring browser language",
      (cached) => {
        getItem.mockReturnValue(cached);

        expect(getStartupLanguage()).toBe(isRTL ? "ar" : "en");
      }
    );

    it("falls back to direction without a window", () => {
      Reflect.deleteProperty(globalThis, "window");

      expect(getStartupLanguage()).toBe(isRTL ? "ar" : "en");
      expect(getItem).not.toHaveBeenCalled();
    });

    it.each(["android", "ios"] satisfies (typeof Platform.OS)[])(
      "uses direction on %s without reading browser storage",
      (platform) => {
        jest.replaceProperty(Platform, "OS", platform);
        getItem.mockReturnValue(isRTL ? "en" : "ar");

        expect(getStartupLanguage()).toBe(isRTL ? "ar" : "en");
        expect(getItem).not.toHaveBeenCalled();
      }
    );
  });

  it("propagates storage read errors", () => {
    const error = new Error("Storage read failed");
    getItem.mockImplementation(() => {
      throw error;
    });

    expect(getStartupLanguage).toThrow(error);
  });

  it("propagates errors accessing localStorage", () => {
    const error = new Error("Storage access denied");
    Object.defineProperty(window, "localStorage", {
      get() {
        throw error;
      },
    });

    expect(getStartupLanguage).toThrow(error);
  });
});
