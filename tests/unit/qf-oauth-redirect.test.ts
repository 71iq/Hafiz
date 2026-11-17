import fs from "node:fs";
import path from "node:path";
import { Platform } from "react-native";
import appConfig from "@/app.json";
import { getQfOAuthRedirectUri, QF_APP_CALLBACK_PATH } from "@/lib/quran-foundation/oauth-redirect";

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

  it.each(["ios", "android"] as const)("uses the app's own callback on %s", (platform) => {
    jest.replaceProperty(Platform, "OS", platform);
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://staging.hafizquran.app" },
      configurable: true,
    });
    // The website's /auth/qf-callback stays out of the Android App Link, so Chrome keeps it.
    expect(getQfOAuthRedirectUri()).toBe("https://hafizquran.app/auth/qf-app-callback");
  });

  it("claims only the app's callback as an Android App Link, never the website's", () => {
    const paths = appConfig.expo.android.intentFilters.flatMap((filter) =>
      filter.data.map((data: { path?: string; pathPrefix?: string }) => data.path ?? data.pathPrefix),
    );
    expect(paths).toEqual([QF_APP_CALLBACK_PATH]);
    const manifest = fs.readFileSync(path.join(__dirname, "../../android/app/src/main/AndroidManifest.xml"), "utf8");
    const manifestPaths = [...manifest.matchAll(/android:host="hafizquran\.app" android:(path\w*)="([^"]*)"/g)];
    expect(manifestPaths.map(([, attribute, value]) => [attribute, value])).toEqual([["path", QF_APP_CALLBACK_PATH]]);
  });
});
