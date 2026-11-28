import { expect, test, type Page } from "@playwright/test";
import { assertHealthyPage, captureConsole, type ConsoleCapture, waitForQaReady } from "./helpers";

const strictSmokeRoutes = [
  "/",
  "/qa-ready",
  "/about",
  "/privacy",
  "/terms",
  "/onboarding",
  "/auth/login",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/qf-callback",
  "/home",
  "/mushaf",
  "/leaderboard",
  "/progress",
  "/settings",
  "/flashcards",
  "/search",
  "/reflection-feed",
  "/reflection-journey",
  "/flashcards/session",
  "/flashcards/vocab",
  "/profile",
  "/profile/missing-user",
  "/open?surah=2&ayah=255",
  "/open?surah=999&ayah=1",
  "/definitely-not-found",
];

function resetCapture(capture: ConsoleCapture) {
  capture.errors.length = 0;
  capture.pageErrors.length = 0;
}

test.describe("strict route smoke", () => {
  test.describe.configure({ mode: "serial" });

  let sharedPage: Page;
  let capture: ConsoleCapture;

  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    capture = captureConsole(sharedPage);
    await waitForQaReady(sharedPage);
    await assertHealthyPage(sharedPage, capture);
  });

  test.afterAll(async () => {
    await sharedPage?.close();
  });

  for (const route of strictSmokeRoutes) {
    test(`${route} renders without a blank screen or runtime overlay`, async () => {
      resetCapture(capture);
      await sharedPage.goto(route, { waitUntil: "domcontentloaded" });
      await assertHealthyPage(sharedPage, capture);
    });
  }

  test("Arabic phone verse deep link keeps the requested ayah in view", async () => {
    await sharedPage.goto("/settings", { waitUntil: "domcontentloaded" });
    await sharedPage.getByText("Verse by Verse", { exact: true }).click();
    await sharedPage.getByRole("radio", { name: "Dark", exact: true }).click();
    await sharedPage.getByText("العربية", { exact: true }).click();
    await expect(sharedPage.locator("html")).toHaveAttribute("lang", "ar");
    await expect(sharedPage.locator("html")).toHaveAttribute("dir", "rtl");
    await sharedPage.goto("/open?surah=2&ayah=255", { waitUntil: "domcontentloaded" });
    await expect(sharedPage.getByRole("button", { name: "2:255", exact: true })).toBeInViewport({ timeout: 30_000 });
    await expect(sharedPage.locator("html")).toHaveAttribute("dir", "rtl");
    await sharedPage.goto("/open?surah=2&ayah=149", { waitUntil: "domcontentloaded" });
    await expect(sharedPage.getByRole("button", { name: "2:149", exact: true })).toBeInViewport();
    await sharedPage.goto("/open?surah=2&ayah=255", { waitUntil: "domcontentloaded" });
    await expect(sharedPage.getByRole("button", { name: "2:255", exact: true })).toBeInViewport();
  });
});

test("onboarding language changes update the document and mirror the language button", async ({ page }) => {
  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });

  const html = page.locator("html");
  const arabic = page.getByRole("button", { name: "العربية", exact: true });
  const english = page.getByRole("button", { name: "English", exact: true });
  await expect(arabic).toBeVisible();
  await expect(html).toHaveAttribute("lang", "en");
  await expect(html).toHaveAttribute("dir", "ltr");
  const viewportMiddle = await page.evaluate(() => innerWidth / 2);
  expect(await arabic.evaluate((button) => button.getBoundingClientRect().left)).toBeGreaterThan(viewportMiddle);
  await arabic.click();
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(html).toHaveAttribute("dir", "rtl");
  const arabicLayoutX = await english.evaluate((button) => button.getBoundingClientRect().x);
  expect(arabicLayoutX).toBeLessThan(viewportMiddle);

  await page.reload();
  await expect(english).toBeVisible();
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(html).toHaveAttribute("dir", "rtl");
  expect(await english.evaluate((button) => button.getBoundingClientRect().x)).toBe(arabicLayoutX);

  await english.click();
  await expect(arabic).toBeVisible();
  await expect(html).toHaveAttribute("lang", "en");
  await expect(html).toHaveAttribute("dir", "ltr");
});

