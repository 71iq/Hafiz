import { Platform } from "react-native";
import { getQfOAuthRedirectUri } from "@/lib/quran-foundation/oauth-redirect";

describe("Quran Foundation OAuth callbacks", () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalLocation) {
      Object.defineProperty(globalThis, "location", originalLocation);
    } else {
      Reflect.deleteProperty(globalThis, "location");
    }
  });

  it.each(["https://hafizquran.app", "https://staging.hafizquran.app"])(
    "returns to the initiating web origin %s",
    (origin) => {
      jest.replaceProperty(Platform, "OS", "web");
      Object.defineProperty(globalThis, "location", { value: { origin }, configurable: true });
      expect(getQfOAuthRedirectUri()).toBe(`${origin}/auth/qf-callback`);
    },
  );

  it.each(["ios", "android"] as const)("preserves the canonical callback on %s", (platform) => {
    jest.replaceProperty(Platform, "OS", platform);
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://staging.hafizquran.app" },
      configurable: true,
    });
    expect(getQfOAuthRedirectUri()).toBe("https://hafizquran.app/auth/qf-callback");
  });
});
