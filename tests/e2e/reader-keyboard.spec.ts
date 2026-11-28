import { expect, test } from "@playwright/test";
import { strings } from "../../lib/i18n/strings";
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

for (const locale of ["en", "ar"] as const) {
  test.describe(`Reader in ${locale}`, () => {
    test.use({ locale, hasTouch: true, viewport: { width: 1440, height: 900 } });

    test("focus-mode speed follows the keyboard and pointer", async ({ page }) => {
      const s = strings[locale];
      await waitForQaReady(page);
      await page.goto("/mushaf");
      await page.getByRole("button", { name: s.mushafViewVerse }).click();
      await page.getByRole("button", { name: s.enterFocusMode }).click();
      const resume = page.getByRole("button", { name: s.resumeAutoScroll });
      const slider = page.getByRole("slider", { name: s.autoScrollSpeed });
      const firstWord = page.locator('[data-hafiz-quran-token="word"][data-hafiz-surah="1"]').first();
      await expect(firstWord).toBeInViewport();
      await resume.focus();
      await page.keyboard.press("Tab");
      await expect(slider).toBeFocused();
      await expect(slider).toHaveAttribute("aria-valuemin", "0.2");
      await expect(slider).toHaveAttribute("aria-valuemax", "1.5");
      const faster = locale === "ar" ? "ArrowLeft" : "ArrowRight";
      const slower = locale === "ar" ? "ArrowRight" : "ArrowLeft";
      await slider.press("Home");
      await slider.press(slower);
      await expect(slider).toHaveAttribute("aria-valuenow", "0.2");
      await slider.press(faster);
      await expect(slider).toHaveAttribute("aria-valuenow", "0.3");
      await expect(slider).toHaveAttribute("aria-valuetext", locale === "ar" ? /٠[.٫]٣×/ : /0\.3x/);
      await slider.press("End");
      await slider.press("ArrowUp");
      await expect(slider).toHaveAttribute("aria-valuenow", "1.5");
      await slider.press("ArrowDown");
      await expect(slider).toHaveAttribute("aria-valuenow", "1.4");
      await expect(firstWord).toBeInViewport();
      await slider.press("Tab");
      await expect(page.getByRole("button", { name: s.exitFocusMode })).toBeFocused();
      await slider.click({ position: { x: 1, y: 2 } });
      await expect(slider).toHaveAttribute("aria-valuenow", locale === "ar" ? "1.5" : "0.2");
      const trackWidth = await slider.evaluate((element) => element.clientWidth);
      await slider.tap({ position: { x: trackWidth - 2, y: 2 } });
      await expect(slider).toHaveAttribute("aria-valuenow", locale === "ar" ? "0.2" : "1.5");
      await page.keyboard.press("Escape");
      await expect(slider).toHaveCount(0);
    });
  });
}
