import React, { type ReactNode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import type { Session } from "@supabase/supabase-js";
import OAuthCallbackScreen from "@/app/auth/callback";
import { captureAuthReturn, resetAuthReturnForTests } from "@/lib/auth/return-origin";
import { strings } from "@/lib/i18n/strings";

type MockAuthState = { isInitialized: boolean; session: Session | null };
let mockAuthState: MockAuthState = { isInitialized: false, session: null };
let mockParams: Record<string, string> = {};
const mockRouter = { replace: jest.fn(), dismissTo: jest.fn(), push: jest.fn(), navigate: jest.fn() };
const mockNavigation = { getState: () => ({ index: 0, routes: [{ name: "auth/callback" }] }) };

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useNavigation: () => mockNavigation,
  useGlobalSearchParams: () => mockParams,
  get router() {
    return mockRouter;
  },
}));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: (select: (state: MockAuthState) => unknown) => select(mockAuthState),
}));
jest.mock("@/lib/i18n/startup-language", () => ({ getStartupLanguage: () => "en" }));
jest.mock("@/components/auth/AuthScreenShell", () => {
  const { View, Text, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AuthScreenShell: ({ title, children }: { title: string; children: ReactNode }) => (
      <View>
        <Text>{title}</Text>
        {children}
      </View>
    ),
    AuthFormNotice: ({ message }: { message: string | null }) => <Text>{message}</Text>,
    AuthTextLink: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
    useAuthIconColors: () => ({ muted: "#52525b", accent: "#0d9488", error: "#dc2626", theme: "white" }),
  };
});

const USER_ID = "00000000-0000-4000-8000-000000000001";
function verifiedSession(): Session {
  return {
    user: { id: USER_ID, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" },
    access_token: [
      "e30",
      Buffer.from(JSON.stringify({ sub: USER_ID, session_id: "10000000-0000-4000-8000-000000000001" })).toString(
        "base64url",
      ),
      "c2ln",
    ].join("."),
    refresh_token: "synthetic-refresh",
    token_type: "bearer",
    expires_in: 3600,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetAuthReturnForTests();
  mockParams = {};
  mockAuthState = { isInitialized: false, session: null };
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it("waits for a verified session, not redirect parameters, before leaving", () => {
  mockParams = { access_token: "not-verified", refresh_token: "not-verified" };
  mockAuthState = { isInitialized: true, session: null };
  const view = render(<OAuthCallbackScreen />);
  expect(view.getAllByText(strings.en.authCallbackSigningIn).length).toBeGreaterThan(0);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.dismissTo).not.toHaveBeenCalled();
});

it("returns to the captured context once the session is verified", () => {
  captureAuthReturn({ route: "progress" });
  mockAuthState = { isInitialized: true, session: verifiedSession() };
  render(<OAuthCallbackScreen />);
  expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/progress");
  expect(mockRouter.replace).toHaveBeenCalledTimes(1);
});

it("explains a missing session and links back to Login", () => {
  mockAuthState = { isInitialized: true, session: null };
  const view = render(<OAuthCallbackScreen />);
  act(() => {
    jest.advanceTimersByTime(10_000);
  });
  expect(view.getByText(strings.en.authCallbackFailed)).toBeTruthy();
  fireEvent.press(view.getByText(strings.en.authBackToLogin));
  expect(mockRouter.replace).toHaveBeenCalledWith("/auth/login");
});

it("shows the failure at once when the provider returned an error", () => {
  mockParams = { error: "access_denied" };
  mockAuthState = { isInitialized: true, session: null };
  const view = render(<OAuthCallbackScreen />);
  expect(view.getByText(strings.en.authCallbackFailed)).toBeTruthy();
  expect(view.queryByText("access_denied")).toBeNull();
});
