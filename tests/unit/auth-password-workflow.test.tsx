import { authCommands } from "@/lib/auth/commands";
import type { AuthOwner } from "@/lib/auth/coordinator";
import React from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { act, fireEvent, render as renderTree, waitFor } from "@testing-library/react-native";
import type { Control } from "react-hook-form";
import { useAuthStore } from "@/lib/auth/store";
import { PasswordRecoveryProvider, usePasswordRecovery } from "@/lib/auth/password-recovery";
import ResetPasswordScreen from "@/app/auth/reset-password";
import { strings } from "@/lib/i18n/strings";

type Response = { data: { user: User }; error: Error | null };
const mockGetSession = jest.fn(async () => ({
  data: { session: useAuthStore.getState().session ?? session("a") },
  error: null,
}));
const mockSetSession = jest.fn<
  Promise<{ data: { session: Session | null }; error: Error | null }>,
  [{ access_token: string; refresh_token: string }]
>();
const mockUpdateUser = jest.fn<Promise<Response>, [{ password: string }]>();
const mockReplace = jest.fn();
let mockPathname = "/auth/reset-password";
let mockParams: Record<string, string> = {};
const mockBeforeRemove = new Set<() => void>();
const mockNavigation = {
  addListener: jest.fn((_name: string, callback: () => void) => {
    mockBeforeRemove.add(callback);
    return () => {
      mockBeforeRemove.delete(callback);
    };
  }),
};
const mockSetParams = jest.fn();
const mockRouter = { replace: mockReplace, setParams: mockSetParams, back: jest.fn() };
let mockLocale: "en" | "ar" = "en";
let mockSignOutPromise: Promise<{ error: Error | null }> | null = null;
let mockSignOutChangesOwner = true;
const mockSignOut = jest.fn(async () => {
  if (mockSignOutChangesOwner) useAuthStore.setState({ user: null, session: null, profile: null });
  return mockSignOutPromise ?? { error: null };
});
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  readOwnedSession: () => mockGetSession(),
  restoreOwnedSession: (_owner: unknown, _session: unknown, tokens: { access_token: string; refresh_token: string }) =>
    mockSetSession(tokens),
  updateOwnedPassword: (_owner: unknown, _session: unknown, password: string) => mockUpdateUser({ password }),
  signOutOwnedSession: (owner: AuthOwner) => {
    if (mockSignOutChangesOwner) owner.adoptOwnSignOut?.();
    return mockSignOut();
  },
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      setSession: (tokens: { access_token: string; refresh_token: string }) => mockSetSession(tokens),
      updateUser: (value: { password: string }) => mockUpdateUser(value),
      signOut: () => mockSignOut(),
    },
  },
}));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/auth/config", () => ({ isEmailAuthFlowsEnabled: () => true }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));
jest.mock("expo-router", () => ({
  Redirect: () => null,
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
  useGlobalSearchParams: () => mockParams,
  useNavigation: () => mockNavigation,
}));
jest.mock("@/lib/i18n/startup-language", () => ({ getStartupLanguage: () => mockLocale }));
jest.mock("lucide-react-native", () => ({ Eye: () => null, EyeOff: () => null, Lock: () => null }));
jest.mock("@/components/auth/AuthScreenShell", () => {
  const { View, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AuthScreenShell: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    AuthFormNotice: ({ message }: { message: string | null }) => <Text testID="notice">{message}</Text>,
    AuthUnavailableState: () => null,
  };
});
jest.mock("@/components/ui/Button", () => {
  const { Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Button: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled: boolean }) => (
      <Pressable testID="submit" disabled={disabled} onPress={onPress}>
        {children}
      </Pressable>
    ),
  };
});
jest.mock("@/components/ui/FormTextField", () => {
  const { Controller } = jest.requireActual<typeof import("react-hook-form")>("react-hook-form");
  const { TextInput } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    FormTextField: ({
      control,
      name,
      label,
    }: {
      control: Control<{ password: string; confirmPassword: string }>;
      name: "password" | "confirmPassword";
      label: string;
    }) => (
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <TextInput accessibilityLabel={label} value={field.value} onChangeText={field.onChange} />
        )}
      />
    ),
  };
});
const userId = (id: string) =>
  id === "a" ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002";
