import { strings } from "@/lib/i18n/strings";
import { expect, test } from "@playwright/test";
import {
  assertHealthyPage,
  assertReadableNotice,
  captureConsole,
  databaseSql,
  prepareContentImportPreview,
  waitForQaReady,
} from "./helpers";

for (const language of ["en", "ar"] as const) {
  const s = strings[language];
  test(
    "translation keeps the previous selection after an insert failure and retries " + language,
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
        await prepareContentImportPreview(context, language);
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
        const storedLanguages = () =>
          databaseSql(
            page,
            "getAll",
            "SELECT key,value FROM user_settings WHERE key IN ('translation_language','translation_active_lang') ORDER BY key",
          );
        const previousLanguages = await storedLanguages();
        await databaseSql(
          page,
          "exec",
          `CREATE TEMP TRIGGER fail_rf164_candidate AFTER INSERT ON translation_active
        WHEN NEW.text='RF164 synthetic failure'
        BEGIN SELECT RAISE(ABORT,'RF164 synthetic translation failure'); END;`,
        );
        await setting.click();
        const frenchName = language === "ar" ? "الفرنسية" : "French";
        const french = page.getByRole("radio", { name: frenchName + " Français", exact: true });
        await expect(french).toBeVisible();
        const failure = page.waitForEvent("console", {
          predicate: (message) =>
            message.type() === "warning" &&
            message.text().includes("[Settings] Failed to import translation:") &&
            message.text().includes("RF164 synthetic translation failure"),
        });
        await french.click();
        await failure;
        const dialog = page.getByRole("dialog");
        const notice = dialog.getByText(s.translationLoadFailed, { exact: true });
        const retry = dialog.getByRole("button", { name: s.translationTryAgain, exact: true });
        await expect(retry).toBeFocused();
        await expect(retry).toHaveAccessibleDescription(s.translationLoadFailed);
        await assertReadableNotice(notice);
        await expect(retry).toBeInViewport();
        await expect(dialog.getByRole("radio", { name: /Bridges/ })).toBeChecked();
        await expect(french).not.toBeChecked();
        await page.screenshot({ path: testInfo.outputPath("translation-failure.png") });
        expect(
          await databaseSql(page, "getAll", "SELECT surah,ayah,text FROM translation_active ORDER BY surah,ayah"),
        ).toEqual(retained);
        expect(await storedLanguages()).toEqual(previousLanguages);
        await databaseSql(page, "exec", "DROP TRIGGER fail_rf164_candidate");
        await retry.click();
        await expect(dialog).toBeHidden();
        await expect(setting).toContainText(frenchName);
        expect(
          await databaseSql(page, "getAll", "SELECT surah,ayah,text FROM translation_active ORDER BY surah,ayah"),
        ).toEqual(candidate);
        expect(await storedLanguages()).toEqual([
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
