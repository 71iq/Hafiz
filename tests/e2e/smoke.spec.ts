import { test, type Page } from "@playwright/test";
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
});
