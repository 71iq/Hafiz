import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import React from "react";
import { Dimensions, I18nManager } from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import type { QfSyncResult } from "@/lib/quran-foundation/user-sync";
import { SafeAreaProvider } from "react-native-safe-area-context";
import SettingsScreen from "@/app/(tabs)/settings";
import { strings } from "@/lib/i18n/strings";
import { DirectionProvider } from "@/lib/ui/direction";
import { type useSettings } from "@/lib/settings/context";
import { getQfConnectionStatus, getQfLinkedIdentityState } from "@/lib/quran-foundation/user";

const mockDatabase = {
  getFirstAsync: jest.fn(async () => null),
  getAllAsync: jest.fn(async () => []),
  runAsync: jest.fn(() => {
    throw new Error("Database write forbidden in QF settings fixture");
  }),
};
const mockUnexpected = jest.fn((...args: unknown[]) => {
  throw new Error(`Unexpected remote, auth, OAuth, or navigation call: ${args.map(String).join(", ")}`);
});
const mockUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "synthetic@example.invalid",
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
  app_metadata: {},
  user_metadata: {},
};
const mockOtherUser = { ...mockUser, id: "00000000-0000-4000-8000-000000000002" };
let mockCurrentUser: typeof mockUser = mockUser;
const mockManualResult: QfSyncResult = { status: "synced", pushed: 1, pulled: 2 };
const mockCallbackResult: QfSyncResult = { status: "synced", pushed: 1, pulled: 2 };
const mockFullQfUserSync = jest.fn(async (_db: SQLiteDatabase): Promise<QfSyncResult> => mockManualResult);
const mockRunInitialQfUserSync = jest.fn(async (_db: SQLiteDatabase): Promise<QfSyncResult> => mockCallbackResult);
let mockParams: { category: string; qf?: string } = { category: "account" };
const mockSettings: Partial<ReturnType<typeof useSettings>> = {};
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), ...mockSettings }) };
});
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockUnexpected, setParams: mockUnexpected, replace: mockUnexpected }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/lib/auth/config", () => ({ isEmailAuthFlowsEnabled: () => false }));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: Object.assign(
    () => ({ user: mockCurrentUser, profile: null, isLoading: false, signOut: mockUnexpected }),
    { getState: () => ({ user: mockCurrentUser }) },
  ),
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: new Proxy({}, { get: () => mockUnexpected }),
}));
jest.mock("@/lib/quran-foundation/config", () => {
  const actual = jest.requireActual<typeof import("@/lib/quran-foundation/config")>("@/lib/quran-foundation/config");
  return { ...actual, isQfContentEnabled: () => false, isQfSyncEnabled: () => true };
});
jest.mock("@/lib/quran-foundation/user", () => ({
  beginQfOAuthConnection: (...args: unknown[]) => mockUnexpected(...args),
  disconnectQfUser: (...args: unknown[]) => mockUnexpected(...args),
  getQfConnectionStatus: jest.fn(async () => ({ ok: true as const, status: "connected" as const })),
  getQfLinkedIdentityState: jest.fn((...args: unknown[]) => mockUnexpected(...args)),
}));
jest.mock("@/lib/quran-foundation/user-sync", () => ({
  fullQfUserSync: (...args: unknown[]) => mockFullQfUserSync(...(args as [SQLiteDatabase])),
  runInitialQfUserSync: (...args: unknown[]) => mockRunInitialQfUserSync(...(args as [SQLiteDatabase])),
}));
jest.mock("@/components/profile/ProfileIdentity", () => ({ ProfileIdentity: () => null }));
jest.mock("@/components/settings/TafsirSourcePicker", () => ({ TafsirSourcePicker: () => null }));
jest.mock("@/components/settings/TranslationLanguagePicker", () => ({ TranslationLanguagePicker: () => null }));
jest.mock("@/components/settings/ReciterPicker", () => ({ ReciterPicker: () => null }));
jest.mock("@/lib/fonts/loader", () => ({
  isQuranPageFontLoaded: () => true,
  loadQuranPageFont: (...args: unknown[]) => mockUnexpected(...args),
  quranPageFontName: () => "SyntheticFont",
  quranPageFontPaletteStyle: () => ({}),
  quranPageMarkerFontPaletteStyle: () => ({}),
}));

