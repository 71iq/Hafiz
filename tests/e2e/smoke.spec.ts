import { test } from "@playwright/test";
import { assertHealthyPage, captureConsole, openHealthyRoute, waitForQaReady } from "./helpers";

test.describe.configure({ mode: "serial" });

const strictSmokeRoutes = [
  "/qa-ready",
  "/about",
  "/privacy",
  "/terms",
  "/auth/login",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/qf-callback",
  "/definitely-not-found",
];

test("QA readiness route reaches the deterministic ready state", async ({ page }) => {
  const capture = captureConsole(page);
  await waitForQaReady(page);
  await assertHealthyPage(page, capture);
});

for (const route of strictSmokeRoutes.filter((route) => route !== "/qa-ready")) {
  test(`${route} renders without a blank screen or runtime overlay`, async ({ page }) => {
    const capture = captureConsole(page);
    await openHealthyRoute(page, route, capture);
  });
}
