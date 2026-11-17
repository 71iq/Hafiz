import React, { type ReactNode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import type { Control } from "react-hook-form";
import LoginScreen from "@/app/auth/login";
import SignupScreen from "@/app/auth/signup";
import ForgotPasswordScreen from "@/app/auth/forgot-password";
import type { AuthActionHandle, SignUpResult } from "@/lib/auth/types";
import type { AuthCommandResult, AuthOwner } from "@/lib/auth/coordinator";
import { strings } from "@/lib/i18n/strings";
import { clearAuthHandoff } from "@/lib/auth/form-handoff";
let mockLocale: "en" | "ar" = "en",
  mockConfigured = true,
  mockEmailEnabled = true,
  mockLoading = false;
const mockRouter = {
  replace: jest.fn(),
  back: jest.fn(),
  push: jest.fn(),
  dismissTo: jest.fn(),
  canGoBack: () => true,
};
// The auth screen sits on top of a cold stack, so a verified session replaces it.
const mockNavigation = {
  getState: () => ({ index: 0, routes: [{ name: "auth/login" }] }),
  canGoBack: () => false,
  goBack: jest.fn(),
  addListener: jest.fn(() => () => {}),
};
const mockSignIn = jest.fn<AuthActionHandle<void>, [string, string]>();
const mockSignUp = jest.fn<AuthActionHandle<SignUpResult>, [string, string, string, string]>();
const mockResend = jest.fn<Promise<void>, [string]>();
const mockSendReset = jest.fn<Promise<void>, [string]>();
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useNavigation: () => mockNavigation,
  useFocusEffect: () => {},
  // Read lazily: the module factory runs before the test's constants are initialized.
  get router() {
    return mockRouter;
  },
  Redirect: () => null,
}));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: () => ({
    signIn: mockSignIn,
    signUp: mockSignUp,
    resendSignupConfirmation: mockResend,
    sendPasswordReset: mockSendReset,
    isLoading: mockLoading,
    sessionEnded: false,
    error: null,
  }),
}));
jest.mock("@/lib/auth/config", () => ({
  isEmailAuthFlowsEnabled: () => mockEmailEnabled,
  getEnabledSocialProviders: () => [],
}));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => mockConfigured }));
jest.mock("@/lib/i18n/startup-language", () => ({ getStartupLanguage: () => mockLocale }));
jest.mock("@/components/auth/OAuthButtons", () => ({ OAuthButtons: () => null }));
jest.mock("lucide-react-native", () => ({
  Eye: () => null,
  EyeOff: () => null,
  Lock: () => null,
  Mail: () => null,
  User: () => null,
  UserRound: () => null,
}));
jest.mock("@/components/auth/AuthScreenShell", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View, Text, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    useAuthDarkMode: () => false,
    AuthScreenShell: ({
      children,
      footer,
      unavailableContent,
    }: {
      children: ReactNode;
      footer: ReactNode;
      unavailableContent?: ReactNode;
    }) => (
      <View>
        {children}
        {footer}
        {unavailableContent}
      </View>
    ),
    AuthFormNotice: ({ message }: { message: string | null }) => <Text testID="notice">{message}</Text>,
    AuthRouteLink: ({ onPress, action }: { onPress: () => void; action: string }) => (
      <Pressable onPress={onPress}>
        <Text>{action}</Text>
      </Pressable>
    ),
    AuthUnavailableState: () => <Text>Unconfigured fixture</Text>,
    AuthTextLink: ({ onPress, label }: { onPress: () => void; label: string }) => (
      <Pressable onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
    useAuthIconColors: () => ({ muted: "#52525b", accent: "#0d9488", error: "#dc2626", theme: "white" }),
    useRevealOnFocus: () => () => {},
  };
});
jest.mock("@/components/ui/Button", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Button: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled: boolean }) => (
      <Pressable testID="email-submit" disabled={disabled} onPress={onPress}>
        {children}
      </Pressable>
    ),
  };
});
jest.mock("@/components/ui/FormTextField", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Controller } = jest.requireActual<typeof import("react-hook-form")>("react-hook-form");
  const { Text, TextInput } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    FormTextField: ({
      control,
      name,
      label,
      error,
      inputProps,
    }: {
      control: Control<{ email: string; password: string; username: string; displayName: string }>;
      name: "email" | "password" | "username" | "displayName";
      label: string;
      error?: string;
      inputProps: React.ComponentProps<typeof TextInput>;
    }) => (
      <>
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <TextInput
              {...inputProps}
              accessibilityLabel={label}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
        {/* Field errors render under their field, as in the real component. */}
        {error ? <Text testID={`${name}-error`}>{error}</Text> : null}
      </>
    ),
  };
});
function pending<T>() {
  let current = true,
    resolve!: (value: AuthCommandResult<T>) => void,
    reject!: (error: Error) => void;
  const result = new Promise<AuthCommandResult<T>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void result.catch(() => undefined);
  const owner: AuthOwner = {
    isCurrent: () => current,
    cancel: () => {
      current = false;
    },
  };
  return {
    handle: { isCurrent: owner.isCurrent, result },
    owner,
    resolve,
    reject,
    retire: owner.cancel,
    complete: (value: T) => resolve({ status: "completed", value, owner }),
  };
}
type Mode = "login" | "signup";
function form(mode: Mode, strict = false) {
  const screen = mode === "login" ? <LoginScreen /> : <SignupScreen />;
  const view = render(strict ? <React.StrictMode>{screen}</React.StrictMode> : screen);
  const s = strings[mockLocale];
  fireEvent.changeText(view.getByLabelText(s.authEmail), " QA@Example.Invalid ");
  fireEvent.changeText(view.getByLabelText(s.authPassword), "valid-password-42");
  if (mode === "signup") {
    fireEvent.changeText(view.getByLabelText(s.authUsername), " synthetic_user ");
    fireEvent.changeText(view.getByLabelText(s.authDisplayNameOptional), " Synthetic Name ");
  }
  return view;
}
function submitCallback(view: ReturnType<typeof render>): () => void {
  let node = view.getByTestId("email-submit");
  while (typeof node.props.onPress !== "function" && node.parent) node = node.parent;
  if (typeof node.props.onPress !== "function") throw new Error("No submit ancestor");
  return node.props.onPress;
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  clearAuthHandoff();
  mockSignIn.mockReset();
  mockSignUp.mockReset();
  mockLocale = "en";
  mockConfigured = true;
  mockEmailEnabled = true;
  mockLoading = false;
  mockResend.mockResolvedValue();
});
afterEach(cleanup);
describe.each(["en", "ar"] as const)("email forms in %s", (locale) => {
  beforeEach(() => {
    mockLocale = locale;
  });
  it.each<Mode>(["login", "signup"])(
    "%s waits for its owned result and admits one Enter/button submit",
    async (mode) => {
      const login = pending<void>(),
        signup = pending<SignUpResult>();
      mockSignIn.mockReturnValue(login.handle);
      mockSignUp.mockReturnValue(signup.handle);
      const view = form(mode);
      act(() => {
        fireEvent(view.getByLabelText(strings[locale].authPassword), "submitEditing");
        fireEvent.press(view.getByTestId("email-submit"));
      });
      await flush();
      expect(mode === "login" ? mockSignIn : mockSignUp).toHaveBeenCalledTimes(1);
      expect(mockRouter.replace).not.toHaveBeenCalled();
      expect(mockRouter.back).not.toHaveBeenCalled();
      if (mode === "login") {
        expect(mockSignIn).toHaveBeenCalledWith("qa@example.invalid", "valid-password-42");
        login.complete();
      } else {
        expect(mockSignUp).toHaveBeenCalledWith(
          "qa@example.invalid",
          "valid-password-42",
          "synthetic_user",
          " Synthetic Name ",
        );
        signup.complete({ status: "signedIn" });
      }
      await flush();
      expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/home");
      expect(mockRouter.back).not.toHaveBeenCalled();
    },
  );
  it.each<Mode>(["login", "signup"])("%s ignores superseded results and retired errors", async (mode) => {
    const login = pending<void>(),
      signup = pending<SignUpResult>();
    mockSignIn.mockReturnValue(login.handle);
    mockSignUp.mockReturnValue(signup.handle);
    const view = form(mode);
    fireEvent.press(view.getByTestId("email-submit"));
    await flush();
    if (mode === "login") {
      login.retire();
      login.reject(new Error("retired login failure"));
    } else {
      signup.retire();
      signup.resolve({ status: "superseded" });
    }
    await flush();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(view.queryByText("retired login failure")).toBeNull();
    expect(view.queryByText(strings[locale].authSignupConfirmEmail)).toBeNull();
  });
  it.each<Mode>(["login", "signup"])("%s cannot submit from a retained callback after unmount", async (mode) => {
    const login = pending<void>(),
      signup = pending<SignUpResult>();
    mockSignIn.mockReturnValue(login.handle);
    mockSignUp.mockReturnValue(signup.handle);
    const view = form(mode);
    const submit = submitCallback(view);
    view.unmount();
    await act(async () => {
      submit();
    });
    await flush();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  describe("email form lifecycle controls", () => {
    beforeEach(() => {
      mockConfigured = true;
      mockEmailEnabled = true;
      mockLoading = false;
    });

    it("shows a current login error and admits a successful retry", async () => {
      const failed = pending<void>(),
        retried = pending<void>();
      mockSignIn.mockReturnValueOnce(failed.handle).mockReturnValueOnce(retried.handle);
      const view = form("login");
      fireEvent.press(view.getByTestId("email-submit"));
      await flush();
      failed.reject(new Error("Invalid login credentials"));
      await flush();
      expect(view.getByText(strings[locale].authInvalidCredentials)).toBeTruthy();
      fireEvent.press(view.getByTestId("email-submit"));
      await flush();
      expect(mockSignIn).toHaveBeenCalledTimes(2);
      retried.complete();
      await flush();
      expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/home");
    });

    it("ignores a completed result whose owner retired before continuation", async () => {
      const login = pending<void>();
      mockSignIn.mockReturnValue(login.handle);
      const view = form("login");
      fireEvent.press(view.getByTestId("email-submit"));
      await flush();
      login.complete();
      login.retire();
      await flush();
      expect(mockRouter.replace).not.toHaveBeenCalled();
      expect(view.queryByText("retired login failure")).toBeNull();
    });

    it.each([
      // Registered and new emails get the same neutral result, so the form reveals no account.
      ["alreadyRegistered", strings[locale].authSignupConfirmEmail, false],
      ["needsEmailConfirmation", strings[locale].authSignupConfirmEmail, false],
      ["signedIn", null, true],
    ] as const)("handles signup %s only for its current result", async (status, message, leavesAuth) => {
      const signup = pending<SignUpResult>();
      mockSignUp.mockReturnValue(signup.handle);
      const view = form("signup");
      fireEvent.press(view.getByTestId("email-submit"));
      await flush();
      signup.complete({ status });
      await flush();
      if (message) expect(view.getByText(message)).toBeTruthy();
      expect(mockRouter.replace).toHaveBeenCalledTimes(leavesAuth ? 1 : 0);
    });

    it.each<Mode>(["login", "signup"])("does not continue after %s settles following unmount", async (mode) => {
      const login = pending<void>(),
        signup = pending<SignUpResult>();
      mockSignIn.mockReturnValue(login.handle);
      mockSignUp.mockReturnValue(signup.handle);
      const view = form(mode);
      fireEvent.press(view.getByTestId("email-submit"));
      await flush();
      view.unmount();
      if (mode === "login") login.complete();
      else signup.complete({ status: "needsEmailConfirmation" });
      await flush();
      expect(mockRouter.replace).not.toHaveBeenCalled();
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it("does not dispatch invalid signup data", async () => {
      const invalid = form("signup");
      fireEvent.changeText(invalid.getByLabelText(strings[locale].authEmail), "bad-email");
      fireEvent.press(invalid.getByTestId("email-submit"));
      await flush();
      expect(mockSignUp).not.toHaveBeenCalled();
      // The error shows only under its field, not repeated in the form banner.
      expect(invalid.getByTestId("email-error").props.children).toBe(strings[locale].authValidationInvalidEmail);
      expect(invalid.getAllByText(strings[locale].authValidationInvalidEmail)).toHaveLength(1);
    });

    it("hides email controls when auth is unconfigured", () => {
      mockConfigured = false;
      const unavailable = render(<LoginScreen />);
      expect(unavailable.queryByTestId("email-submit")).toBeNull();
      expect(unavailable.getByText("Unconfigured fixture")).toBeTruthy();
    });

    it("keeps the email submit control disabled while auth is loading", async () => {
      mockLoading = true;
      const loading = form("login");
      expect(loading.getByTestId("email-submit").props.accessibilityState.disabled).toBe(true);
      fireEvent.press(loading.getByTestId("email-submit"));
      await flush();
      expect(mockSignIn).not.toHaveBeenCalled();
    });

    it.each<Mode>(["login", "signup"])("ignores a %s error after unmount", async (mode) => {
      const login = pending<void>(),
        signup = pending<SignUpResult>();
      mockSignIn.mockReturnValue(login.handle);
      mockSignUp.mockReturnValue(signup.handle);
      const view = form(mode);
      fireEvent.press(view.getByTestId("email-submit"));
      await flush();
      view.unmount();
      if (mode === "login") login.reject(new Error("late login failure"));
      else signup.reject(new Error("late signup failure"));
      await flush();
      expect(mockRouter.replace).not.toHaveBeenCalled();
      expect(mockRouter.back).not.toHaveBeenCalled();
    });
  });
});

it.each<Mode>(["login", "signup"])(
  "old %s completion cannot release a StrictMode remount's pending submit",
  async (mode) => {
    const oldLogin = pending<void>(),
      newLogin = pending<void>();
    const oldSignup = pending<SignUpResult>(),
      newSignup = pending<SignUpResult>();
    mockSignIn.mockReturnValueOnce(oldLogin.handle).mockReturnValueOnce(newLogin.handle);
    mockSignUp.mockReturnValueOnce(oldSignup.handle).mockReturnValueOnce(newSignup.handle);
    const old = form(mode, true);
    fireEvent.press(old.getByTestId("email-submit"));
    await flush();
    old.unmount();
    const current = form(mode, true);
    fireEvent.press(current.getByTestId("email-submit"));
    await flush();
    if (mode === "login") oldLogin.complete();
    else oldSignup.complete({ status: "signedIn" });
    await flush();
    fireEvent.press(current.getByTestId("email-submit"));
    await flush();
    expect(mode === "login" ? mockSignIn : mockSignUp).toHaveBeenCalledTimes(2);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
    if (mode === "login") newLogin.complete();
    else newSignup.complete({ status: "signedIn" });
    await flush();
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  },
);

describe("login and carried email", () => {
  const routerArgs = () =>
    [...mockRouter.push.mock.calls, ...mockRouter.replace.mock.calls, ...mockRouter.dismissTo.mock.calls].map((call) =>
      JSON.stringify(call),
    );

  it("checks only that a password was entered, not the signup length rule", async () => {
    mockSignIn.mockReturnValue(pending<void>().handle);
    const view = form("login");
    fireEvent.changeText(view.getByLabelText(strings.en.authPassword), "abc");
    fireEvent.press(view.getByTestId("email-submit"));
    await flush();
    expect(mockSignIn).toHaveBeenCalledWith("qa@example.invalid", "abc");
  });

  it("requires a password", async () => {
    const view = form("login");
    fireEvent.changeText(view.getByLabelText(strings.en.authPassword), "");
    fireEvent.press(view.getByTestId("email-submit"));
    await flush();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(view.getByTestId("password-error").props.children).toBe(strings.en.authValidationPasswordRequired);
  });

  it("carries the typed email to Forgot password and Sign up in memory, never in a URL", async () => {
    const login = form("login");
    fireEvent.press(login.getByText(strings.en.authForgotPassword));
    expect(mockRouter.push).toHaveBeenCalledWith("/auth/forgot-password");
    login.unmount();

    const signupFromLogin = render(<LoginScreen />);
    expect(signupFromLogin.getByLabelText(strings.en.authEmail).props.value).toBe("QA@Example.Invalid");
    fireEvent.press(signupFromLogin.getByText(strings.en.authSignup));
    expect(mockRouter.replace).toHaveBeenCalledWith("/auth/signup");
    signupFromLogin.unmount();

    const signup = render(<SignupScreen />);
    expect(signup.getByLabelText(strings.en.authEmail).props.value).toBe("QA@Example.Invalid");
    // No navigation argument carries the email or any part of it.
    for (const args of routerArgs()) {
      expect(args).not.toContain("@");
      expect(args.toLowerCase()).not.toContain("example");
    }
  });

  it("never shows a raw provider message and offers resend for an unconfirmed email", async () => {
    const failed = pending<void>();
    mockSignIn.mockReturnValue(failed.handle);
    const view = form("login");
    fireEvent.press(view.getByTestId("email-submit"));
    await flush();
    failed.reject(Object.assign(new Error("Email not confirmed"), { code: "email_not_confirmed" }));
    await flush();
    expect(view.getByText(strings.en.authErrorEmailNotConfirmed)).toBeTruthy();
    expect(view.queryByText("Email not confirmed")).toBeNull();
  });

  it("maps an unknown failure to the generic localized error", async () => {
    const failed = pending<void>();
    mockSignIn.mockReturnValue(failed.handle);
    const view = form("login");
    fireEvent.press(view.getByTestId("email-submit"));
    await flush();
    failed.reject(new Error("relation profiles does not exist"));
    await flush();
    expect(view.getByText(strings.en.authErrorGeneric)).toBeTruthy();
    expect(view.queryByText("relation profiles does not exist")).toBeNull();
  });
});

describe("forgot password", () => {
  it("shows a neutral sent panel and blocks another send for 60 seconds", async () => {
    jest.useFakeTimers();
    try {
      mockSendReset.mockResolvedValue();
      const view = render(<ForgotPasswordScreen />);
      fireEvent.changeText(view.getByLabelText(strings.en.authEmail), "qa@example.invalid");
      await act(async () => {
        fireEvent.press(view.getByTestId("email-submit"));
      });
      await flush();
      expect(mockSendReset).toHaveBeenCalledWith("qa@example.invalid");
      // Neutral: the same words whether or not the address has an account.
      expect(view.getByText(new RegExp("^If qa@example\\.invalid has a Hafiz account"))).toBeTruthy();
      fireEvent.press(view.getByText("Send again in 60 s"));
      expect(mockSendReset).toHaveBeenCalledTimes(1);
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      fireEvent.press(view.getByText(strings.en.authSendAgain));
      await flush();
      expect(mockSendReset).toHaveBeenCalledTimes(2);
      expect(mockRouter.push).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
