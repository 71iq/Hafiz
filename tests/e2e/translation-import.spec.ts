import { strings } from "@/lib/i18n/strings";
import { expect, test } from "@playwright/test";
import { assertHealthyPage, captureConsole, databaseSql, waitForQaReady } from "./helpers";

for (const language of ["en", "ar"] as const) {
  const s = strings[language];
  test(
    "translation failure survives database recovery and retries " + language,
    async ({ browser, baseURL }, testInfo) => {
      expect(new URL(baseURL ?? "").hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
      const context = await browser.newContext({
        locale: language === "en" ? "en-US" : "ar",
        viewport: { width: language === "en" ? 1280 : 390, height: 844 },
        reducedMotion: "reduce",
        colorScheme: "light",
        storageState: { cookies: [], origins: [] },
      });
      const candidate = [
        { surah: 1, ayah: 1, text: "RF164 synthetic first" },
        { surah: 1, ayah: 2, text: "RF164 synthetic failure" },
      ];
      try {
        await context.addInitScript((language) => {
          if (location.hostname === "127.0.0.1" || location.hostname === "localhost")
            localStorage.setItem("hafiz_ui_language", language);
        }, language);
        await context.route(/\/data\/translations\/fr\.json$/, async (route) => {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(candidate) });
        });
        const page = await context.newPage();
        const capture = captureConsole(page);
        await waitForQaReady(page);
        await page.goto("/settings?category=content", { waitUntil: "domcontentloaded" });
        const setting = page.getByRole("button", { name: new RegExp("^" + s.translationLanguagePickerTitle) });
        await expect(setting).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(
            async () =>
              databaseSql(page, "getFirst", "SELECT value FROM user_settings WHERE key='translation_active_lang'"),
            { timeout: 30_000 },
          )
          .toEqual({ value: "en-bridges" });
        const retained = await databaseSql(
          page,
          "getAll",
          "SELECT surah,ayah,text FROM translation_active ORDER BY surah,ayah",
        );
        expect(Array.isArray(retained) && retained.length > 0).toBe(true);
        const active = await databaseSql(
          page,
          "getFirst",
          "SELECT value FROM user_settings WHERE key='translation_active_lang'",
        );
        await databaseSql(
          page,
          "exec",
          `CREATE TEMP TRIGGER fail_rf164_candidate AFTER INSERT ON translation_active
        WHEN NEW.text='RF164 synthetic failure'
        BEGIN SELECT RAISE(ABORT,'RF164 synthetic translation failure'); END;`,
        );
        await setting.click();
        const french = page.getByRole("dialog").getByText("French", { exact: true });
        await expect(french).toBeVisible();
        const failure = page.waitForEvent("console", {
          predicate: (message) =>
            message.type() === "warning" &&
            message.text().includes("[Settings] Failed to import translation:") &&
            message.text().includes("RF164 synthetic translation failure"),
        });
        await french.click();
        await failure;
        await expect(french).not.toBeVisible();
        await expect(setting).toBeVisible();
        const alert = page.getByRole("alert").filter({ hasText: s.translationLoadFailed });
        await expect(alert).toBeVisible();
        await expect(alert).toHaveText(s.translationLoadFailed);
        await expect(alert).toHaveAttribute("aria-live", "polite");
        const unoccluded = await alert.evaluate((element: HTMLElement) => {
          const previous = element.style.pointerEvents;
          element.style.pointerEvents = "auto";
          try {
            const bounds = element.getBoundingClientRect();
            return [0.25, 0.5, 0.75].every((x) =>
              [0.25, 0.5, 0.75].every((y) => {
                const hit = document.elementFromPoint(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
                return hit === element || element.contains(hit);
              }),
            );
          } finally {
            element.style.pointerEvents = previous;
          }
        });
        expect(unoccluded).toBe(true);
        await page.screenshot({ path: testInfo.outputPath("translation-failure.png") });
        expect(
          await databaseSql(page, "getAll", "SELECT surah,ayah,text FROM translation_active ORDER BY surah,ayah"),
        ).toEqual(retained);
        expect(
          await databaseSql(page, "getFirst", "SELECT value FROM user_settings WHERE key='translation_active_lang'"),
        ).toEqual(active);
        // A fresh SQLite connection has no former connection's TEMP trigger.
        expect(
          await databaseSql(
            page,
            "getAll",
            "SELECT name FROM sqlite_temp_master WHERE type='trigger' AND name='fail_rf164_candidate'",
          ),
        ).toEqual([]);
        await expect(alert).not.toBeVisible();
        await setting.click();
        await french.click();
        await expect(french).not.toBeVisible();
        await expect(setting).toContainText("French");
        expect(
          await databaseSql(page, "getAll", "SELECT surah,ayah,text FROM translation_active ORDER BY surah,ayah"),
        ).toEqual(candidate);
        expect(
          await databaseSql(
            page,
            "getAll",
            "SELECT key,value FROM user_settings WHERE key IN ('translation_language','translation_active_lang') ORDER BY key",
          ),
        ).toEqual([
          { key: "translation_active_lang", value: "fr" },
          { key: "translation_language", value: "fr" },
        ]);
        await page.screenshot({ path: testInfo.outputPath("translation-success.png") });
        await assertHealthyPage(page, capture);
      } finally {
        await context.close();
      }
    },
  );
}
