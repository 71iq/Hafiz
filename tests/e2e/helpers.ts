import { expect, type Page } from "@playwright/test";

const frameworkOverlayPatterns = [
  /Failed to compile/i,
  /Unhandled Runtime Error/i,
  /Metro has encountered/i,
  /Internal server error/i,
  /Cannot find module/i,
];

const knownStaticExportPageErrors = [/Minified React error #418/];

export type ConsoleCapture = {
  errors: string[];
  pageErrors: string[];
};

export function captureConsole(page: Page): ConsoleCapture {
  const capture: ConsoleCapture = { errors: [], pageErrors: [] };
  page.on("console", (message) => {
    if (message.type() === "error") {
      capture.errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    capture.pageErrors.push(error.message);
  });
  return capture;
}

export async function waitForQaReady(page: Page) {
  await page.goto("/qa-ready", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("QA_READY")).toBeVisible({ timeout: 120_000 });
}

export async function assertHealthyPage(page: Page, capture: ConsoleCapture) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  const bodyText = await page.locator("body").innerText({ timeout: 20_000 });
  expect(bodyText.trim().length).toBeGreaterThan(8);

  for (const pattern of frameworkOverlayPatterns) {
    expect(bodyText).not.toMatch(pattern);
  }

  const unexpectedPageErrors = capture.pageErrors.filter(
    (message) => !knownStaticExportPageErrors.some((pattern) => pattern.test(message)),
  );
  const unexpectedConsoleErrors = capture.errors.filter(
    (message) => !knownStaticExportPageErrors.some((pattern) => pattern.test(message)),
  );

  expect(unexpectedPageErrors, "unexpected page errors").toEqual([]);
  expect(unexpectedConsoleErrors, "unexpected console errors").toEqual([]);
}

export async function databaseSql(
  page: Page,
  operation: "exec" | "getAll" | "getFirst",
  source: string,
): Promise<unknown> {
  return page.evaluate(
    async ({ operation, source }) => {
      const channel = new BroadcastChannel("hafiz-db-bridge");
      const clientId = "qa-database-preview-" + crypto.randomUUID();
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
