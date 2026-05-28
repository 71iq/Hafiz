import { expect, test, type Page } from "@playwright/test";
import { waitForQaReady } from "../helpers";

test.describe.configure({ mode: "serial" });

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

async function routeSnapshotIsHealthy(route: string, bodyText: string) {
  expect.soft(bodyText.trim().length, `${route} should not render a blank body`).toBeGreaterThan(8);
  for (const pattern of frameworkOverlayPatterns) {
    expect.soft(bodyText, `${route} should not show a framework overlay`).not.toMatch(pattern);
  }
}

test.describe("manual route inventory", () => {
  let sharedPage: Page;

  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    await waitForQaReady(sharedPage);
  });

  test.afterAll(async () => {
    await sharedPage?.close();
  });

  for (const route of routeInventory) {
    test(`${route} renders nonblank without framework overlays`, async () => {
      await sharedPage.goto(route, { waitUntil: "domcontentloaded" });
      await sharedPage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const bodyText = await sharedPage.locator("body").innerText({ timeout: 20_000 });
      await routeSnapshotIsHealthy(route, bodyText);
    });
  }
});