test("keyboard search stays in Mushaf and reader shortcuts stop on other tabs", async ({ page }) => {
  await waitForQaReady(page);
  await page.goto("/mushaf");
  await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();

  const search = page.getByPlaceholder("Search Arabic or English...");
  for (const shortcut of ["/", "Control+k"]) {
    await page.keyboard.press(shortcut);
    await expect(search).toBeFocused();
    await expect(page).toHaveURL(/\/mushaf$/);
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
  }

  const shortcutsHelp = page.getByText("Shortcuts and gestures", { exact: true });
  await page.keyboard.press("?");
  await expect(shortcutsHelp).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shortcutsHelp).toBeHidden();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeVisible();

  const pageDownConsumed = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(pageDownConsumed).toBe(false);
  await page.keyboard.press("?");
  await expect(shortcutsHelp).toBeHidden();

  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await expect(page).toHaveURL(/\/home$/);
});

test("text search looks for literal punctuation in Quran text and translation", async ({ page }) => {
  await waitForQaReady(page);
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Mushaf", exact: true })).toBeVisible();
  await page.keyboard.press("/");
  const search = page.getByPlaceholder("Search Arabic or English...");
  await expect(search).toBeFocused();

  for (const query of ["%%", "__"]) {
    await search.fill(query);
    await expect(page.getByText(`No results for "${query}"`, { exact: true })).toBeVisible();
  }

  for (const query of ["MERCY", "مريم"]) {
    await search.fill(query);
    await expect(page.getByText(/^[1-9]\d* results$/)).toBeVisible();
  }
});

test("clearing search on a narrow screen returns to history and keeps focus", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await waitForQaReady(page);
  await page.goto("/home");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  const input = page.getByRole("textbox", { name: "Search", exact: true });
  await expect(input).toBeFocused();
  await input.fill("mercy");
  await input.press("Enter");
  await expect(page.getByText(/^[1-9]\d* results$/)).toBeVisible();

  await page.getByRole("button", { name: "Clear search" }).click({ timeout: 5_000 });
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { name: /^mercy\b/ })).toBeVisible();

  await page.getByRole("button", { name: "Close search" }).click();
  await expect(input).toBeHidden();
});

test("the offline banner follows browser connectivity and local Quran search still works", async ({
  page,
  context,
}) => {
  await waitForQaReady(page);
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Search", exact: true }).first()).toBeVisible();

  const banner = page.getByText("Offline. Your study is saved on this device.", { exact: true });
  await expect(banner).toBeHidden();
  try {
    await context.setOffline(true);
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("/");
    const search = page.getByPlaceholder("Search Arabic or English...");
    await search.fill("مريم");
    await expect(page.getByText(/^[1-9]\d* results$/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
  } finally {
    await context.setOffline(false);
  }
  await expect(banner).toBeHidden();
});

test("plan setup exposes the chosen juz, surah, and review unit to assistive technology", async ({ page }) => {
  await waitForQaReady(page);
  await page.goto("/hifz/setup");
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await next.click();
  const juz = page.getByRole("checkbox", { name: "Juz 30", exact: true });
  await juz.click();
  await expect(juz).toBeChecked();
  await juz.click();
  await expect(juz).toHaveAttribute("aria-checked", "false");

  await page.getByText("By surah", { exact: true }).click();
  const surah = page.getByRole("checkbox").first();
  await surah.click();
  await expect(surah).toBeChecked();

  await next.click();
  const whole = page.getByRole("radio", { name: /^Page\b/ });
  const half = page.getByRole("radio", { name: /^Half page\b/ });
  await expect(whole).toBeChecked();
  await half.click();
  await expect(half).toBeChecked();
  await expect(whole).toHaveAttribute("aria-checked", "false");
});

test("Settings announces category and language selections", async ({ page }) => {
  await waitForQaReady(page);
  await page.goto("/settings");
  const categories = page.getByRole("group", { name: "Settings", exact: true });
  const general = categories.getByRole("button", { name: "General" });
  const content = categories.getByRole("button", { name: "Content" });
  await expect(general).toHaveAttribute("aria-pressed", "true");
  await content.press("Enter");
  await expect(content).toHaveAttribute("aria-pressed", "true");
  await expect(general).toHaveAttribute("aria-pressed", "false");
  await general.press("Space");

  const english = page.getByRole("button", { name: "English", exact: true });
  const arabic = page.getByRole("button", { name: "العربية", exact: true });
  await expect(english).toHaveAttribute("aria-pressed", "true");
  await arabic.click();
  await expect(arabic).toHaveAttribute("aria-pressed", "true");
  await expect(english).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("group", { name: "لغة التطبيق", exact: true })).toBeVisible();
});

test("Space selects Range and shows its fields in Recitation", async ({ page }) => {
  await waitForQaReady(page);
  await page.goto("/mushaf");
  await page.getByRole("button", { name: "Recitation", exact: true }).click();
  const modes = page.getByRole("group", { name: "Recitation", exact: true });
  const single = modes.getByRole("button", { name: "Single" });
  const range = modes.getByRole("button", { name: "Range" });
  await expect(single).toHaveAttribute("aria-pressed", "true");
  await range.press("Space");
  await expect(range).toHaveAttribute("aria-pressed", "true");
  await expect(single).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("End ayah", { exact: true })).toBeVisible();
});

