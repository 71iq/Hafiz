import { expect, test, type Page } from "@playwright/test";
import { assertHealthyPage, captureConsole, type ConsoleCapture, waitForQaReady } from "./helpers";

test.describe.configure({ mode: "serial" });

const strictSmokeRoutes = [
  "/",
  "/qa-ready",
  "/about",
  "/privacy",
  "/terms",
  "/onboarding",
  "/auth/login",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/qf-callback",
  "/home",
  "/mushaf",
  "/leaderboard",
  "/progress",
  "/settings",
  "/flashcards",
  "/search",
  "/reflection-feed",
  "/reflection-journey",
  "/flashcards/session",
  "/flashcards/vocab",
  "/profile",
  "/profile/missing-user",
  "/open?surah=2&ayah=255",
  "/open?surah=999&ayah=1",
  "/definitely-not-found",
];

function resetCapture(capture: ConsoleCapture) {
  capture.errors.length = 0;
  capture.pageErrors.length = 0;
}

test.describe("strict route smoke", () => {
  let sharedPage: Page;
  let capture: ConsoleCapture;

  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    capture = captureConsole(sharedPage);
    await waitForQaReady(sharedPage);
    await assertHealthyPage(sharedPage, capture);
  });

  test.afterAll(async () => {
    await sharedPage?.close();
  });

  for (const route of strictSmokeRoutes) {
    test(`${route} renders without a blank screen or runtime overlay`, async () => {
      resetCapture(capture);
      await sharedPage.goto(route, { waitUntil: "domcontentloaded" });
      await assertHealthyPage(sharedPage, capture);
    });
  }

  test("Arabic phone verse deep link keeps the requested ayah in view", async () => {
    await sharedPage.goto("/settings", { waitUntil: "domcontentloaded" });
    await sharedPage.getByText("Verse by Verse", { exact: true }).click();
    await sharedPage.getByRole("radio", { name: "Dark", exact: true }).click();
    await sharedPage.getByText("العربية", { exact: true }).click();
    await sharedPage.goto("/open?surah=2&ayah=255", { waitUntil: "domcontentloaded" });
    await expect(sharedPage.getByRole("button", { name: "2:255", exact: true })).toBeInViewport({ timeout: 30_000 });
    await expect(sharedPage.locator("html")).toHaveAttribute("dir", "rtl");
    await sharedPage.goto("/open?surah=2&ayah=149", { waitUntil: "domcontentloaded" });
    await expect(sharedPage.getByRole("button", { name: "2:149", exact: true })).toBeInViewport();
    await sharedPage.goto("/open?surah=2&ayah=255", { waitUntil: "domcontentloaded" });
    await expect(sharedPage.getByRole("button", { name: "2:255", exact: true })).toBeInViewport();
  });
});

test("a link carrying another account's session tokens does not sign the visitor in", async ({ browser }) => {
  const context = await browser.newContext();
  const userId = "00000000-0000-4000-8000-0000000000aa";
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: userId, session_id: "10000000-0000-4000-8000-0000000000aa", exp: expiresAt, role: "authenticated" }),
    "c3ludGhldGlj",
  ].join(".");
  // The export may point at a real API. Nothing reaches it: the user lookup answers as it would for a
  // valid token, and every other request is refused.
  const userLookups: string[] = [];
  await context.route(
    (url) => /\/(auth|rest|storage|functions)\/v1\//.test(url.pathname),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/auth/v1/user")) {
        userLookups.push(url.pathname);
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ id: userId, aud: "authenticated", app_metadata: {}, user_metadata: {} }),
        });
      } else await route.abort();
    },
  );
  const page = await context.newPage();
  try {
    await page.goto(
      `/privacy#access_token=${token}&refresh_token=synthetic&expires_in=3600&expires_at=${expiresAt}&token_type=bearer`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByText("Privacy", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    expect(page.url()).not.toContain("access_token");
    const stored = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.endsWith("-auth-token"))
        .map((key) => localStorage.getItem(key)),
    );
    expect(stored).toEqual([]);
    expect(userLookups).toEqual([]);
  } finally {
    await context.close();
  }
});
