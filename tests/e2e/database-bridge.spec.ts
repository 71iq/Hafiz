import { expect, test } from "@playwright/test";
import { assertHealthyPage, captureConsole, waitForQaReady } from "./helpers";

test("isolated Chrome database bridge ignores malformed messages and serves a valid query", async ({
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "");
  expect(origin.protocol).toBe("http:");
  expect(origin.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);

  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    const capture = captureConsole(page);
    await waitForQaReady(page);

    const result = await page.evaluate(async () => {
      const channel = new BroadcastChannel("hafiz-db-bridge");
      const clientId = `rf139-qa-${crypto.randomUUID()}`;
      const malformedRequestId = `rf139-malformed-${crypto.randomUUID()}`;
      const validRequestId = `rf139-valid-${crypto.randomUUID()}`;

      try {
        const hostTabId = await new Promise<string>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("RF139 host discovery timed out")), 20_000);
          channel.addEventListener("message", function onMessage(event: MessageEvent<unknown>) {
            const message = event.data;
            if (
              !message ||
              typeof message !== "object" ||
              Array.isArray(message) ||
              !("type" in message) ||
              message.type !== "host-ready" ||
              !("tabId" in message) ||
              typeof message.tabId !== "string" ||
              message.tabId === clientId
            ) {
              return;
            }
            window.clearTimeout(timeout);
            channel.removeEventListener("message", onMessage);
            resolve(message.tabId);
          });
          channel.postMessage({ type: "host-probe", tabId: clientId });
        });

        let malformedResponseCount = 0;
        const malformedListener = (event: MessageEvent<unknown>) => {
          const message = event.data;
          if (
            message &&
            typeof message === "object" &&
            !Array.isArray(message) &&
            "type" in message &&
            message.type === "response" &&
            "requestId" in message &&
            message.requestId === malformedRequestId
          ) {
            malformedResponseCount += 1;
          }
        };
        channel.addEventListener("message", malformedListener);

        channel.postMessage(7);
        channel.postMessage({ type: "not-a-bridge-message" });
        channel.postMessage({
          type: "request",
          requestId: malformedRequestId,
          fromTabId: clientId,
          targetTabId: hostTabId,
          operation: "run",
          source: "SELECT 'malformed' AS value",
          params: [new Date()],
        });
        channel.postMessage({
          type: "response",
          requestId: validRequestId,
          fromTabId: "wrong-host",
          targetTabId: clientId,
          ok: "true",
          result: { value: "ignored" },
        });

        const validResult = await new Promise<unknown>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("RF139 valid query timed out")), 20_000);
          const listener = (event: MessageEvent<unknown>) => {
            const message = event.data;
            if (
              !message ||
              typeof message !== "object" ||
              Array.isArray(message) ||
              !("type" in message) ||
              message.type !== "response" ||
              !("requestId" in message) ||
              message.requestId !== validRequestId ||
              !("fromTabId" in message) ||
              message.fromTabId !== hostTabId ||
              !("targetTabId" in message) ||
              message.targetTabId !== clientId ||
              !("ok" in message) ||
              typeof message.ok !== "boolean"
            ) {
              return;
            }
            window.clearTimeout(timeout);
            channel.removeEventListener("message", listener);
            if (message.ok) resolve("result" in message ? message.result : undefined);
            else reject(new Error("error" in message ? String(message.error) : "RF139 query failed"));
          };
          channel.addEventListener("message", listener);
          channel.postMessage({
            type: "request",
            requestId: validRequestId,
            fromTabId: clientId,
            targetTabId: hostTabId,
            operation: "getFirst",
            source: "SELECT 139 AS value",
            params: [],
          });
        });

        await new Promise((resolve) => window.setTimeout(resolve, 100));
        channel.removeEventListener("message", malformedListener);
        return { malformedResponseCount, validResult };
      } finally {
        channel.close();
      }
    });

    expect(result).toEqual({ malformedResponseCount: 0, validResult: { value: 139 } });
    await assertHealthyPage(page, capture);
  } finally {
    await context.close();
  }
});
