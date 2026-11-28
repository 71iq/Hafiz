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
import * as WebBrowser from "expo-web-browser";

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
const mockPush = jest.fn((...args: unknown[]): unknown => mockUnexpected(...args));
const mockBeginQfOAuthConnection = jest.fn(async (...args: unknown[]): Promise<unknown> => mockUnexpected(...args));
const mockDisconnectQfUser = jest.fn(async (...args: unknown[]): Promise<unknown> => mockUnexpected(...args));
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
type SettingsParams = { category?: string; section?: string; qf?: string; qf_error?: string };
let mockParams: SettingsParams = { category: "account" };
const mockSetParams = jest.fn((patch: SettingsParams) => {
  mockParams = { ...mockParams, ...patch };
});
const mockReplace = jest.fn(({ pathname, params }: { pathname: string; params: SettingsParams }) => {
  if (pathname !== "/settings") return mockUnexpected(pathname);
  mockParams = params;
});
const mockRouter = { push: mockPush, setParams: mockSetParams, replace: mockReplace };
const mockSettings: Partial<ReturnType<typeof useSettings>> = {};
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDatabase }));
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), ...mockSettings }) };
});
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
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
  beginQfOAuthConnection: (...args: unknown[]) => mockBeginQfOAuthConnection(...args),
  disconnectQfUser: (...args: unknown[]) => mockDisconnectQfUser(...args),
  getQfConnectionStatus: jest.fn(),
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
// The account sync card has its own tests; here only the dormant QF card's controls are queried.
jest.mock("@/components/settings/AccountSyncCard", () => ({ AccountSyncCard: () => null, lastSyncedLabel: () => "" }));
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
  jest.mocked(getQfConnectionStatus).mockReset().mockResolvedValue({ ok: true, status: "connected" });
  mockDatabase.getFirstAsync.mockResolvedValue(null);
  mockDatabase.getAllAsync.mockResolvedValue([]);
  mockDatabase.runAsync.mockImplementation(() => {
    throw new Error("Database write forbidden in QF settings fixture");
  });
  if (typeof globalThis.fetch === "function") {
    jest.spyOn(globalThis, "fetch").mockImplementation(() => mockUnexpected("fetch") as never);
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
    const manualSync = await view.findByRole("button", { name: strings[language].qfManualSync });

    await act(async () => {
      fireEvent.press(manualSync);
    });

    expect(mockFullQfUserSync).toHaveBeenCalledTimes(1);
    expect(mockFullQfUserSync).toHaveBeenCalledWith(mockDatabase);
    expect(mockRunInitialQfUserSync).not.toHaveBeenCalled();
    expectMessageOutcome(view, language, status);
  });
});

it("keeps the named sync and disconnect buttons disabled until manual sync finishes", async () => {
  configure("en");
  let finish!: (result: QfSyncResult) => void;
  mockFullQfUserSync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = await openSettings();
  const sync = view.getByRole("button", { name: strings.en.qfManualSync });
  fireEvent.press(sync);
  expect(sync).toBeDisabled();
  expect(view.getByRole("button", { name: strings.en.qfDisconnect })).toBeDisabled();
  fireEvent.press(sync);
  expect(mockFullQfUserSync).toHaveBeenCalledTimes(1);

  await act(async () => finish(mockManualResult));
  expect(sync).toBeEnabled();
  expect(view.getByRole("button", { name: strings.en.qfDisconnect })).toBeEnabled();
});