const user = (id: string): User => ({
  id: userId(id),
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01",
});
let sessionSequence = 0;
const session = (id: string): Session => ({
  user: user(id),
  access_token: [
    "e30",
    Buffer.from(
      JSON.stringify({
        sub: userId(id),
        session_id: `10000000-0000-4000-8000-${String(++sessionSequence).padStart(12, "0")}`,
      }),
    ).toString("base64url"),
    "c2ln",
  ].join("."),
  refresh_token: `synthetic-refresh-${id}`,
  token_type: "bearer",
  expires_in: 3600,
});

function activate(value: Session | null) {
  useAuthStore.setState({ user: value?.user ?? null, session: value, profile: null });
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Uninitialized response");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Uninitialized rejection");
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const transitions = ["switch", "signout", "same-id-login", "away-and-back", "same-id-session"];
function changeOwner(kind: string, original: Session) {
  if (kind === "switch") activate(session("b"));
  else if (kind === "signout") activate(null);
  else if (kind === "same-id-session") activate(session("a"));
  else {
    activate(kind === "same-id-login" ? null : session("b"));
    activate(original);
  }
}
function finish(pending: ReturnType<typeof deferred<Response>>, outcome: string) {
  if (outcome === "rejection") pending.reject(new Error("old-rejection"));
  else pending.resolve({ data: { user: user("a") }, error: outcome === "error" ? new Error("old-error") : null });
}
function render(element: React.ReactElement) {
  return renderTree(<PasswordRecoveryProvider>{element}</PasswordRecoveryProvider>);
}
beforeEach(() => {
  mockPathname = "/auth/reset-password";
  mockBeforeRemove.clear();
  mockParams = {};
  mockSetParams.mockClear();
  mockLocale = "en";
  activate(null);
  useAuthStore.setState({ isLoading: false, isInitialized: true, error: null });
  mockGetSession.mockClear();
  mockUpdateUser.mockReset();
  mockSetSession.mockReset();
  mockSignOut.mockClear();
  mockReplace.mockClear();
  mockSignOutPromise = null;
  mockSignOutChangesOwner = true;
  jest.replaceProperty(Platform, "OS", "android");
});
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  activate(null);
  jest.restoreAllMocks();
});

it.each(transitions.flatMap((kind) => ["success", "error", "rejection"].map((outcome) => ({ kind, outcome }))))(
  "ignores obsolete password $outcome after $kind",
  async ({ kind, outcome }) => {
    const original = session("a");
    activate(original);
    const pending = deferred<Response>();
    mockUpdateUser.mockReturnValue(pending.promise);
    const work = useAuthStore.getState().updatePassword("synthetic-password");
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
    changeOwner(kind, original);
    const expectedUser = useAuthStore.getState().user;
    useAuthStore.setState({ isLoading: true, error: "current-owner-status" });
    finish(pending, outcome);
    const result = await work;
    expect(useAuthStore.getState().user).toBe(expectedUser);
    expect(useAuthStore.getState()).toMatchObject({ isLoading: true, error: "current-owner-status" });
    expect(result).toEqual({ status: "superseded" });
  },
);

