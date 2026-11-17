import fs from "node:fs";
import path from "node:path";
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

  // Unset offers every provider, so a release path must never build with the variable missing.
  it("never leaves the variable unset in release builds", () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
    expect(read(".github/workflows/hetzner-deploy.yml")).toContain(
      "EXPO_PUBLIC_SOCIAL_AUTH_PROVIDERS: ${{ vars.EXPO_PUBLIC_SOCIAL_AUTH_PROVIDERS || 'none' }}",
    );
    expect(read("scripts/release-android.sh")).toContain('test -n "${EXPO_PUBLIC_SOCIAL_AUTH_PROVIDERS+x}" ||');
  });
});
