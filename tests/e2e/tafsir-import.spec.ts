import { gzipSync } from "node:zlib";
import { strings } from "@/lib/i18n/strings";
import { expect, test } from "@playwright/test";
import { assertHealthyPage, captureConsole, databaseSql, waitForQaReady } from "./helpers";

const cases = [
  { failureKind: "commit", language: "en", width: 1280 },
  { failureKind: "insert", language: "ar", width: 390 },
] as const;
for (const { failureKind, language, width } of cases) {
  const s = strings[language];
  test(
    "tafsir download retains the old source after " +
      failureKind +
      " failure and succeeds on retry " +
      language +
      "/" +
      width,
    async ({ browser, baseURL }, testInfo) => {
      const origin = new URL(baseURL ?? "");
      expect(origin.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
      const context = await browser.newContext({
        locale: language === "en" ? "en-US" : "ar",
        viewport: { width, height: language === "en" ? 800 : 844 },
        reducedMotion: "reduce",
        colorScheme: "light",
        storageState: { cookies: [], origins: [] },
      });
      try {
        await context.addInitScript((language) => {
          if (location.hostname === "127.0.0.1" || location.hostname === "localhost")
            localStorage.setItem("hafiz_ui_language", language);
        }, language);
        const page = await context.newPage();
        const capture = captureConsole(page);
        await waitForQaReady(page);
        await page.goto("/settings?category=content", { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("button", { name: new RegExp("^" + s.tafseerSourceLabel) })).toBeVisible({
          timeout: 30_000,
        });

        const surahs = await databaseSql(page, "getAll", "SELECT number, ayah_count FROM surahs ORDER BY number");
        if (!Array.isArray(surahs)) throw new Error("Missing synthetic-preview coordinate index");
        const files = new Map<number, { surah: number; ayah: number; text: string }[]>();
        let count = 0;
        for (const row of surahs) {
          if (!row || typeof row !== "object" || !("number" in row) || !("ayah_count" in row))
            throw new Error("Invalid synthetic-preview coordinate index");
          const surah = Number(row.number),
            ayahCount = Number(row.ayah_count);
          const rows = [];
          for (let ayah = 1; ayah <= ayahCount && count < 6234; ayah++) {
            rows.push({ surah, ayah, text: "RF104 synthetic candidate " + ++count });
          }
          files.set(surah, rows);
        }
        expect(count).toBe(6234);
        expect(files.size).toBe(114);
        await context.route(/\/data\/tafsir-sources\/qurtubi\/\d+\.json(?:\.gz)?$/, async (route) => {
          const match = /\/(\d+)\.json/.exec(route.request().url());
          const body = JSON.stringify(files.get(Number(match?.[1])) ?? []);
          const compressed = route.request().url().endsWith(".gz");
          await route.fulfill({
            status: 200,
            contentType: compressed ? "application/gzip" : "application/json",
            body: compressed ? gzipSync(body) : body,
          });
        });
        await databaseSql(
          page,
          "exec",
          `DELETE FROM tafseer WHERE source='qurtubi';
      INSERT INTO tafseer VALUES (1,1,'qurtubi','RF104 synthetic retained one');
      INSERT INTO tafseer VALUES (1,2,'qurtubi','RF104 synthetic retained two');
      CREATE TEMP TABLE rf104_commit_parent (id INTEGER PRIMARY KEY);
      CREATE TEMP TABLE rf104_commit_guard (
        parent_id INTEGER REFERENCES rf104_commit_parent(id) DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TEMP TRIGGER fail_rf104_candidate AFTER INSERT ON tafseer
      WHEN NEW.source='qurtubi' AND NEW.text='RF104 synthetic candidate 701'
      BEGIN ${failureKind === "commit" ? "INSERT INTO rf104_commit_guard VALUES (999)" : "SELECT RAISE(ABORT,'RF104 synthetic candidate failure')"}; END;`,
        );
        expect(await databaseSql(page, "getFirst", "PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });
        const retained = await databaseSql(
          page,
          "getAll",
          "SELECT surah,ayah,source,text FROM tafseer WHERE source='qurtubi' ORDER BY surah,ayah",
        );
        const unrelated = await databaseSql(
          page,
          "getAll",
          "SELECT source,COUNT(*) AS count FROM tafseer WHERE source<>'qurtubi' GROUP BY source ORDER BY source",
        );
        await page.getByRole("button", { name: new RegExp("^" + s.tafseerSourceLabel) }).click();
        const qurtubi = page.getByRole("button", { name: new RegExp("^" + s.tafseerQurtubi) });
        await expect(qurtubi.getByText(s.tafseerDownloadAction, { exact: true })).toBeVisible();
        const failure = page.waitForEvent("console", {
          predicate: (message) =>
            message.type() === "warning" &&
            message.text().includes("[Settings] Failed to import tafsir source:") &&
            message
              .text()
              .includes(
                failureKind === "commit" ? "FOREIGN KEY constraint failed" : "RF104 synthetic candidate failure",
              ),
        });
        await qurtubi.click();
        await failure;
        if (failureKind === "insert") {
          await expect(qurtubi).not.toBeVisible();
          await expect(page.getByRole("button", { name: new RegExp("^" + s.tafseerSourceLabel) })).toBeVisible();
        }
        const notice = page.getByText(s.tafseerSourceImportFailed, { exact: true });
        await expect(notice).toBeVisible();
        const unoccluded = await notice.evaluate((element: HTMLElement) => {
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
        expect(unoccluded, "Failure notice must be readable above the modal").toBe(true);
        const alert = page.getByRole("alert").filter({ hasText: s.tafseerSourceImportFailed });
        await expect(alert).toBeVisible();
        await expect(alert).toHaveText(s.tafseerSourceImportFailed);
        await expect(alert).toHaveAttribute("aria-live", "polite");
        await page.screenshot({ path: testInfo.outputPath("tafsir-failure.png") });
        if (failureKind === "insert") {
          await expect
            .poll(
              async () => {
                try {
                  return await databaseSql(
                    page,
                    "getAll",
                    "SELECT surah,ayah,source,text FROM tafseer WHERE source='qurtubi' ORDER BY surah,ayah",
                  );
                } catch {
                  return null;
                }
              },
              { timeout: 60_000 },
            )
            .toEqual(retained);
          if (!(await qurtubi.isVisible()))
            await page.getByRole("button", { name: new RegExp("^" + s.tafseerSourceLabel) }).click();
        }
        await expect(qurtubi.getByText(s.tafseerDownloadAction, { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("tafsir-retry-ready.png") });
        expect(
          await databaseSql(
            page,
            "getAll",
            "SELECT surah,ayah,source,text FROM tafseer WHERE source='qurtubi' ORDER BY surah,ayah",
          ),
        ).toEqual(retained);
        expect(
          await databaseSql(
            page,
            "getAll",
            "SELECT source,COUNT(*) AS count FROM tafseer WHERE source<>'qurtubi' GROUP BY source ORDER BY source",
          ),
        ).toEqual(unrelated);
        await expect(
          page
            .getByRole("button", { name: new RegExp("^" + s.tafseerMuyassar) })
            .getByText(s.tafseerSelected, { exact: true }),
        ).toBeVisible();
        await databaseSql(page, "exec", "DROP TRIGGER IF EXISTS fail_rf104_candidate");
        await qurtubi.click();
        await expect(qurtubi.getByText(s.tafseerSelected, { exact: true })).toBeVisible({ timeout: 60_000 });
        await page.screenshot({ path: testInfo.outputPath("tafsir-success.png") });
        expect(
          await databaseSql(
            page,
            "getFirst",
            `SELECT COUNT(*) AS count,
      SUM(CASE WHEN text LIKE 'RF104 synthetic candidate %' THEN 1 ELSE 0 END) AS candidate_count
      FROM tafseer WHERE source='qurtubi'`,
          ),
        ).toEqual({ count: 6234, candidate_count: 6234 });
        expect(
          await databaseSql(
            page,
            "getAll",
            "SELECT source,COUNT(*) AS count FROM tafseer WHERE source<>'qurtubi' GROUP BY source ORDER BY source",
          ),
        ).toEqual(unrelated);
        await assertHealthyPage(page, capture);
      } finally {
        await context.close();
      }
    },
  );
}