describe.each(["en", "ar"] as const)("QF disconnect in %s", (language) => {
  it.each(["needs_reauth", "offline"] as const)(
    "reconciles a refusal when the status read reports %s",
    async (status) => {
      configure(language);
      const locale = strings[language];
      let answer!: (value: unknown) => void;
      mockDisconnectQfUser.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      const view = await openSettings();
      fireEvent.press(await view.findByLabelText(locale.qfDisconnect));
      expect(view.getAllByText(locale.qfDisconnected).length).toBeGreaterThan(0);
      expect(view.queryByText(locale.qfManualSync)).toBeNull();
      jest
        .mocked(getQfConnectionStatus)
        .mockResolvedValueOnce(
          status === "offline"
            ? { ok: false, code: "upstream", message: "Synthetic offline failure" }
            : { ok: true, status },
        );

      await act(async () => answer({ ok: false, code: "forbidden", message: "Synthetic refusal" }));

      expect(getQfConnectionStatus).toHaveBeenCalledTimes(2);
      expect(view.getByText(locale.qfDisconnectFailed)).toBeTruthy();
      expect(view.getByText(status === "offline" ? locale.qfConnected : locale.qfNeedsReauth)).toBeTruthy();
      expect(
        view.getByRole("button", { name: status === "offline" ? locale.qfManualSync : locale.qfReconnect }),
      ).toBeEnabled();
    },
  );

  it("ignores a refused disconnect's late status after switching accounts", async () => {
    configure(language);
    const locale = strings[language];
    const view = await openSettings();
    mockDisconnectQfUser.mockResolvedValueOnce({ ok: false, code: "forbidden", message: "Synthetic refusal" });
    let finish!: (status: Awaited<ReturnType<typeof getQfConnectionStatus>>) => void;
    jest.mocked(getQfConnectionStatus).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText(locale.qfDisconnect));
    });
    expect(getQfConnectionStatus).toHaveBeenCalledTimes(2);

    mockCurrentUser = mockOtherUser;
    jest.mocked(getQfConnectionStatus).mockResolvedValueOnce({ ok: true, status: "disconnected" });
    jest.mocked(getQfLinkedIdentityState).mockResolvedValueOnce({ linked: false });
    view.rerender(<SettingsScreen />);
    await act(async () => finish({ ok: true, status: "needs_reauth" }));

    expect(view.getByText(locale.qfConnect)).toBeTruthy();
    expect(view.queryByText(locale.qfDisconnectFailed)).toBeNull();
    expect(view.queryByText(locale.qfReconnect)).toBeNull();
  });
});

it("consumes a callback error once in Account and does not replay it on refresh", async () => {
  configure("en");
  mockParams = { qf_error: "Synthetic denial" };
  const view = await openSettings();
  expect(mockReplace).toHaveBeenCalledTimes(1);
  expect(mockParams).toStrictEqual({ category: "account" });
  view.rerender(<SettingsScreen />);
  expect(view.getByText("Synthetic denial")).toBeTruthy();

  fireEvent.press(view.getByText(strings.en.settingsCategoryGeneral));
  view.rerender(<SettingsScreen />);
  fireEvent.press(view.getByText(strings.en.settingsCategoryAccount));
  view.unmount();
  const refreshed = await openSettings();
  expect(refreshed.queryByText("Synthetic denial")).toBeNull();
  expect(mockRunInitialQfUserSync).not.toHaveBeenCalled();
});

it("finishes the initial sync after the callback params have been consumed", async () => {
  configure("en", "connected");
  let finish!: (result: QfSyncResult) => void;
  mockRunInitialQfUserSync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = await openSettings();
  expect(mockParams).toStrictEqual({ category: "account" });
  view.rerender(<SettingsScreen />);
  await act(async () => finish(mockCallbackResult));
  expect(view.getByText(strings.en.qfSyncComplete)).toBeTruthy();
  expect(mockRunInitialQfUserSync).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledTimes(1);
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

describe.each(["en", "ar"] as const)("native QF connect in %s", (language) => {
  const redirectUri = "https://hafizquran.app/auth/qf-app-callback";
  const authorizationUrl = "https://oauth.example.invalid/authorize?client=synthetic";

  async function pressConnect(result: WebBrowser.WebBrowserAuthSessionResult) {
    configure(language);
    jest.mocked(getQfConnectionStatus).mockResolvedValueOnce({ ok: true, status: "disconnected" });
    jest.mocked(getQfLinkedIdentityState).mockResolvedValueOnce({ linked: false } as never);
    mockBeginQfOAuthConnection.mockResolvedValueOnce({
      ok: true,
      authorizationUrl,
      expiresAt: "2026-01-01T00:10:00.000Z",
    });
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce(result);
    const view = await openSettings();
    await act(async () => {
      fireEvent.press(await view.findByRole("button", { name: strings[language].qfConnect }));
    });
    expect(mockBeginQfOAuthConnection).toHaveBeenCalledWith(redirectUri, "/settings");
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(authorizationUrl, redirectUri);
    return view;
  }

  it("routes the App Link's result to the callback route once", async () => {
    mockPush.mockImplementationOnce(() => undefined);
    await pressConnect({ type: "success", url: `${redirectUri}?code=synthetic-code&state=synthetic%3Dstate` });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/auth/qf-callback",
      params: { code: "synthetic-code", state: "synthetic=state" },
    });
  });

  it("clears the pending state without an error when the browser is closed", async () => {
    const locale = strings[language];
    const view = await pressConnect({ type: "cancel" as WebBrowser.WebBrowserResultType });

    expect(mockPush).not.toHaveBeenCalled();
    expect(view.queryByText(locale.qfConnectionStarted)).toBeNull();
    expect(view.queryByText(locale.qfConnectionFailed)).toBeNull();
    expect(view.getByText(locale.qfConnect)).toBeTruthy();
  });
});
