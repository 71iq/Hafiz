import { expect, test } from "@playwright/test";
import { assertHealthyPage, captureConsole, waitForQaReady } from "./helpers";

for (const key of ["Enter", "Space"] as const) {
  test(`activates the donor footer with ${key}`, async ({ browser }) => {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const capture = captureConsole(page);

    try {
      await waitForQaReady(page);
      await page.goto("/settings?category=about", { waitUntil: "domcontentloaded" });
      await page.getByText("Become a Donor", { exact: true }).click();

      const message = page.getByText(
        "There are no donation options available right now. Support options will be added soon.",
        { exact: true },
      );
      const footer = page.getByRole("button", { name: "Close", exact: true }).filter({ hasText: "Close" });

      await expect(message).toBeVisible();
      await expect(footer).toBeVisible();
      await footer.focus();
      await footer.press(key);

      await expect(footer).toHaveCount(0);
      await expect(message).toHaveCount(0);
      await expect(page.getByText("Become a Donor", { exact: true })).toBeVisible();
      await assertHealthyPage(page, capture);
    } finally {
      await context.close();
    }
  });
}
