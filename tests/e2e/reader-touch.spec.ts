import { expect, test } from "@playwright/test";
import { waitForQaReady } from "./helpers";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
test.skip(({ browserName }) => browserName !== "chromium", "A held finger is driven through Chromium's touch protocol.");

test("releasing a held ayah marker leaves its actions available until the next tap", async ({ page, context }) => {
  await waitForQaReady(page);
  await page.goto("/mushaf");
  await page.getByRole("button", { name: "Verse by Verse. Switch to Page View" }).tap();
  const marker = page.getByRole("button", { name: "Ayah 1:1", exact: true });
  await expect(marker).toBeInViewport();
  const { x, y } = await marker.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const touch = await context.newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  const dialog = page.getByRole("dialog");
  const highlight = dialog.getByRole("button", { name: "Highlight", exact: true });
  await expect(highlight).toBeVisible();
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await highlight.tap();
  await expect(dialog.getByRole("radiogroup")).toBeVisible();
  await page.touchscreen.tap(10, 20);
  await expect(dialog).toHaveCount(0);
  await marker.tap();
  await expect(dialog.getByRole("tab", { name: "Tafsir" })).toBeVisible();
});