function Wrapper({ children }: React.PropsWithChildren) {
  const window = Dimensions.get("window");
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: window.width, height: window.height },
        insets: { top: 0, left: 0, bottom: 0, right: 0 },
      }}
    >
      <OperationNoticeProvider ready={true}>
        <DirectionProvider dir={mockSettings.isRTL ? "rtl" : "ltr"}>{children}</DirectionProvider>
      </OperationNoticeProvider>
    </SafeAreaProvider>
  );
}

function configure(language: "en" | "ar", qf?: "connected") {
  Object.assign(mockSettings, {
    uiLanguage: language,
    isRTL: language === "ar",
    isDark: false,
  });
  mockParams = qf ? { category: "account", qf } : { category: "account" };
  const screen = { width: 390, height: 844, scale: 1, fontScale: 1 };
  Dimensions.set({ window: screen, screen });
  jest.replaceProperty(I18nManager, "isRTL", language === "ar");
}

async function openSettings() {
  const view = render(<SettingsScreen />, { wrapper: Wrapper });
  await act(async () => {});
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = mockUser;
  mockParams = { category: "account" };
  mockManualResult.status = "synced";
  mockCallbackResult.status = "synced";
  mockDatabase.getFirstAsync.mockResolvedValue(null);
  mockDatabase.getAllAsync.mockResolvedValue([]);
  mockDatabase.runAsync.mockImplementation(() => {
    throw new Error("Database write forbidden in QF settings fixture");
  });
  if (typeof globalThis.fetch === "function") {
    jest.spyOn(globalThis, "fetch").mockImplementation(() => mockUnexpected("fetch") as never);
  }
  const history = (globalThis as { history?: History }).history;
  if (history?.replaceState) {
    jest.spyOn(history, "replaceState").mockImplementation(() => undefined);
  }
});

afterEach(() => {
  try {
    cleanup();
    expect(mockUnexpected).not.toHaveBeenCalled();
    expect(mockDatabase.runAsync).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
    Dimensions.set({ window: originalWindow, screen: originalScreen });
  }
});

type Outcome = "failed" | "needs_reauth" | "synced";
const manualCases: { language: "en" | "ar"; status: Outcome }[] = [
  { language: "en", status: "failed" },
  { language: "ar", status: "failed" },
  { language: "en", status: "needs_reauth" },
  { language: "ar", status: "needs_reauth" },
  { language: "en", status: "synced" },
  { language: "ar", status: "synced" },
];
const callbackCases: { language: "en" | "ar"; status: Exclude<Outcome, "synced"> }[] = [
  { language: "en", status: "failed" },
  { language: "ar", status: "failed" },
  { language: "en", status: "needs_reauth" },
  { language: "ar", status: "needs_reauth" },
];

function expectedMessage(language: "en" | "ar", status: Outcome) {
  const locale = strings[language];
  return status === "failed"
    ? locale.qfSyncFailed
    : status === "needs_reauth"
      ? locale.qfNeedsReauth
      : locale.qfSyncComplete;
}

function expectMessageOutcome(view: Awaited<ReturnType<typeof openSettings>>, language: "en" | "ar", status: Outcome) {
  const locale = strings[language];
  expect(view.getByText(expectedMessage(language, status))).toBeTruthy();
  if (status === "synced") {
    expect(view.queryByText(locale.qfSyncFailed)).toBeNull();
    expect(view.queryByText(locale.qfFinishConnection)).toBeNull();
  } else {
    expect(view.queryByText(locale.qfSyncComplete)).toBeNull();
    expect(view.queryByText(locale.qfFinishConnection)).toBeNull();
  }
}

