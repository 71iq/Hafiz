import React from "react";
import * as ReactNative from "react-native";
import { I18nManager } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { isSocialAuthEnabled } from "@/lib/auth/config";
import type { AuthCommandResult, AuthOwner } from "@/lib/auth/coordinator";
import { useAuthStore } from "@/lib/auth/store";
import { startAppOAuth, type AppOAuthOutcome } from "@/lib/auth/oauth";
import { isSupabaseConfigured } from "@/lib/supabase";
import { strings } from "@/lib/i18n/strings";
import { QF_OAUTH_PROVIDER } from "@/lib/quran-foundation/user-types";
import type { QfSessionOwner } from "@/lib/quran-foundation/request-owner";
import { isQfLoginEnabled } from "@/lib/quran-foundation/config";
import { runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import type { SQLiteDatabase } from "expo-sqlite";
import { DirectionProvider } from "@/lib/ui/direction";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: jest.fn() }));
jest.mock("@/lib/auth/config", () => ({ isSocialAuthEnabled: jest.fn() }));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/auth/store", () => ({ useAuthStore: { getState: jest.fn() } }));
jest.mock("@/lib/database/provider", () => ({ useDatabaseStatus: () => ({ db: mockDatabase }) }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfLoginEnabled: jest.fn() }));
jest.mock("@/lib/quran-foundation/user-sync", () => ({ runInitialQfUserSync: jest.fn() }));

const databaseOne = {} as SQLiteDatabase;
const databaseTwo = {} as SQLiteDatabase;
let mockDatabase: SQLiteDatabase | null = databaseOne;
const phoneDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };

