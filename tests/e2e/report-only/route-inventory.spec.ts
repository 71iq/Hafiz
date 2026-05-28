import { expect, test, type Page } from "@playwright/test";
import { captureConsole, type ConsoleCapture, waitForQaReady } from "../helpers";

const frameworkOverlayPatterns = [
  /Failed to compile/i,
  /Unhandled Runtime Error/i,
  /Metro has encountered/i,
  /Internal server error/i,
  /Cannot find module/i,
];

const routeInventory = [
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

const knownStaticExportPageErrors = [
  /Minified React error #418/,
];

function resetCapture(capture: ConsoleCapture) {
  capture.errors.length = 0;
  capture.pageErrors.length = 0;
}

async function routeSnapshotIsHealthy(route: string, bodyText: string, capture: ConsoleCapture) {
  expect.soft(bodyText.trim().length, `${route} should not render a blank body`).toBeGreaterThan(8);
  for (const pattern of frameworkOverlayPatterns) {
    expect.soft(bodyText, `${route} should not show a framework overlay`).not.toMatch(pattern);
  }

  expect.soft(
    capture.pageErrors.filter((message) => !knownStaticExportPageErrors.some((pattern) => pattern.test(message))),
    `${route} should not throw unexpected page errors`
  ).toEqual([]);
  expect.soft(
    capture.errors.filter((message) => !knownStaticExportPageErrors.some((pattern) => pattern.test(message))),
    `${route} should not log unexpected console errors`
  ).toEqual([]);
}

test.describe("manual route inventory", () => {
  let sharedPage: Page;
  let capture: ConsoleCapture;

  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    capture = captureConsole(sharedPage);
    await waitForQaReady(sharedPage);
  });

  test.afterAll(async () => {
    await sharedPage?.close();
  });

  for (const route of routeInventory) {
    test(`${route} renders nonblank without framework overlays`, async () => {
      resetCapture(capture);
      await sharedPage.goto(route, { waitUntil: "domcontentloaded" });
      await sharedPage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const bodyText = await sharedPage.locator("body").innerText({ timeout: 20_000 });
      await routeSnapshotIsHealthy(route, bodyText, capture);
    });
  }
});
