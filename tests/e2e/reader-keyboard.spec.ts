import { expect, test } from "@playwright/test";
import { waitForQaReady } from "./helpers";

test("hidden reader controls leave the tab order and return when shown", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForQaReady(page);
  await page.goto("/mushaf");
  await page.getByRole("button", { name: "Verse by Verse. Switch to Page View" }).click();

  const firstSurah = page.getByRole("button", { name: "Open information about Surah The Opener" }).first();
  const more = page.locator('[aria-label="More"]');
  const pageRail = page.locator('[aria-label="Go to, page 1"]');
  const navigation = page.getByRole("button", { name: "Navigation menu" });
  await expect(firstSurah).toBeInViewport();
  await expect(pageRail).toBeInViewport();
  await page.mouse.click(1300, 350); // Blank reading margin.
  await expect(navigation).toHaveCount(0);
  await firstSurah.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(more).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstSurah).toBeFocused();
  await pageRail.focus();
  await expect(firstSurah).toBeFocused();

  await page.mouse.click(1300, 350);
  await expect(navigation).toBeVisible();
  await firstSurah.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(more).toBeFocused();
  // Entering focus mode hides the toolbar while its trigger still has keyboard focus.
  const enterFocusMode = page.getByRole("button", { name: "Enter focus mode" });
  await enterFocusMode.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Mushaf" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(navigation).toBeVisible();
});

test("hiding reader controls skips verse navigation and phone tabs but keeps the reveal rail usable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForQaReady(page);
  await page.goto("/mushaf");
  const indicator = page.locator('[aria-label^="Surah "][aria-label$=". Open Go to"]');
  await expect(indicator).toBeInViewport();
  await indicator.focus();
  await page.mouse.move(1300, 350);
  await page.mouse.wheel(0, 120);
  await expect(page.getByRole("button", { name: "Navigation menu" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Mushaf" })).toBeFocused();
  await indicator.focus();
  await expect(indicator).not.toBeFocused();
  await page.mouse.click(1300, 350);
  await page.getByRole("button", { name: "Verse by Verse. Switch to Page View" }).click();
  await page.getByRole("button", { name: "Page reveal mode" }).click();
  const reveal = page.getByRole("button", { name: "Reveal next word" });
  await expect(reveal).toBeEnabled();
  await page.mouse.click(1300, 350);
  await page.setViewportSize({ width: 390, height: 844 });
  const homeTab = page.locator('button').filter({ hasText: /^Home$/ });
  await expect(homeTab).toHaveCount(1);
  await reveal.focus();
  await homeTab.focus();
  await expect(reveal).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Hide last revealed ayah" })).toBeEnabled();
});