type OAuthHandle = ReturnType<typeof startAppOAuth>;
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
function makeFlow() {
  const pending = deferred<AuthCommandResult<AppOAuthOutcome>>();
  const handle: OAuthHandle = { isCurrent: jest.fn(() => true), result: pending.promise };
  jest.mocked(startAppOAuth).mockReturnValueOnce(handle);
  return { ...pending, handle };
}
function makeAuthOwner(): AuthOwner {
  return { isCurrent: jest.fn(() => true), cancel: jest.fn() };
}
function makeQfOwner(): QfSessionOwner {
  return {
    isCurrent: jest.fn(() => true),
    requireCurrent: jest.fn(),
    getAccessToken: jest.fn(async () => "synthetic-token"),
  };
}
function completedQfResult(
  qfOwner: QfSessionOwner,
  owner: AuthOwner = makeAuthOwner(),
): AuthCommandResult<AppOAuthOutcome> {
  return {
    status: "completed",
    value: { session: null, qfConnected: true, qfOwner },
    owner,
  };
}
function renderButtons(locale: "en" | "ar", onError = jest.fn()) {
  const screenStrings = strings[locale];
  const rendered = render(<OAuthButtons strings={screenStrings} onError={onError} />, {
    wrapper: ({ children }) => (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: phoneDimensions.width, height: phoneDimensions.height },
          insets: { top: 0, left: 0, bottom: 0, right: 0 },
        }}
      >
        <DirectionProvider dir={locale === "ar" ? "rtl" : "ltr"}>{children}</DirectionProvider>
      </SafeAreaProvider>
    ),
  });
  return { ...rendered, onError, screenStrings };
}
function qfButton(view: ReturnType<typeof renderButtons>) {
  return view.getByText(view.screenStrings.authContinueWithQuranFoundation);
}
function googleDisabled(view: ReturnType<typeof renderButtons>): boolean {
  return Boolean(view.getByLabelText(view.screenStrings.authContinueWithGoogle).props.accessibilityState?.disabled);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDatabase = databaseOne;
  jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue(phoneDimensions);
  jest.replaceProperty(I18nManager, "isRTL", false);
  jest.mocked(isSupabaseConfigured).mockReturnValue(true);
  jest.mocked(isSocialAuthEnabled).mockReturnValue(true);
  jest.mocked(isQfLoginEnabled).mockReturnValue(true);
  jest
    .mocked(useAuthStore.getState)
    .mockReturnValue({ user: null, session: null } as ReturnType<typeof useAuthStore.getState>);
  jest.mocked(runInitialQfUserSync).mockResolvedValue({ status: "synced", pushed: 0, pulled: 0 });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(["en", "ar"] as const)("OAuth button ownership on a %s phone", (locale) => {
  beforeEach(() => {
    jest.replaceProperty(I18nManager, "isRTL", locale === "ar");
  });

  it("admits only one same-tick press before React can update busy state", async () => {
    const flow = makeFlow();
    const view = renderButtons(locale);

    await act(async () => {
      fireEvent.press(qfButton(view));
      fireEvent.press(qfButton(view));
    });

    expect(startAppOAuth).toHaveBeenCalledTimes(1);
    expect(startAppOAuth).toHaveBeenCalledWith(QF_OAUTH_PROVIDER, "sign-in", useAuthStore.getState);
    expect(googleDisabled(view)).toBe(true);

    await act(async () => flow.resolve({ status: "superseded" }));
  });

  it("shows a current auth error after the initiating session is adopted", async () => {
    const flow = makeFlow();
    const view = renderButtons(locale);

    await act(async () => {
      fireEvent.press(qfButton(view));
    });
    await act(async () => flow.reject(new Error("current OAuth failure")));

    expect(view.onError).toHaveBeenCalledWith("current OAuth failure");
    expect(googleDisabled(view)).toBe(false);
  });

  it("suppresses a retired error, releases its own busy state, and admits a retry", async () => {
    const retired = makeFlow();
    const retry = makeFlow();
    const view = renderButtons(locale);

    await act(async () => {
      fireEvent.press(qfButton(view));
    });
    jest.mocked(retired.handle.isCurrent).mockReturnValue(false);
    await act(async () => retired.reject(new Error("retired OAuth failure")));

    expect(view.onError).not.toHaveBeenCalled();
    expect(googleDisabled(view)).toBe(false);

    await act(async () => {
      fireEvent.press(qfButton(view));
    });
    expect(startAppOAuth).toHaveBeenCalledTimes(2);
    await act(async () => retry.resolve({ status: "superseded" }));
  });

  it("passes the exact accepted QF owner to the current initial sync", async () => {
    const flow = makeFlow();
    const qfOwner = makeQfOwner();
    const view = renderButtons(locale);

    await act(async () => {
      fireEvent.press(qfButton(view));
    });
    await act(async () => flow.resolve(completedQfResult(qfOwner)));

    expect(runInitialQfUserSync).toHaveBeenCalledTimes(1);
    expect(runInitialQfUserSync).toHaveBeenCalledWith(databaseOne, qfOwner);
    expect(view.onError).not.toHaveBeenCalled();
  });
});

it("skips QF follow-up for a superseded auth result", async () => {
  const flow = makeFlow();
  const view = renderButtons("en");

  await act(async () => {
    fireEvent.press(qfButton(view));
  });
  await act(async () => flow.resolve({ status: "superseded" }));

  expect(runInitialQfUserSync).not.toHaveBeenCalled();
});

it("skips QF follow-up when the completed auth owner is stale", async () => {
  const flow = makeFlow();
  const qfOwner = makeQfOwner();
  const authOwner = makeAuthOwner();
  jest.mocked(authOwner.isCurrent).mockReturnValue(false);
  const view = renderButtons("ar");

  await act(async () => {
    fireEvent.press(qfButton(view));
  });
  await act(async () => flow.resolve(completedQfResult(qfOwner, authOwner)));

  expect(runInitialQfUserSync).not.toHaveBeenCalled();
});

it("skips QF follow-up when the accepted QF owner is stale", async () => {
  const flow = makeFlow();
  const qfOwner = makeQfOwner();
  jest.mocked(qfOwner.isCurrent).mockReturnValue(false);
  const view = renderButtons("en");

  await act(async () => {
    fireEvent.press(qfButton(view));
  });
  await act(async () => flow.resolve(completedQfResult(qfOwner)));

  expect(runInitialQfUserSync).not.toHaveBeenCalled();
});

it("skips QF follow-up when the button unmounts before the result", async () => {
  const flow = makeFlow();
  const qfOwner = makeQfOwner();
  const view = renderButtons("ar");

  await act(async () => {
    fireEvent.press(qfButton(view));
  });
  view.unmount();
  await act(async () => flow.resolve(completedQfResult(qfOwner)));

  expect(runInitialQfUserSync).not.toHaveBeenCalled();
});

it("skips QF follow-up across committed database A-B-A during OAuth", async () => {
  const flow = makeFlow();
  const qfOwner = makeQfOwner();
  const view = renderButtons("en");

  await act(async () => {
    fireEvent.press(qfButton(view));
  });
  mockDatabase = databaseTwo;
  await act(async () => view.rerender(<OAuthButtons strings={strings.en} onError={view.onError} />));
  mockDatabase = databaseOne;
  await act(async () => view.rerender(<OAuthButtons strings={strings.en} onError={view.onError} />));
  await act(async () => flow.resolve(completedQfResult(qfOwner)));

  expect(runInitialQfUserSync).not.toHaveBeenCalled();
});