test("auth language radios announce the checked option and support keyboard selection", async ({ page }) => {
  await page.goto("/auth/login");
  const english = page.getByRole("radio", { name: "English", exact: true });
  const arabic = page.getByRole("radio", { name: "العربية", exact: true });
  await expect(english).toBeChecked();
  await expect(arabic).not.toBeChecked();
  await english.press("ArrowRight");
  await expect(arabic).toBeFocused();
  await expect(arabic).toBeChecked();
  await expect(english).not.toBeChecked();
  await english.press("Space");
  await expect(english).toBeChecked();
  await expect(arabic).not.toBeChecked();
});

test("System theme follows the browser while explicit palettes keep their colors", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await waitForQaReady(page);
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  const body = page.locator("body");
  const theme = (name: string) => page.getByRole("radio", { name, exact: true });
  const white = "rgb(255, 255, 255)";
  const dark = "rgb(10, 10, 10)";

  await expect(theme("System")).toBeChecked();
  await expect(page.getByText("Now: Dark", { exact: true })).toBeVisible();
  await expect(body).toHaveCSS("background-color", dark);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.getByText("Now: White", { exact: true })).toBeVisible();
  await expect(body).toHaveCSS("background-color", white);

  for (const [name, background, scheme] of [
    ["White", white, "dark"],
    ["Dark", dark, "light"],
    ["Beige", "rgb(255, 248, 241)", "dark"],
    ["Tahajjud (black)", "rgb(0, 0, 0)", "light"],
  ] as const) {
    await theme(name).click();
    await page.emulateMedia({ colorScheme: scheme });
    await expect(theme(name)).toBeChecked();
    await expect(body).toHaveCSS("background-color", background);
  }

  await theme("System").click();
  await expect(body).toHaveCSS("background-color", white);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.getByText("Now: Dark", { exact: true })).toBeVisible();
  await expect(body).toHaveCSS("background-color", dark);
});

test("a guest can leave a verse for reflection login and return to the same ayah", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForQaReady(page);
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await page.getByText("Verse by Verse", { exact: true }).click();
  await page.goto("/open?surah=2&ayah=255", { waitUntil: "domcontentloaded" });
  const ayah = page.getByRole("button", { name: "2:255", exact: true });
  await expect(ayah).toBeInViewport({ timeout: 30_000 });
  await ayah.click();
  await page.getByRole("button", { name: "Share reflection", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  // Either account configuration has a usable exit, even with the verse reader in history.
  const exit = page.getByRole("button", { name: /^(Back|Continue offline)$/ }).first();
  await expect(exit).toBeVisible({ timeout: 10_000 });
  await page.goBack({ waitUntil: "commit" });
  await expect(ayah).toBeInViewport({ timeout: 20_000 });
});
