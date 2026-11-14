/**
 * @jest-environment jsdom
 */
import fs from "node:fs";
import path from "node:path";
import React, { act, type ReactNode } from "react";

// Renders through React Native Web into a DOM, as the web export does, because React Native Web
// 0.21 ignores accessibilityState and gives every Pressable its own tab stop.
jest.mock("react-native", () => jest.requireActual("react-native-web"));
// jsdom resolves the icon package's browser build, which is ESM; none of these rows draw icons.
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));

const mockSettings = {
  uiLanguage: "en" as const,
  isRTL: false,
  isDark: false,
  themeColors: { surfaceHigh: "#ddd" },
  theme: "white",
  systemTheme: "white",
  themeSurface: "#fff",
  fontSizeIndex: 2,
  quranFontStyle: "v4",
  quranRenderFontStyle: "v4",
  quranMarkerStyle: "auto",
  tafseerSource: "muyassar",
  markSimilarVerses: true,
  setTheme: jest.fn(),
  setFontSizeIndex: jest.fn(),
  setQuranFontStyle: jest.fn(),
  setQuranMarkerStyle: jest.fn(),
  setMarkSimilarVerses: jest.fn(),
  setTafseerSource: jest.fn(),
};
jest.mock("@/lib/settings/context", () => ({
  FONT_SIZE_STEPS: [14, 16, 18, 20, 22],
  useSettings: () => mockSettings,
}));
const mockDb = {};
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/notifications/settings", () => ({
  readReminderPrefs: jest.fn(async () => jest.requireActual("@/lib/notifications/types").DEFAULT_REMINDER_PREFS),
  writeReminderPref: jest.fn(async () => {}),
}));
jest.mock("@/lib/notifications/permission", () => ({
  getNotificationPermission: jest.fn(async () => ({ status: "granted", canAskAgain: true })),
  requestNotificationPermission: jest.fn(),
  openNotificationSystemSettings: jest.fn(),
}));
jest.mock("@/lib/notifications/schedule", () => ({
  previewReminders: jest.fn(async () => ({ next: null })),
  rescheduleReminders: jest.fn(async () => {}),
}));
jest.mock("@/lib/notifications/calendar", () => ({ exportWirdCalendar: jest.fn() }));
jest.mock("@/lib/prayer/settings", () => ({ readPrayerLocation: jest.fn(async () => null) }));
jest.mock("@/components/notifications/PrayerTimesSetup", () => ({
  PrayerTimesSetup: () => null,
  CALCULATION_METHOD_LABEL_KEYS: {},
}));
jest.mock("@/components/ui/ResponsiveOverlay", () => ({
  ResponsiveOverlay: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  ResponsiveSheet: () => null,
  OverlayHeader: () => null,
  OverlayBody: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/components/ui/OperationNoticeProvider", () => ({ useOperationNotice: () => jest.fn() }));
jest.mock("@/components/settings/TafsirSourcePicker", () => ({ TafsirSourcePicker: () => null }));
jest.mock("@/components/ui/ThemeColorSwatch", () => ({ ThemeColorSwatch: () => null }));
jest.mock("@/lib/settings/use-tafsir-source-selection", () => ({
  useTafsirSourceSelection: () => ({ importingSource: null, selectSource: jest.fn() }),
}));

type Root = { render: (node: ReactNode) => void; unmount: () => void };
// The installed DOM client has no declaration package in this React Native workspace.
const { createRoot } = jest.requireActual<{ createRoot: (container: Element) => Root }>("react-dom/client");
const { Switch } = require("@/components/ui/Switch") as typeof import("@/components/ui/Switch");
const { ReminderSettingsSection } =
  require("@/components/notifications/ReminderSettingsSection") as typeof import("@/components/notifications/ReminderSettingsSection");
const { SocialToggleRow } =
  require("@/components/social/SocialControls") as typeof import("@/components/social/SocialControls");
const { ReadingSettingsSheet } =
  require("@/components/mushaf/ReadingSettingsSheet") as typeof import("@/components/mushaf/ReadingSettingsSheet");
const { DEFAULT_REMINDER_PREFS, NOTIFICATION_TYPES } =
  jest.requireActual<typeof import("@/lib/notifications/types")>("@/lib/notifications/types");
const { writeReminderPref } = jest.requireMock<{ writeReminderPref: jest.Mock }>("@/lib/notifications/settings");
const { strings } = jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings");
const en = strings.en;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  jest.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function show(node: ReactNode) {
  await act(async () => root.render(node));
}

function switchNamed(name: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>('[role="switch"]')].filter(
    (node) => node.getAttribute("aria-label") === name,
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/** Sends a key the way a browser does and reports whether the page's default (scrolling) was cancelled. */
function press(target: HTMLElement, key: string): boolean {
  let prevented = false;
  act(() => {
    prevented = !target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  });
  return prevented;
}

/** The row is the only tab stop, and its decorative track has no role, name, focus or touch. */
function expectOneTabStop(row: HTMLElement) {
  expect(row.getAttribute("tabindex")).toBe("0");
  expect(row.querySelectorAll("[role], [aria-label], [tabindex]")).toHaveLength(0);
  const tracks = row.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
  expect(tracks).toHaveLength(1);
  expect(getComputedStyle(tracks[0]).pointerEvents).toBe("none");
}

describe("switch rows on web", () => {
  it("gives each of the ten web reminder rows its state and a single tab stop", async () => {
    await show(<ReminderSettingsSection />);
    const rows = [...host.querySelectorAll<HTMLElement>('[role="switch"]')];
    // The master switch and every type except remind_later, which web cannot offer.
    expect(rows).toHaveLength(10);

    expect(switchNamed(en.notifMasterLabel).getAttribute("aria-checked")).toBe("true");
    expect(switchNamed(en.notifTypeWird).getAttribute("aria-checked")).toBe(
      String(DEFAULT_REMINDER_PREFS.types.wird_reminder),
    );
    expect(switchNamed(en.notifTypeKahf).getAttribute("aria-checked")).toBe("false");
    const values = rows.map((row) => row.getAttribute("aria-checked"));
    expect(values).toEqual([
      "true",
      ...NOTIFICATION_TYPES.filter((type) => type !== "remind_later").map((type) =>
        String(DEFAULT_REMINDER_PREFS.types[type]),
      ),
    ]);
    expect(values).toContain("false");
    rows.forEach(expectOneTabStop);
  });

  it("turns a reminder type on with Space without scrolling, and Enter still works", async () => {
    await show(<ReminderSettingsSection />);
    const kahf = switchNamed(en.notifTypeKahf);

    expect(press(kahf, " ")).toBe(true);
    await act(async () => {});
    expect(writeReminderPref).toHaveBeenCalledTimes(1);
    expect(writeReminderPref).toHaveBeenLastCalledWith(mockDb, { kind: "type", type: "friday_kahf", value: true });

    press(switchNamed(en.notifTypeKahf), "Enter");
    await act(async () => {});
    expect(writeReminderPref).toHaveBeenCalledTimes(2);
    expect(writeReminderPref).toHaveBeenLastCalledWith(mockDb, { kind: "type", type: "friday_kahf", value: true });
  });

  it.each([true, false])("keeps the social row state %s in aria-checked and toggles it with Space", async (value) => {
    const onValueChange = jest.fn();
    await show(<SocialToggleRow label="Share streak" value={value} onValueChange={onValueChange} />);
    const row = switchNamed("Share streak");
    expect(row.getAttribute("aria-checked")).toBe(String(value));
    expectOneTabStop(row);

    expect(press(row, " ")).toBe(true);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(!value);
  });

  it("marks a disabled row as disabled and ignores Space and Enter", async () => {
    const onValueChange = jest.fn();
    await show(<SocialToggleRow label="Share streak" value={false} onValueChange={onValueChange} disabled />);
    const row = switchNamed("Share streak");
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("aria-checked")).toBe("false");

    expect(press(row, " ")).toBe(false);
    press(row, "Enter");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "gives the reader's Mark similar verses row state %s and toggles it with Space",
    async (value) => {
      mockSettings.markSimilarVerses = value;
      await show(<ReadingSettingsSheet visible onClose={jest.fn()} />);
      const row = switchNamed(en.hifzSimilarMarkSetting);
      expect(row.getAttribute("aria-checked")).toBe(String(value));
      expectOneTabStop(row);

      expect(press(row, " ")).toBe(true);
      expect(mockSettings.setMarkSimilarVerses).toHaveBeenCalledTimes(1);
      expect(mockSettings.setMarkSimilarVerses).toHaveBeenCalledWith(!value);
    },
  );

  it.each([true, false])("keeps a standalone switch's own role, name and state %s", async (value) => {
    const onValueChange = jest.fn();
    await show(<Switch value={value} onValueChange={onValueChange} accessibilityLabel="Tajweed colours" />);
    const control = switchNamed("Tajweed colours");
    expect(control.getAttribute("aria-checked")).toBe(String(value));
    expect(control.getAttribute("tabindex")).toBe("0");

    expect(press(control, " ")).toBe(true);
    expect(onValueChange).toHaveBeenCalledWith(!value);
  });
});

describe("switch row ownership", () => {
  const root = process.cwd();
  function sourceFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(absolute);
      return entry.name.endsWith(".tsx") ? [path.relative(root, absolute).split(path.sep).join("/")] : [];
    });
  }

  // A hand-built switch row loses aria-checked, Space and the single tab stop on web.
  it("builds every switch row with the shared SwitchRow", () => {
    const owners = ["app", "components"]
      .flatMap((directory) => sourceFiles(path.join(root, directory)))
      .filter((file) =>
        /(?:accessibilityRole|role)\s*[=:]\s*\{?\s*["']switch["']/.test(fs.readFileSync(path.join(root, file), "utf8")),
      );
    expect(owners).toEqual(["components/ui/Switch.tsx"]);
  });
});
