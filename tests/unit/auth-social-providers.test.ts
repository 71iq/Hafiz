import { getEnabledSocialProviders, parseSocialAuthProviders } from "@/lib/auth/config";

describe("social sign-in provider list", () => {
  it.each<[string | undefined, string[]]>([
    [undefined, ["google", "apple", "facebook"]],
    ["", []],
    ["none", []],
    [" NONE ", []],
    ["google", ["google"]],
    [" Google , FACEBOOK ", ["google", "facebook"]],
    ["facebook,apple,google", ["google", "apple", "facebook"]],
    ["google,twitter,,google", ["google"]],
    ["twitter", []],
  ])("reads %p as %p", (value, expected) => {
    expect(parseSocialAuthProviders(value)).toEqual(expected);
  });

  describe("build variable", () => {
    const original = process.env.EXPO_PUBLIC_SOCIAL_AUTH_PROVIDERS;
    afterEach(() => {
      if (original === undefined) delete process.env.EXPO_PUBLIC_SOCIAL_AUTH_PROVIDERS;
      else process.env.EXPO_PUBLIC_SOCIAL_AUTH_PROVIDERS = original;
    });

    it("enables only the listed providers", () => {
      process.env.EXPO_PUBLIC_SOCIAL_AUTH_PROVIDERS = "google";
      expect(getEnabledSocialProviders()).toEqual(["google"]);
    });

    it("enables every provider when unset", () => {
      delete process.env.EXPO_PUBLIC_SOCIAL_AUTH_PROVIDERS;
      expect(getEnabledSocialProviders()).toEqual(["google", "apple", "facebook"]);
    });
  });
});
