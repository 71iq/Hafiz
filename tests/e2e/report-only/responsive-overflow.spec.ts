import { expect, test, type Page } from "@playwright/test";
import { waitForQaReady } from "../helpers";

test.describe.configure({ mode: "serial" });

const responsiveRoutes = ["/home", "/mushaf", "/progress", "/settings"];
const responsiveViewports = [
  { label: "phone-390", width: 390, height: 844 },
  { label: "tablet-768", width: 768, height: 1024 },
  { label: "desktop-1440", width: 1440, height: 1000 },
];

async function assertNoHorizontalOverflow(page: Page, route: string, viewportLabel: string) {
  const metrics = await page.evaluate(() => ({
    bodyTextLength: document.body.innerText.trim().length,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect.soft(metrics.bodyTextLength, `${route} ${viewportLabel} should render meaningful text`).toBeGreaterThan(8);
  expect
    .soft(metrics.scrollWidth, `${route} ${viewportLabel} should not create document horizontal overflow`)
    .toBeLessThanOrEqual(metrics.clientWidth + 2);
}

test.describe("responsive route overflow", () => {
  let sharedPage: Page;

  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    await waitForQaReady(sharedPage);
  });

  test.afterAll(async () => {
    await sharedPage?.close();
  });

  for (const viewport of responsiveViewports) {
    for (const route of responsiveRoutes) {
      test(`${route} has no horizontal overflow at ${viewport.label}`, async () => {
        await sharedPage.setViewportSize({ width: viewport.width, height: viewport.height });
        await sharedPage.goto(route, { waitUntil: "domcontentloaded" });
        await sharedPage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        await assertNoHorizontalOverflow(sharedPage, route, viewport.label);
      });
    }
  }
});
