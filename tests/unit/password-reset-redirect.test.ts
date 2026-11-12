import { Platform } from "react-native";
import { getPasswordResetRedirectTo } from "@/lib/auth/store";

jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true, supabase: { auth: {} } }));

describe("password reset redirect", () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
    else Reflect.deleteProperty(globalThis, "location");
  });

  it.each(["android", "ios"] as const)("sends %s users to the web reset page", (platform) => {
    jest.replaceProperty(Platform, "OS", platform);
    expect(getPasswordResetRedirectTo()).toBe("https://hafizquran.app/auth/reset-password");
  });

  it("keeps the current web origin", () => {
    jest.replaceProperty(Platform, "OS", "web");
    Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://localhost:8081" } });
    expect(getPasswordResetRedirectTo()).toBe("http://localhost:8081/auth/reset-password");
  });
});