it("preserves current identified password success", async () => {
  activate(session("a"));
  mockUpdateUser.mockResolvedValue({ data: { user: user("a") }, error: null });
  const result = await useAuthStore.getState().updatePassword("synthetic-password");
  expect(result.status).toBe("completed");
  if (result.status === "completed") {
    expect(result.owner.isCurrent()).toBe(true);
    activate(session("b"));
    expect(result.owner.isCurrent()).toBe(false);
  }
  expect(mockUpdateUser).toHaveBeenCalledWith({ password: "synthetic-password" });
});
it("anonymous low-level password calls wait for explicit recovery instead of issuing a write", async () => {
  expect(await useAuthStore.getState().updatePassword("synthetic-password")).toEqual({ status: "superseded" });
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

it.each(["error", "rejection"])("preserves active password %s identity and status", async (outcome) => {
  activate(session("a"));
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  const work = useAuthStore.getState().updatePassword("synthetic-password");
  const error = new Error("active-error");
  if (outcome === "error") pending.resolve({ data: { user: user("a") }, error });
  else pending.reject(error);
  await expect(work).rejects.toBe(error);
  expect(useAuthStore.getState()).toMatchObject({ user: user("a"), isLoading: false, error: "active-error" });
});

async function submit() {
  const screen = render(<ResetPasswordScreen />);
  fireEvent.changeText(screen.getByLabelText(strings.en.authNewPassword), "synthetic-password");
  fireEvent.changeText(screen.getByLabelText(strings.en.authConfirmPassword), "synthetic-password");
  await waitFor(() => expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByTestId("submit"));
  await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
  return screen;
}

it.each(transitions)(
  "actual reset route does not sign out or navigate after %s during password update",
  async (kind) => {
    const original = session("a");
    activate(original);
    const pending = deferred<Response>();
    mockUpdateUser.mockReturnValue(pending.promise);
    const screen = await submit();
    await act(async () => {
      changeOwner(kind, original);
      pending.resolve({ data: { user: user("a") }, error: null });
    });
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText(strings.en.authPasswordUpdated)).toBeNull();
  },
);

it("actual reset route suppresses old error notice after owner switch", async () => {
  activate(session("a"));
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  const screen = await submit();
  await act(async () => {
    activate(session("b"));
    pending.reject(new Error("old-route-error"));
  });
  expect(screen.queryByText("old-route-error")).toBeNull();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it.each([false, true])("actual reset route completes current recovery, anonymous=%s", async (anonymous) => {
  if (!anonymous) activate(session("a"));
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  const screen = await submit();
  await act(async () => {
    pending.resolve({ data: { user: user("a") }, error: null });
  });
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/auth/login"));
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(screen.getByText(strings.en.authPasswordUpdated)).toBeTruthy();
});

it.each(["b", "a"])("does not navigate for newly signed-in %s after an already-issued signout", async (id) => {
  activate(session("a"));
  const password = deferred<Response>();
  mockUpdateUser.mockReturnValue(password.promise);
  const signout = deferred<{ error: null }>();
  mockSignOutPromise = signout.promise;
  await submit();
  await act(async () => {
    password.resolve({ data: { user: user("a") }, error: null });
  });
  await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  await act(async () => {
    activate(session(id));
    signout.resolve({ error: null });
  });
  expect(mockReplace).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user?.id).toBe(userId(id));
});

it("actual reset route retains active errors without signing out", async () => {
  activate(session("a"));
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  const screen = await submit();
  await act(async () => {
    pending.reject(new Error("active-route-error"));
  });
  expect(screen.getByText("active-route-error")).toBeTruthy();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it("checks ownership again between the store commit and route continuation", async () => {
  activate(session("a"));
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  await submit();
  const returned = user("a");
  let scheduled = false;
  const unsubscribe = useAuthStore.subscribe((state) => {
    if (state.user === returned && !scheduled) {
      scheduled = true;
      Promise.resolve().then(() => activate(session("b")));
    }
  });
  try {
    await act(async () => {
      pending.resolve({ data: { user: returned }, error: null });
    });
    expect(scheduled).toBe(true);
    expect(useAuthStore.getState().user?.id).toBe(userId("b"));
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});

it("retains successful navigation when signout emits no auth callback", async () => {
  activate(session("a"));
  mockSignOutChangesOwner = false;
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  await submit();
  await act(async () => {
    pending.resolve({ data: { user: user("a") }, error: null });
  });
  expect(mockReplace).toHaveBeenCalledWith("/auth/login");
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});

it("retains active signout error notice", async () => {
  activate(session("a"));
  mockSignOutChangesOwner = false;
  const password = deferred<Response>();
  mockUpdateUser.mockReturnValue(password.promise);
  const signout = deferred<{ error: null }>();
  mockSignOutPromise = signout.promise;
  const screen = await submit();
  await act(async () => {
    password.resolve({ data: { user: user("a") }, error: null });
  });
  await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  await act(async () => {
    signout.reject(new Error("active-signout-error"));
  });
  expect(screen.getByText("active-signout-error")).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
});

it.each(["success", "rejection"])("unmounted recovery screen cannot finish old password %s", async (outcome) => {
  const original = session("a");
  activate(original);
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  const screen = await submit();
  screen.unmount();
  await act(async () => {
    if (outcome === "rejection") pending.reject(new Error("unmounted-password-error"));
    else pending.resolve({ data: { user: user("a") }, error: null });
  });
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user).toBe(original.user);
  expect(useAuthStore.getState().error).toBeNull();
});
it("overlapping valid form submissions dispatch exactly one password command", async () => {
  activate(session("a"));
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  const screen = render(<ResetPasswordScreen />);
  fireEvent.changeText(screen.getByLabelText(strings.en.authNewPassword), "synthetic-password");
  fireEvent.changeText(screen.getByLabelText(strings.en.authConfirmPassword), "synthetic-password");
  await waitFor(() => expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(false));
  await act(async () => {
    fireEvent.press(screen.getByTestId("submit"));
    fireEvent.press(screen.getByTestId("submit"));
  });
  await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
  await act(async () => {
    pending.resolve({ data: { user: user("a") }, error: null });
  });
  expect(mockUpdateUser).toHaveBeenCalledTimes(1);
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledTimes(1);
});

function webHash(hash: string) {
  mockParams = { "#": hash.slice(1) };
  jest.replaceProperty(Platform, "OS", "web");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      location: { hash, pathname: "/auth/reset-password", search: "?source=synthetic" },
      history: {
        state: { synthetic: "state" },
        replaceState: jest.fn(() => {
          window.location.hash = "";
        }),
      },
    },
  });
}
it("web recovery missing tokens stays disabled without an SDK write", async () => {
  webHash("");
  const screen = render(<ResetPasswordScreen />);
  expect(screen.getByText(strings.en.authResetLinkInvalid)).toBeTruthy();
  expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(true);
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(mockUpdateUser).not.toHaveBeenCalled();
});
it.each([
  "#access_token=synthetic-access",
  "#refresh_token=synthetic-refresh",
  "#access_token=synthetic-access&refresh_token=",
  "#access_token=&refresh_token=synthetic-refresh",
])("invalid partial web recovery clears both URL states without SDK calls: %s", async (hash) => {
  webHash(hash);
  const screen = render(<ResetPasswordScreen />);
  expect(screen.getByText(strings.en.authResetLinkInvalid)).toBeTruthy();
  expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(true);
  expect(window.history.replaceState).toHaveBeenCalledWith(
    { synthetic: "state" },
    "",
    "/auth/reset-password?source=synthetic",
  );
  expect(window.location.hash).toBe("");
  expect(mockSetParams).toHaveBeenCalledWith({ "#": "" });
  expect(window.location.search).toBe("?source=synthetic");
  expect(mockGetSession).not.toHaveBeenCalled();
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});
it.each(["packet", "rejection"])("web recovery displays current SDK %s failure", async (outcome) => {
  webHash("#access_token=synthetic-access&refresh_token=synthetic-refresh");
  const error = new Error("current-recovery-error");
  if (outcome === "packet") mockSetSession.mockResolvedValue({ data: { session: null }, error });
  else mockSetSession.mockRejectedValue(error);
  const screen = render(<ResetPasswordScreen />);
  await waitFor(() => expect(screen.getByText(error.message)).toBeTruthy());
  expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(true);
  expect(mockUpdateUser).not.toHaveBeenCalled();
});
it("web recovery forwards URL tokens and completes a current reset", async () => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  mockSetSession.mockResolvedValue({ data: { session: a }, error: null });
  mockUpdateUser.mockResolvedValue({ data: { user: user("a") }, error: null });
  const screen = await submit();
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/auth/login"));
  expect(mockSetSession).toHaveBeenCalledWith({ access_token: a.access_token, refresh_token: a.refresh_token });
  expect(screen.getByText(strings.en.authPasswordUpdated)).toBeTruthy();
});
it.each(["success", "rejection"])("unmounted web recovery suppresses late %s route continuation", async (outcome) => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  const pending = deferred<{ data: { session: Session | null }; error: Error | null }>();
  mockSetSession.mockReturnValue(pending.promise);
  const screen = render(<ResetPasswordScreen />);
  await waitFor(() => expect(mockSetSession).toHaveBeenCalledTimes(1));
  screen.unmount();
  await act(async () => {
    if (outcome === "rejection") pending.reject(new Error("unmounted-recovery-error"));
    else pending.resolve({ data: { session: a }, error: null });
  });
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});
it("later explicit auth intent keeps pending web recovery unready", async () => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  const pending = deferred<{ data: { session: Session | null }; error: Error | null }>();
  mockSetSession.mockReturnValue(pending.promise);
  const screen = render(<ResetPasswordScreen />);
  await waitFor(() => expect(mockSetSession).toHaveBeenCalledTimes(1));
  const later = authCommands.transition(async () => undefined);
  await act(async () => {
    pending.resolve({ data: { session: a }, error: null });
    await later;
  });
  expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(true);
  expect(mockUpdateUser).not.toHaveBeenCalled();
});
it("external replacement keeps pending web recovery from restoring the old owner", async () => {
  const a = session("a");
  activate(a);
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  const pending = deferred<{ data: { session: Session | null }; error: Error | null }>();
  mockSetSession.mockReturnValue(pending.promise);
  const screen = render(<ResetPasswordScreen />);
  await waitFor(() => expect(mockSetSession).toHaveBeenCalledTimes(1));
  const b = session("b");
  await act(async () => {
    activate(b);
    pending.resolve({ data: { session: a }, error: null });
  });
  expect({
    token: useAuthStore.getState().session?.access_token,
    disabled: screen.getByTestId("submit").props.accessibilityState.disabled,
  }).toEqual({ token: b.access_token, disabled: true });
});

