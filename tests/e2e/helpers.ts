import { expect, type Page } from "@playwright/test";

const frameworkOverlayPatterns = [
  /Failed to compile/i,
  /Unhandled Runtime Error/i,
  /Metro has encountered/i,
  /Internal server error/i,
  /Cannot find module/i,
];

const knownStaticExportPageErrors = [
  /Minified React error #418/,
];

export type ConsoleCapture = {
  errors: string[];
  pageErrors: string[];
};

export function captureConsole(page: Page): ConsoleCapture {
  const capture: ConsoleCapture = { errors: [], pageErrors: [] };
  page.on("console", (message) => {
    if (message.type() === "error") {
      capture.errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    capture.pageErrors.push(error.message);
  });
  return capture;
}

export async function waitForQaReady(page: Page) {
  await page.goto("/qa-ready", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("QA_READY")).toBeVisible({ timeout: 120_000 });
}

export async function assertHealthyPage(page: Page, capture: ConsoleCapture) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  const bodyText = await page.locator("body").innerText({ timeout: 20_000 });
  expect(bodyText.trim().length).toBeGreaterThan(8);

  for (const pattern of frameworkOverlayPatterns) {
    expect(bodyText).not.toMatch(pattern);
  }

  const unexpectedPageErrors = capture.pageErrors.filter(
    (message) => !knownStaticExportPageErrors.some((pattern) => pattern.test(message))
  );
  const unexpectedConsoleErrors = capture.errors.filter(
    (message) => !knownStaticExportPageErrors.some((pattern) => pattern.test(message))
  );

  expect(unexpectedPageErrors, "unexpected page errors").toEqual([]);
  expect(unexpectedConsoleErrors, "unexpected console errors").toEqual([]);
}

export async function openHealthyRoute(page: Page, route: string, capture: ConsoleCapture) {
  await waitForQaReady(page);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await assertHealthyPage(page, capture);
}
