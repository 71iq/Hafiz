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