it("SDK signout error packet keeps the current reset route on its error state", async () => {
  activate(session("a"));
  mockSignOutChangesOwner = false;
  const error = new Error("current-signout-packet-error");
  mockUpdateUser.mockResolvedValue({ data: { user: user("a") }, error: null });
  mockSignOutPromise = Promise.resolve({ error });
  const screen = await submit();
  await waitFor(() => expect(screen.getByText(error.message)).toBeTruthy());
  expect(mockReplace).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user?.id).toBe(userId("a"));
});

it("unmounted queued web recovery never dispatches its SDK command", async () => {
  const held = deferred<void>();
  const blocker = authCommands.transition(() => held.promise);
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  mockSetSession.mockResolvedValue({ data: { session: a }, error: null });
  const screen = render(<ResetPasswordScreen />);
  screen.unmount();
  await act(async () => {
    held.resolve();
    await blocker;
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it.each(["en", "ar"] as const)("unsupported web recovery uses the %s message and stays disabled", async (locale) => {
  mockLocale = locale;
  webHash("#access_token=synthetic-access&refresh_token=synthetic-refresh");
  const error = Object.assign(new Error("Auth storage ownership is unavailable"), {
    code: "auth_storage_lock_unavailable",
  });
  mockSetSession.mockRejectedValue(error);
  const screen = render(<ResetPasswordScreen />);
  await waitFor(() => expect(screen.getByText(strings[locale].authResetBrowserUnsupported)).toBeTruthy());
  expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(true);
  expect(mockReplace).not.toHaveBeenCalled();
});

it("web recovery removes URL tokens before the pending session command and preserves route history state", async () => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  const pending = deferred<{ data: { session: Session | null }; error: Error | null }>();
  mockSetSession.mockReturnValue(pending.promise);
  const screen = render(<ResetPasswordScreen />);
  await waitFor(() => expect(mockSetSession).toHaveBeenCalledTimes(1));
  expect(window.history.replaceState).toHaveBeenCalledWith(
    { synthetic: "state" },
    "",
    "/auth/reset-password?source=synthetic",
  );
  expect(window.location.hash).toBe("");
  expect(mockSetParams).toHaveBeenCalledWith({ "#": "" });
  screen.unmount();
  await act(async () => {
    pending.resolve({ data: { session: a }, error: null });
  });
});

it("internal child replacement retains pending web recovery after URL cleanup", async () => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  const pending = deferred<{ data: { session: Session | null }; error: Error | null }>();
  mockSetSession.mockReturnValue(pending.promise);
  const screen = renderTree(
    <PasswordRecoveryProvider>
      <ResetPasswordScreen key="before" />
    </PasswordRecoveryProvider>,
  );
  await waitFor(() => expect(mockSetSession).toHaveBeenCalledTimes(1));
  expect(window.location.hash).toBe("");
  screen.rerender(
    <PasswordRecoveryProvider>
      <ResetPasswordScreen key="after" />
    </PasswordRecoveryProvider>,
  );
  await act(async () => {
    pending.resolve({ data: { session: a }, error: null });
  });
  await waitFor(() => expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(false));
  expect(mockSetSession).toHaveBeenCalledTimes(1);
});
it("internal child replacement keeps one issued password request busy", async () => {
  activate(session("a"));
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  const screen = renderTree(
    <PasswordRecoveryProvider>
      <ResetPasswordScreen key="before" />
    </PasswordRecoveryProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(false));
  fireEvent.changeText(screen.getByLabelText(strings.en.authNewPassword), "synthetic-password");
  fireEvent.changeText(screen.getByLabelText(strings.en.authConfirmPassword), "synthetic-password");
  fireEvent.press(screen.getByTestId("submit"));
  await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
  screen.rerender(
    <PasswordRecoveryProvider>
      <ResetPasswordScreen key="after" />
    </PasswordRecoveryProvider>,
  );
  expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByTestId("submit"));
  expect(mockUpdateUser).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve({ data: { user: user("a") }, error: null });
  });
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/auth/login"));
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});
it("genuine navigation beforeRemove revokes an issued password operation on the same pathname", async () => {
  activate(session("a"));
  const pending = deferred<Response>();
  mockUpdateUser.mockReturnValue(pending.promise);
  await submit();
  act(() => {
    for (const callback of mockBeforeRemove) callback();
  });
  await act(async () => {
    pending.resolve({ data: { user: user("a") }, error: null });
  });
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});
it("pathname exit with provider mounted suppresses pending recovery completion", async () => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  const pending = deferred<{ data: { session: Session | null }; error: Error | null }>();
  mockSetSession.mockReturnValue(pending.promise);
  const screen = render(<ResetPasswordScreen />);
  await waitFor(() => expect(mockSetSession).toHaveBeenCalledTimes(1));
  mockPathname = "/auth/login";
  screen.rerender(
    <PasswordRecoveryProvider>
      <ResetPasswordScreen />
    </PasswordRecoveryProvider>,
  );
  await act(async () => {
    pending.resolve({ data: { session: a }, error: null });
  });
  expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(true);
  expect(mockUpdateUser).not.toHaveBeenCalled();
});
it("captured web tokens wait for auth initialization despite URL cleanup", async () => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  useAuthStore.setState({ isInitialized: false });
  mockSetSession.mockResolvedValue({ data: { session: a }, error: null });
  const screen = render(<ResetPasswordScreen />);
  expect(window.location.hash).toBe("");
  expect(mockSetSession).not.toHaveBeenCalled();
  await act(async () => {
    useAuthStore.setState({ isInitialized: true });
  });
  await waitFor(() => expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(false));
  expect(mockSetSession).toHaveBeenCalledWith({ access_token: a.access_token, refresh_token: a.refresh_token });
});