describe.each(manualCases)("manual QF sync $language/$status", ({ language, status }) => {
  it("shows the localized outcome and calls only the manual sync entrypoint", async () => {
    configure(language);
    mockManualResult.status = status;
    const view = await openSettings();
    const manualSync = await view.findByText(strings[language].qfManualSync);

    await act(async () => {
      fireEvent.press(manualSync);
    });

    expect(mockFullQfUserSync).toHaveBeenCalledTimes(1);
    expect(mockFullQfUserSync).toHaveBeenCalledWith(mockDatabase);
    expect(mockRunInitialQfUserSync).not.toHaveBeenCalled();
    expectMessageOutcome(view, language, status);
  });
});

describe.each(callbackCases)("QF callback sync $language/$status", ({ language, status }) => {
  it("shows the localized outcome and calls only the initial sync entrypoint", async () => {
    configure(language, "connected");
    mockCallbackResult.status = status;
    const view = await openSettings();

    await waitFor(() => expect(mockRunInitialQfUserSync).toHaveBeenCalledTimes(1));
    expect(mockRunInitialQfUserSync).toHaveBeenCalledWith(mockDatabase);
    expect(mockFullQfUserSync).not.toHaveBeenCalled();
    await waitFor(() => expectMessageOutcome(view, language, status));
  });
});

describe.each(["en", "ar"] as const)("QF status after an account switch in %s (RF-025)", (language) => {
  it("ignores the previous account's late connection status", async () => {
    configure(language);
    const locale = strings[language];
    type Status = Awaited<ReturnType<typeof getQfConnectionStatus>>;
    let settleOld: (status: Status) => void = () => {};
    jest
      .mocked(getQfConnectionStatus)
      .mockImplementationOnce(() => new Promise<Status>((resolve) => (settleOld = resolve)));
    jest.mocked(getQfConnectionStatus).mockResolvedValueOnce({ ok: true, status: "disconnected" });
    jest.mocked(getQfLinkedIdentityState).mockResolvedValueOnce({ linked: false } as never);
    const view = await openSettings();

    mockCurrentUser = mockOtherUser;
    view.rerender(<SettingsScreen />);
    await waitFor(() => expect(view.getByText(locale.qfConnect)).toBeTruthy());

    await act(async () => {
      settleOld({ ok: true, status: "connected" });
    });

    expect(view.queryByText(locale.qfManualSync)).toBeNull();
    expect(view.queryByText(locale.qfConnected)).toBeNull();
    expect(view.getByText(locale.qfConnect)).toBeTruthy();
  });

  it("clears the previous account's sync message when the account changes", async () => {
    configure(language);
    const locale = strings[language];
    const view = await openSettings();
    await act(async () => {
      fireEvent.press(await view.findByText(locale.qfManualSync));
    });
    expect(view.getByText(locale.qfSyncComplete)).toBeTruthy();

    mockCurrentUser = mockOtherUser;
    await act(async () => {
      view.rerender(<SettingsScreen />);
    });

    expect(view.queryByText(locale.qfSyncComplete)).toBeNull();
  });

  it("does not replay the previous account's OAuth return for the next account", async () => {
    configure(language, "connected");
    const locale = strings[language];
    mockCallbackResult.status = "failed";
    const view = await openSettings();
    await waitFor(() => expect(mockRunInitialQfUserSync).toHaveBeenCalledTimes(1));

    mockCurrentUser = mockOtherUser;
    await act(async () => {
      view.rerender(<SettingsScreen />);
    });

    expect(mockRunInitialQfUserSync).toHaveBeenCalledTimes(1);
    expect(view.queryByText(locale.qfSyncFailed)).toBeNull();
    expect(view.queryByText(locale.qfFinishConnection)).toBeNull();
  });
});
