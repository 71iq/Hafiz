import { expect, test, type Page } from "@playwright/test";
import { assertHealthyPage, captureConsole, type ConsoleCapture, waitForQaReady } from "../helpers";

test.describe.configure({ mode: "serial" });

const rtlRoutes = [
  "/qa-ready",
  "/auth/login",
  "/auth/signup",
  "/home",
  "/mushaf",
  "/settings",
  "/progress",
  "/leaderboard",
  "/flashcards",
  "/profile",
];

function resetCapture(capture: ConsoleCapture) {
  capture.errors.length = 0;
  capture.pageErrors.length = 0;
}

async function assertNoHorizontalOverflow(page: Page, route: string) {
  const metrics = await page.evaluate(() => ({
    bodyTextLength: document.body.innerText.trim().length,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect.soft(metrics.bodyTextLength, `${route} should render meaningful text`).toBeGreaterThan(8);
  expect
    .soft(metrics.scrollWidth, `${route} should not create horizontal overflow in RTL`)
    .toBeLessThanOrEqual(metrics.clientWidth + 2);
}

async function assertRootDirection(page: Page, route: string) {
  const direction = await page.evaluate(() => ({
    htmlDir: document.documentElement.getAttribute("dir"),
    htmlComputedDir: window.getComputedStyle(document.documentElement).direction,
    bodyComputedDir: window.getComputedStyle(document.body).direction,
  }));

  expect.soft(direction.htmlDir, `${route} should seed html dir from Arabic startup language`).toBe("rtl");
  expect.soft(direction.htmlComputedDir, `${route} html computed direction should be RTL`).toBe("rtl");
  expect.soft(direction.bodyComputedDir, `${route} body computed direction should be RTL`).toBe("rtl");
}

async function assertAuthFormChromeAlignsStart(page: Page, route: string) {
  if (!route.startsWith("/auth/")) return;

  const inputMetrics = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((element) => {
        const style = window.getComputedStyle(element);
        return {
          direction: style.direction,
          textAlign: style.textAlign,
        };
      })
  );

  if (inputMetrics.length === 0) {
    expect.soft(inputMetrics.length, `${route} may show auth-unavailable state without inputs`).toBe(0);
    return;
  }

  expect.soft(
    inputMetrics.some((input) => input.direction === "rtl" || input.textAlign === "right"),
    `${route} form inputs should align to RTL start`
  ).toBe(true);
}

async function assertNoHorizontalMirrorTransforms(page: Page, route: string) {
  if (route !== "/mushaf") return;

  const mirroredElements = await page.evaluate(() =>
    Array.from(document.body.querySelectorAll("*"))
      .map((element) => ({
        tagName: element.tagName.toLowerCase(),
        text: (element.textContent ?? "").trim().slice(0, 80),
        transform: window.getComputedStyle(element).transform,
      }))
      .filter(({ transform }) =>
        /scaleX\(-1\)|matrix\(-1[,)]|matrix3d\(-1[,)]|rotateY\(180deg\)/i.test(transform)
      )
  );

  expect.soft(mirroredElements, `${route} should not horizontally mirror Mushaf/Quran content`).toEqual([]);
}

test.describe("report-only RTL UI contract", () => {
  let sharedPage: Page;
  let capture: ConsoleCapture;

  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    await sharedPage.addInitScript(() => {
      window.localStorage.setItem("hafiz_ui_language", "ar");
    });
    capture = captureConsole(sharedPage);
    await waitForQaReady(sharedPage);
  });

  test.afterAll(async () => {
    await sharedPage?.close();
  });

  for (const route of rtlRoutes) {
    test(`${route} satisfies baseline RTL route invariants`, async () => {
      resetCapture(capture);
      await sharedPage.goto(route, { waitUntil: "domcontentloaded" });
      await assertHealthyPage(sharedPage, capture);
      await assertRootDirection(sharedPage, route);
      await assertNoHorizontalOverflow(sharedPage, route);
      await assertAuthFormChromeAlignsStart(sharedPage, route);
      await assertNoHorizontalMirrorTransforms(sharedPage, route);
    });
  }
});