async function prepareTwoRecoveryOwners() {
  type Captured = {
    user: string | undefined;
    submit: ReturnType<typeof usePasswordRecovery>["submit"];
    leave: ReturnType<typeof usePasswordRecovery>["leave"];
  };
  const captures: Captured[] = [];
  function Capture() {
    const recovery = usePasswordRecovery();
    if (recovery.state.kind === "ready")
      captures.push({ user: useAuthStore.getState().user?.id, submit: recovery.submit, leave: recovery.leave });
    return null;
  }
  activate(session("a"));
  const screen = renderTree(
    <PasswordRecoveryProvider>
      <Capture />
    </PasswordRecoveryProvider>,
  );
  await waitFor(() => expect(captures.some((value) => value.user === user("a").id)).toBe(true));
  const old = captures.find((value) => value.user === user("a").id);
  if (!old) throw new Error("Missing first recovery");
  mockPathname = "/auth/login";
  screen.rerender(
    <PasswordRecoveryProvider>
      <Capture />
    </PasswordRecoveryProvider>,
  );
  activate(session("b"));
  mockPathname = "/auth/reset-password";
  screen.rerender(
    <PasswordRecoveryProvider>
      <Capture />
    </PasswordRecoveryProvider>,
  );
  await waitFor(() => expect(captures.some((value) => value.user === user("b").id)).toBe(true));
  const current = captures.find((value) => value.user === user("b").id);
  if (!current) throw new Error("Missing second recovery");
  return { old, current };
}
it("captured old recovery submission cannot target a later recovery", async () => {
  const { old } = await prepareTwoRecoveryOwners();
  await act(async () => {
    await old.submit("old-form-password");
  });
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user?.id).toBe(user("b").id);
});
it("captured old recovery leave cannot cancel a later recovery", async () => {
  const { old, current } = await prepareTwoRecoveryOwners();
  act(() => old.leave());
  mockUpdateUser.mockResolvedValue({ data: { user: user("b") }, error: null });
  await act(async () => {
    await current.submit("current-password");
  });
  expect(mockUpdateUser).toHaveBeenCalledTimes(1);
  expect(mockUpdateUser).toHaveBeenCalledWith({ password: "current-password" });
  expect(mockReplace).toHaveBeenCalledWith("/auth/login");
});

