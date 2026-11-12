import { isOAuthCallbackPath, redirectOAuthCallbackPath } from "@/lib/auth/oauth-callback";

describe("OAuth callback deep links", () => {
  it.each([
    "hafiz://auth/callback",
    "hafiz://auth/callback#access_token=a&refresh_token=b",
    "hafiz:///auth/callback?code=x",
    "exp://192.168.1.2:8081/--/auth/callback#access_token=a",
    "/auth/callback",
  ])("recognizes %s", (path) => {
    expect(isOAuthCallbackPath(path)).toBe(true);
  });

  it.each(["hafiz://open?surah=2&ayah=255", "/auth/login", "hafiz://auth/callbacks", "/profile/auth/callback"])(
    "leaves %s alone",
    (path) => {
      expect(isOAuthCallbackPath(path)).toBe(false);
      expect(redirectOAuthCallbackPath(path, false)).toBe(path);
    },
  );

  it("drops a warm callback for the open browser flow and sends a cold one home", () => {
    expect(redirectOAuthCallbackPath("hafiz://auth/callback#access_token=a", false)).toBeNull();
    expect(redirectOAuthCallbackPath("hafiz://auth/callback#access_token=a", true)).toBe("/(tabs)/home");
  });
});
