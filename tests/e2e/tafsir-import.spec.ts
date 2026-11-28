import { gzipSync } from "node:zlib";
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
        await prepareContentImportPreview(context, language);
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
        const storedSource = () =>
          databaseSql(page, "getFirst", "SELECT value FROM user_settings WHERE key='tafseer_source'");
        const previousSource = await storedSource();
        const setting = page.getByRole("button", { name: new RegExp("^" + s.tafseerSourceLabel) });
        await setting.click();
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
        const retry = page.getByRole("button", { name: s.detailRetry + ", " + s.tafseerQurtubi, exact: true });
        const notice = qurtubi.getByText(s.tafsirDownloadFailed, { exact: true });
        await assertReadableNotice(notice);
        await expect(retry).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath("tafsir-retry-ready.png") });
        expect(await storedSource()).toEqual(previousSource);
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
        await databaseSql(page, "exec", "DROP TRIGGER fail_rf104_candidate");
        await retry.click();
        await expect(page.getByRole("dialog")).toBeHidden({ timeout: 60_000 });
        await expect(setting).toContainText(s.tafseerQurtubi);
        await expect.poll(storedSource).toEqual({ value: "qurtubi" });
        await setting.click();
        await expect(qurtubi.getByText(s.tafseerSelected, { exact: true })).toBeVisible();
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
