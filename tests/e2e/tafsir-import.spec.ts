import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { assertHealthyPage, captureConsole, waitForQaReady } from "./helpers";

async function databaseSql(page: Page, operation: "exec" | "getAll" | "getFirst", source: string): Promise<unknown> {
  return page.evaluate(
    async ({ operation, source }) => {
      const channel = new BroadcastChannel("hafiz-db-bridge");
      const clientId = "rf104-preview-" + crypto.randomUUID();
      function receive(send: () => void, accepts: (value: Record<string, unknown>) => boolean) {
        return new Promise<Record<string, unknown>>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            channel.removeEventListener("message", listener);
            reject(new Error("Synthetic tafsir preview database request timed out"));
          }, 20_000);
          const listener = (event: MessageEvent<unknown>) => {
            const value = event.data;
            if (!value || typeof value !== "object" || Array.isArray(value)) return;
            const message = value as Record<string, unknown>;
            if (message.version !== 1 || !accepts(message)) return;
            window.clearTimeout(timeout);
            channel.removeEventListener("message", listener);
            resolve(message);
          };
          channel.addEventListener("message", listener);
          send();
        });
      }
      try {
        const host = await receive(
          () => channel.postMessage({ type: "host-probe", version: 1, tabId: clientId }),
          (message) => message.type === "host-ready" && typeof message.tabId === "string" && message.tabId !== clientId,
        );
        const requestId = crypto.randomUUID();
        const reply = await receive(
          () =>
            channel.postMessage({
              type: "request",
              version: 1,
              requestId,
              fromTabId: clientId,
              targetTabId: host.tabId,
              operation,
              source,
              params: [],
            }),
          (message) =>
            message.type === "response" &&
            message.requestId === requestId &&
            message.fromTabId === host.tabId &&
            message.targetTabId === clientId,
        );
        if (reply.ok !== true) throw new Error(String(reply.error));
        return reply.result;
      } finally {
        channel.close();
      }
    },
    { operation, source },
  );
}

for (const failureKind of ["commit", "insert"] as const) {
  test(
    "tafsir download retains the old source after " + failureKind + " failure and succeeds on retry",
    async ({ browser, baseURL }, testInfo) => {
      const origin = new URL(baseURL ?? "");
      expect(origin.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
      const context = await browser.newContext({
        locale: "en-US",
        viewport: { width: 1280, height: 800 },
        colorScheme: "light",
        storageState: { cookies: [], origins: [] },
      });
      try {
        const page = await context.newPage();
        const capture = captureConsole(page);
        await waitForQaReady(page);
        await page.goto("/settings?category=content", { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("button", { name: /^Tafsir Source/ })).toBeVisible({ timeout: 30_000 });

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
        await page.getByRole("button", { name: /^Tafsir Source/ }).click();
        const qurtubi = page.getByRole("button", { name: /^Al-Qurtubi/ });
        await expect(qurtubi.getByText("Download and use", { exact: true })).toBeVisible();
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
        if (failureKind === "commit") {
          await expect(page.getByText("Could not load this tafsir source", { exact: true })).toBeVisible();
        } else {
          // RF163 owns error-message survival during conservative cleanup recovery.
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
          if (!(await qurtubi.isVisible())) await page.getByRole("button", { name: /^Tafsir Source/ }).click();
        }
        await expect(qurtubi.getByText("Download and use", { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("tafsir-failure.png") });
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
          page.getByRole("button", { name: /^Al-Muyassar/ }).getByText("Selected", { exact: true }),
        ).toBeVisible();
        await databaseSql(page, "exec", "DROP TRIGGER IF EXISTS fail_rf104_candidate");
        await qurtubi.click();
        await expect(qurtubi.getByText("Selected", { exact: true })).toBeVisible({ timeout: 60_000 });
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
