import { I18nManager, Platform } from "react-native";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { resetUiBootstrapForTests } from "@/lib/settings/ui-bootstrap";

function mockDeviceLocale(locale: string | undefined) {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  jest.spyOn(Intl, "DateTimeFormat").mockImplementation(((...args: ConstructorParameters<typeof Intl.DateTimeFormat>) => {
    const formatter = new RealDateTimeFormat(...args);
    const resolved = formatter.resolvedOptions();
    return { ...formatter, resolvedOptions: () => ({ ...resolved, locale: locale as string }) } as Intl.DateTimeFormat;
  }) as unknown as typeof Intl.DateTimeFormat);
}

describe("getStartupLanguage", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const getItem = jest.fn<string | null, [string]>();

  afterEach(() => {
    jest.restoreAllMocks();
    resetUiBootstrapForTests();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  describe("on web", () => {
    beforeEach(() => {
      jest.replaceProperty(Platform, "OS", "web");
      getItem.mockReset().mockReturnValue(null);
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { localStorage: { getItem }, navigator: { language: "ar-SA" } },
      });
    });

    it.each(["en", "ar"])("uses cached %s before the browser language", (cached) => {
      getItem.mockReturnValue(cached);
      expect(getStartupLanguage()).toBe(cached);
      expect(getItem).toHaveBeenCalledWith("hafiz_ui_language");
    });

    it.each([null, "", "fr", "AR", "ar-SA"])("uses the browser language for invalid cache %s", (cached) => {
      getItem.mockReturnValue(cached);
      expect(getStartupLanguage()).toBe("ar");
    });

    it.each(["en-US", "fr-FR", "he-IL", "arn-CL"])("chooses English for browser language %s", (language) => {
      (window as unknown as { navigator: { language: string } }).navigator.language = language;
      expect(getStartupLanguage()).toBe("en");
    });

    it("propagates storage read errors", () => {
      const error = new Error("Storage read failed");
      getItem.mockImplementation(() => {
        throw error;
      });
      expect(getStartupLanguage).toThrow(error);
    });
  });

  describe.each(["android", "ios"] satisfies (typeof Platform.OS)[])("on %s", (platform) => {
    beforeEach(() => {
      jest.replaceProperty(Platform, "OS", platform);
      jest.replaceProperty(I18nManager, "isRTL", false);
      resetUiBootstrapForTests();
    });

    it.each(["en", "ar"] as const)("uses the startup mirror language %s before the device locale", (language) => {
      mockDeviceLocale(language === "ar" ? "en-US" : "ar-EG");
      resetUiBootstrapForTests({ version: 1, language, theme: "system" });
      expect(getStartupLanguage()).toBe(language);
    });

    it.each([
      ["ar-EG", "ar"],
      ["ar", "ar"],
      ["en-GB", "en"],
      ["fa-IR", "en"],
      ["he-IL", "en"],
    ] as const)("maps device locale %s to %s without a mirror", (locale, expected) => {
      mockDeviceLocale(locale);
      resetUiBootstrapForTests(null);
      expect(getStartupLanguage()).toBe(expected);
    });

    it("never reads browser storage", () => {
      getItem.mockReset().mockReturnValue("ar");
      Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem } } });
      mockDeviceLocale("en-US");
      expect(getStartupLanguage()).toBe("en");
      expect(getItem).not.toHaveBeenCalled();
    });
  });
});