it("waiting recovery yields to a newer explicit auth intent before initialization", async () => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  useAuthStore.setState({ isInitialized: false });
  mockSetSession.mockResolvedValue({ data: { session: a }, error: null });
  const screen = render(<ResetPasswordScreen />);
  expect(window.location.hash).toBe("");
  expect(mockSetSession).not.toHaveBeenCalled();
  await act(async () => {
    await authCommands.transition(async () => {
      activate(session("b"));
    });
  });
  await act(async () => {
    useAuthStore.setState({ isInitialized: true });
  });
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user?.id).toBe(user("b").id);
  expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(true);
});

it("bootstrap restoration preserves the waiting recovery intent", async () => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  useAuthStore.setState({ isInitialized: false });
  mockSetSession.mockResolvedValue({ data: { session: a }, error: null });
  const screen = render(<ResetPasswordScreen />);
  expect(mockSetSession).not.toHaveBeenCalled();
  await act(async () => {
    await authCommands.bootstrap(async () => {
      activate(session("b"));
      useAuthStore.setState({ isInitialized: true });
    });
  });
  await waitFor(() => expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(false));
  expect(mockSetSession).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().user?.id).toBe(user("a").id);
});
it("bootstrap retains original rejection and does not create an explicit intent", async () => {
  const current = authCommands.captureIntent();
  const error = new Error("original-bootstrap-error");
  await expect(
    authCommands.bootstrap(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(current()).toBe(true);
  await authCommands.transition(async () => undefined);
  expect(current()).toBe(false);
});

it("a queued bootstrap read does not silently cancel a current owned command", async () => {
  activate(session("a"));
  const owner = authCommands.captureOwner();
  const pending = deferred<void>();
  const startup = authCommands.bootstrap(() => pending.promise);
  let ran = false;
  const work = authCommands.owned(owner, async () => {
    ran = true;
  });
  await Promise.resolve();
  expect(ran).toBe(false);
  pending.resolve();
  await startup;
  expect((await work).status).toBe("completed");
  expect(ran).toBe(true);
});

it("a different recovery link clears the previous form password draft", async () => {
  const a = session("a");
  webHash(`#access_token=${a.access_token}&refresh_token=${a.refresh_token}`);
  mockSetSession.mockResolvedValue({ data: { session: a }, error: null });
  const screen = render(<ResetPasswordScreen />);
  await waitFor(() => expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(false));
  fireEvent.changeText(screen.getByLabelText(strings.en.authNewPassword), "previous-owner-password");
  fireEvent.changeText(screen.getByLabelText(strings.en.authConfirmPassword), "previous-owner-password");
  const b = session("b");
  webHash(`#access_token=${b.access_token}&refresh_token=${b.refresh_token}`);
  mockSetSession.mockResolvedValue({ data: { session: b }, error: null });
  screen.rerender(
    <PasswordRecoveryProvider>
      <ResetPasswordScreen />
    </PasswordRecoveryProvider>,
  );
  await waitFor(() => expect(mockSetSession).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(false));
  expect(screen.getByLabelText(strings.en.authNewPassword).props.value).toBe("");
  expect(screen.getByLabelText(strings.en.authConfirmPassword).props.value).toBe("");
  expect(mockUpdateUser).not.toHaveBeenCalled();
});
it("an obsolete recovery form hides another owner's error and clears its draft without clearing global status", async () => {
  activate(session("a"));
  const screen = render(<ResetPasswordScreen />);
  await waitFor(() => expect(screen.getByTestId("submit").props.accessibilityState.disabled).toBe(false));
  fireEvent.changeText(screen.getByLabelText(strings.en.authNewPassword), "previous-owner-password");
  act(() => {
    activate(session("b"));
    useAuthStore.setState({ error: "later-owner-status" });
  });
  expect(screen.queryByText("later-owner-status")).toBeNull();
  expect(screen.getByLabelText(strings.en.authNewPassword).props.value).toBe("");
  expect(useAuthStore.getState().error).toBe("later-owner-status");
  expect(mockUpdateUser).not.toHaveBeenCalled();
});
