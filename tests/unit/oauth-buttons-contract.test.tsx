import React from "react";
import * as ReactNative from "react-native";
import { Image } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { isSocialAuthEnabled } from "@/lib/auth/config";
import { startAppOAuth } from "@/lib/auth/oauth";
import { DirectionProvider } from "@/lib/ui/direction";
import { flattenStyle } from "../rtl/rtl-test-utils";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
}));

jest.mock("@/lib/auth/oauth", () => ({
  startAppOAuth: jest.fn(),
}));

jest.mock("@/lib/auth/config", () => ({
  isSocialAuthEnabled: jest.fn(),
}));

jest.mock("@/lib/database/provider", () => ({
  useDatabaseStatus: () => ({ db: null }),
}));

jest.mock("@/lib/quran-foundation/config", () => ({
  isQfLoginEnabled: () => false,
}));

jest.mock("@/lib/auth/store", () => ({ useAuthStore: { getState: jest.fn() } }));

jest.mock("@/lib/quran-foundation/user-sync", () => ({
  runInitialQfUserSync: jest.fn(),
}));

const strings = {
  authOrContinueWith: "Or continue with",
  authContinueWithQuranFoundation: "Continue with Quran Foundation",
  authContinueWithGoogle: "Continue with Google",
  authContinueWithApple: "Continue with Apple",
  authContinueWithFacebook: "Continue with Facebook",
};

function resolvePressableStyle(style: unknown) {
  return flattenStyle(typeof style === "function" ? style({ pressed: false }) : style);
}

describe("OAuth social button contracts", () => {
  beforeEach(() => {
    jest.mocked(isSocialAuthEnabled).mockReturnValue(true);
    jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue({
      width: 1024,
      height: 768,
      scale: 1,
      fontScale: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("hides social providers and their divider when disabled", () => {
    jest.mocked(isSocialAuthEnabled).mockReturnValue(false);
    const { queryByLabelText, queryByText } = render(<OAuthButtons strings={strings} />);
    expect(queryByLabelText(strings.authContinueWithGoogle)).toBeNull();
    expect(queryByLabelText(strings.authContinueWithApple)).toBeNull();
    expect(queryByLabelText(strings.authContinueWithFacebook)).toBeNull();
    expect(queryByText(strings.authOrContinueWith)).toBeNull();
  });

  it("shows each enabled provider as a full-width labeled button with a 44px target", () => {
    const { getByLabelText, getByText, UNSAFE_getAllByType } = render(
      <DirectionProvider dir="ltr">
        <OAuthButtons strings={strings} isDark={false} />
      </DirectionProvider>,
    );

    for (const label of [
      strings.authContinueWithGoogle,
      strings.authContinueWithApple,
      strings.authContinueWithFacebook,
    ]) {
      const style = resolvePressableStyle(getByLabelText(label).props.style);
      expect(style.width).toBe("100%");
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      // The full label is visible, so it wraps instead of shrinking.
      expect(getByText(label)).toBeTruthy();
    }
    expect(UNSAFE_getAllByType(Image)).toHaveLength(3);
    expect(getByText(strings.authOrContinueWith)).toBeTruthy();
  });

  it("keeps the tapped provider at full strength and names it while the hand-off runs", async () => {
    jest.mocked(startAppOAuth).mockReturnValue({ isCurrent: () => true, result: new Promise(() => {}) });
    const view = render(
      <DirectionProvider dir="ltr">
        <OAuthButtons strings={strings} isDark={false} />
      </DirectionProvider>,
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText(strings.authContinueWithGoogle));
    });
    expect(view.getByText("Opening Google...")).toBeTruthy();
    expect(resolvePressableStyle(view.getByLabelText(strings.authContinueWithGoogle).props.style).opacity).toBe(1);
    expect(resolvePressableStyle(view.getByLabelText(strings.authContinueWithApple).props.style).opacity).toBe(0.55);
    expect(resolvePressableStyle(view.getByLabelText(strings.authContinueWithFacebook).props.style).opacity).toBe(0.55);
  });
});
