import { isOAuthCallbackPath, isQfCallbackPath, redirectOAuthCallbackPath } from "@/lib/auth/oauth-callback";
import { readQfCallbackParams } from "@/lib/quran-foundation/oauth-redirect";

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

  it("drops a warm Quran Foundation App Link for the open Settings session and keeps a cold one", () => {
    const link = "https://hafizquran.app/auth/qf-callback?code=c1&state=s1";
    expect(isQfCallbackPath(link)).toBe(true);
    expect(isQfCallbackPath("/auth/qf-callback?code=c1")).toBe(true);
    expect(redirectOAuthCallbackPath(link, false)).toBeNull();
    expect(redirectOAuthCallbackPath(link, true)).toBe(link);
  });

  it.each([
    "https://hafizquran.app/auth/qf-callbacks",
    "https://example.invalid/auth/qf-callback?code=c1",
    "https://hafizquran.app/profile/auth/qf-callback",
  ])("leaves %s alone", (path) => {
    expect(isQfCallbackPath(path)).toBe(false);
    expect(redirectOAuthCallbackPath(path, false)).toBe(path);
  });
});

describe("Quran Foundation callback params", () => {
  it("keeps only the provider result and decodes it", () => {
    expect(
      readQfCallbackParams(
        "https://hafizquran.app/auth/qf-callback?code=a%2Bb&state=s%3D%3D&extra=x&code=second#fragment=y",
      ),
    ).toEqual({ code: "a+b", state: "s==" });
    expect(
      readQfCallbackParams("https://hafizquran.app/auth/qf-callback?error=access_denied&error_description=No+thanks"),
    ).toEqual({ error: "access_denied", error_description: "No thanks" });
    expect(readQfCallbackParams("https://hafizquran.app/auth/qf-callback")).toEqual({});
  });
});
