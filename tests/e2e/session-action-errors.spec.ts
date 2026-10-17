import { expect, test, type Page } from "@playwright/test";
import { assertHealthyPage, captureConsole, waitForQaReady } from "./helpers";

async function fixtureQuery(page: Page, operation: "exec" | "getFirst", source: string): Promise<unknown> {
  expect(new URL(page.url()).protocol).toBe("http:");
  expect(new URL(page.url()).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  return page.evaluate(
    async ({ operation, source }) => {
      const channel = new BroadcastChannel("hafiz-db-bridge");
      const clientId = `rf073-qa-${crypto.randomUUID()}`;
      const requestId = crypto.randomUUID();
      return new Promise<unknown>((resolve, reject) => {
        let sent = false;
        const timeout = setTimeout(() => {
          channel.close();
          reject(new Error("Isolated QA database bridge timed out"));
        }, 20_000);
        channel.onmessage = (event: MessageEvent<unknown>) => {
          const message = event.data;
          if (!message || typeof message !== "object" || !("type" in message)) return;
          if (message.type === "host-ready" && "tabId" in message && typeof message.tabId === "string" && !sent) {
            sent = true;
            channel.postMessage({
              type: "request",
              requestId,
              fromTabId: clientId,
              targetTabId: message.tabId,
              operation,
              source,
              params: [],
            });
          } else if (
            message.type === "response" &&
            "requestId" in message &&
            message.requestId === requestId &&
            "targetTabId" in message &&
            message.targetTabId === clientId &&
            "ok" in message &&
            typeof message.ok === "boolean"
          ) {
            clearTimeout(timeout);
            channel.close();
            if (message.ok) resolve("result" in message ? message.result : undefined);
            else
              reject(
                new Error("error" in message && typeof message.error === "string" ? message.error : "QA SQL failed"),
              );
          }
        };
        channel.postMessage({ type: "host-probe", tabId: clientId });
      });
    },
    { operation, source },
  );
}

test("front-card action failure stays visible above Reveal", async ({ browser, baseURL }, testInfo) => {
  const origin = new URL(baseURL ?? "");
  expect(origin.protocol).toBe("http:");
  expect(origin.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    const capture = captureConsole(page);
    const actionWarnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" && message.text().includes("[FlashcardSession] Card action failed:")) {
        actionWarnings.push(message.text());
      }
    });
    await waitForQaReady(page);
    await expect(await fixtureQuery(page, "getFirst", "SELECT COUNT(*) AS count FROM study_cards")).toEqual({
      count: 0,
    });
    await fixtureQuery(
      page,
      "exec",
      `
      INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, created_at, updated_at)
      VALUES ('2:10', 'deckqa-rf073', '2000-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0, 0, 0, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z'),
             ('2:11', 'deckqa-rf073', '2999-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0, 0, 0, '2000-01-02T00:00:00.000Z', '2000-01-02T00:00:00.000Z');
      CREATE TRIGGER rf073_reject_fixture_suspend BEFORE UPDATE OF suspended_at ON study_cards
      WHEN OLD.id = '2:10' AND OLD.deck_id = 'deckqa-rf073'
      BEGIN SELECT RAISE(ABORT, 'RF073 isolated QA rejection'); END;
    `,
    );
    await expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT COUNT(*) AS count, group_concat(id, ',') AS ids FROM (SELECT id FROM study_cards WHERE deck_id = 'deckqa-rf073' ORDER BY id)",
      ),
    ).toEqual({ count: 2, ids: "2:10,2:11" });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
    await page.goto("/flashcards/session?deckId=deckqa-rf073", { waitUntil: "domcontentloaded" });
    const reveal = page.getByRole("button", { name: "Reveal", exact: true });
    await expect(reveal).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'rf073_reject_fixture_suspend'",
      ),
    ).toMatchObject({ sql: expect.stringContaining("RAISE(ABORT, 'RF073 isolated QA rejection')") });
    await page.getByRole("button", { name: "Card Actions", exact: true }).click();
    await page.getByRole("button", { name: "Suspend Card", exact: true }).click();
    await expect(page.getByText("Card Actions", { exact: true })).toHaveCount(0);
    const error = page.getByText("Could not update card", { exact: true });
    await expect(error).toBeVisible();
    await expect(error).toBeInViewport();
    await expect(reveal).toBeInViewport();
    const errorBox = await error.boundingBox();
    const revealBox = await reveal.boundingBox();
    if (!errorBox || !revealBox) throw new Error("Expected visible error and Reveal geometry");
    expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(revealBox.y);
    expect(
      await reveal.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return target === element || element.contains(target);
      }),
    ).toBe(true);
    expect(actionWarnings).toHaveLength(1);
    // This installed SQLite web driver replaces the trigger reason while finalizing the failed statement.
    expect(actionWarnings[0]).toContain("Error finalizing statement");
    expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT id, suspended_at, deleted_at FROM study_cards WHERE id = '2:10' AND deck_id = 'deckqa-rf073'",
      ),
    ).toEqual({ id: "2:10", suspended_at: null, deleted_at: null });
    expect(await fixtureQuery(page, "getFirst", "SELECT COUNT(*) AS count FROM study_log")).toEqual({ count: 0 });
    await assertHealthyPage(page, capture);
    const screenshot = testInfo.outputPath("front-card-action-error.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("front-card-action-error", { path: screenshot, contentType: "image/png" });
    await testInfo.attach("changed-state-geometry", {
      body: JSON.stringify({
        locale: "en-US",
        theme: "dark",
        viewport: { width: 390, height: 844 },
        errorBox,
        revealBox,
      }),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
});

test("delete-card failure stays inside the active confirmation dialog", async ({ browser, baseURL }, testInfo) => {
  const origin = new URL(baseURL ?? "");
  expect(origin.protocol).toBe("http:");
  expect(origin.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    const capture = captureConsole(page);
    const actionWarnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" && message.text().includes("[FlashcardSession] Card action failed:")) {
        actionWarnings.push(message.text());
      }
    });
    await waitForQaReady(page);
    await expect(await fixtureQuery(page, "getFirst", "SELECT COUNT(*) AS count FROM study_cards")).toEqual({
      count: 0,
    });
    await fixtureQuery(
      page,
      "exec",
      `
      INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, created_at, updated_at)
      VALUES ('2:10', 'deckqa-rf074', '2000-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0, 0, 0, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z'),
             ('2:11', 'deckqa-rf074', '2999-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0, 0, 0, '2000-01-02T00:00:00.000Z', '2000-01-02T00:00:00.000Z');
      CREATE TRIGGER rf074_reject_fixture_delete BEFORE UPDATE OF deleted_at ON study_cards
      WHEN OLD.id = '2:10' AND OLD.deck_id = 'deckqa-rf074' AND NEW.deleted_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'RF074 isolated QA rejection'); END;
    `,
    );
    await expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT COUNT(*) AS count, group_concat(id, ',') AS ids FROM (SELECT id FROM study_cards WHERE deck_id = 'deckqa-rf074' ORDER BY id)",
      ),
    ).toEqual({ count: 2, ids: "2:10,2:11" });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
    await page.goto("/flashcards/session?deckId=deckqa-rf074", { waitUntil: "domcontentloaded" });
    const reveal = page.getByRole("button", { name: "Reveal", exact: true });
    await expect(reveal).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'rf074_reject_fixture_delete'",
      ),
    ).toMatchObject({ sql: expect.stringContaining("RAISE(ABORT, 'RF074 isolated QA rejection')") });

    await page.getByRole("button", { name: "Card Actions", exact: true }).click();
    await page.getByRole("button", { name: "Delete Card", exact: true }).click();
    const dialog = page
      .getByRole("dialog")
      .filter({ hasText: "Delete this card from the deck? Past review logs will be kept." });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const error = dialog.getByRole("alert").filter({ hasText: "Could not update card" });
    await expect(error).toBeVisible();
    await expect(error).toBeInViewport();
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    const confirm = dialog.getByRole("button", { name: "Delete", exact: true });
    await expect(cancel).toBeEnabled();
    await expect(confirm).toBeEnabled();
    await expect(cancel).toBeInViewport();
    await expect(confirm).toBeInViewport();
    const errorBox = await error.boundingBox();
    const cancelBox = await cancel.boundingBox();
    const confirmBox = await confirm.boundingBox();
    if (!errorBox || !cancelBox || !confirmBox) throw new Error("Expected dialog error and footer geometry");
    expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(Math.min(cancelBox.y, confirmBox.y));
    for (const button of [cancel, confirm]) {
      expect(
        await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return target === element || element.contains(target);
        }),
      ).toBe(true);
    }
    expect(actionWarnings).toHaveLength(1);
    expect(actionWarnings[0].split("\n")[0]).toBe(
      "[FlashcardSession] Card action failed: Error: Error: Error finalizing statement",
    );
    expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT id, deleted_at FROM study_cards WHERE id = '2:10' AND deck_id = 'deckqa-rf074'",
      ),
    ).toEqual({ id: "2:10", deleted_at: null });
    expect(await fixtureQuery(page, "getFirst", "SELECT COUNT(*) AS count FROM study_log")).toEqual({ count: 0 });
    await assertHealthyPage(page, capture);
    const screenshot = testInfo.outputPath("delete-card-action-error.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("delete-card-action-error", { path: screenshot, contentType: "image/png" });
    await testInfo.attach("changed-state-geometry", {
      body: JSON.stringify({
        locale: "en-US",
        theme: "dark",
        viewport: { width: 390, height: 844 },
        errorBox,
        cancelBox,
        confirmBox,
        actionWarnings,
      }),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
});

test("answer-save failure stays inside the active answer editor", async ({ browser, baseURL }, testInfo) => {
  const origin = new URL(baseURL ?? "");
  expect(origin.protocol).toBe("http:");
  expect(origin.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    const capture = captureConsole(page);
    const actionWarnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" && message.text().includes("[FlashcardSession] Card action failed:")) {
        actionWarnings.push(message.text());
      }
    });
    await waitForQaReady(page);
    await expect(await fixtureQuery(page, "getFirst", "SELECT COUNT(*) AS count FROM study_cards")).toEqual({
      count: 0,
    });
    await fixtureQuery(
      page,
      "exec",
      `
      INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, created_at, updated_at)
      VALUES ('2:10', 'deckqa-rf075', '2000-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0, 0, 0, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z'),
             ('2:11', 'deckqa-rf075', '2999-01-01T00:00:00.000Z', 0, 0, 0, 0, 0, 0, 0, 0, '2000-01-02T00:00:00.000Z', '2000-01-02T00:00:00.000Z');
      INSERT INTO user_settings (key, value, updated_at, deleted_at)
      VALUES ('review_settings_deckqa-rf075', '{"testModes":["surahName"],"newCardSortOrder":"created"}', '2000-01-01T00:00:00.000Z', NULL);
      CREATE TRIGGER rf075_reject_fixture_answer BEFORE INSERT ON user_settings
      WHEN NEW.key = 'card_answer_2:10:surahName'
      BEGIN SELECT RAISE(ABORT, 'RF075 isolated QA rejection'); END;
    `,
    );
    await expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT COUNT(*) AS count, group_concat(id, ',') AS ids FROM (SELECT id FROM study_cards WHERE deck_id = 'deckqa-rf075' ORDER BY id)",
      ),
    ).toEqual({ count: 2, ids: "2:10,2:11" });
    await expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT key, value, updated_at, deleted_at FROM user_settings WHERE key = 'review_settings_deckqa-rf075'",
      ),
    ).toEqual({
      key: "review_settings_deckqa-rf075",
      value: '{"testModes":["surahName"],"newCardSortOrder":"created"}',
      updated_at: "2000-01-01T00:00:00.000Z",
      deleted_at: null,
    });
    await expect(
      await fixtureQuery(page, "getFirst", "SELECT key FROM user_settings WHERE key = 'card_answer_2:10:surahName'"),
    ).toBeNull();

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
    await page.goto("/flashcards/session?deckId=deckqa-rf075", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Reveal", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'rf075_reject_fixture_answer'",
      ),
    ).toMatchObject({ sql: expect.stringContaining("RAISE(ABORT, 'RF075 isolated QA rejection')") });

    await page.getByRole("button", { name: "Card Actions", exact: true }).click();
    await page.getByRole("button", { name: "Edit Answer", exact: true }).click();
    const input = page.getByPlaceholder("Write the answer shown after reveal...", { exact: true });
    const dialog = page.getByRole("dialog").filter({ has: input });
    await expect(dialog).toBeVisible();
    await input.fill("RF075 QA answer");
    await dialog.getByRole("button", { name: "Save Answer", exact: true }).click();

    const error = dialog.getByRole("alert").filter({ hasText: "Could not update card" });
    await expect(error).toBeVisible();
    await expect(error).toBeInViewport();
    await expect(input).toHaveValue("RF075 QA answer");
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    const save = dialog.getByRole("button", { name: "Save Answer", exact: true });
    await expect(cancel).toBeEnabled();
    await expect(save).toBeEnabled();
    await expect(cancel).toBeInViewport();
    await expect(save).toBeInViewport();
    const errorBox = await error.boundingBox();
    const cancelBox = await cancel.boundingBox();
    const saveBox = await save.boundingBox();
    if (!errorBox || !cancelBox || !saveBox) throw new Error("Expected answer editor error and footer geometry");
    expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(Math.min(cancelBox.y, saveBox.y));
    for (const button of [cancel, save]) {
      expect(
        await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return target === element || element.contains(target);
        }),
      ).toBe(true);
    }
    expect(actionWarnings).toHaveLength(1);
    expect(actionWarnings[0]).toContain("[FlashcardSession] Card action failed:");
    expect(actionWarnings[0]).toContain("Error finalizing statement");
    await expect(
      await fixtureQuery(page, "getFirst", "SELECT key FROM user_settings WHERE key = 'card_answer_2:10:surahName'"),
    ).toBeNull();
    await expect(
      await fixtureQuery(
        page,
        "getFirst",
        "SELECT id, deck_id, suspended_at, deleted_at FROM study_cards WHERE id = '2:10' AND deck_id = 'deckqa-rf075'",
      ),
    ).toEqual({ id: "2:10", deck_id: "deckqa-rf075", suspended_at: null, deleted_at: null });
    await expect(await fixtureQuery(page, "getFirst", "SELECT COUNT(*) AS count FROM study_log")).toEqual({ count: 0 });
    await assertHealthyPage(page, capture);
    const screenshot = testInfo.outputPath("answer-save-action-error.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("answer-save-action-error", { path: screenshot, contentType: "image/png" });
    await testInfo.attach("changed-state-geometry", {
      body: JSON.stringify({
        locale: "en-US",
        theme: "dark",
        viewport: { width: 390, height: 844 },
        errorBox,
        cancelBox,
        saveBox,
        actionWarnings,
      }),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
});
