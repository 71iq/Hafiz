import React from "react";
import * as ReactNative from "react-native";
import { Image } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { getEnabledSocialProviders } from "@/lib/auth/config";
import { startAppOAuth } from "@/lib/auth/oauth";
import { isQfLoginEnabled } from "@/lib/quran-foundation/config";
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
  getEnabledSocialProviders: jest.fn(),
}));

jest.mock("@/lib/database/provider", () => ({
  useDatabaseStatus: () => ({ db: null }),
}));

jest.mock("@/lib/quran-foundation/config", () => ({
  isQfLoginEnabled: jest.fn(),
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
    jest.mocked(getEnabledSocialProviders).mockReturnValue(["google", "apple", "facebook"]);
    jest.mocked(isQfLoginEnabled).mockReturnValue(false);
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
    jest.mocked(getEnabledSocialProviders).mockReturnValue([]);
    const { queryByLabelText, queryByText } = render(<OAuthButtons strings={strings} />);
    expect(queryByLabelText(strings.authContinueWithGoogle)).toBeNull();
    expect(queryByLabelText(strings.authContinueWithApple)).toBeNull();
    expect(queryByLabelText(strings.authContinueWithFacebook)).toBeNull();
    expect(queryByText(strings.authOrContinueWith)).toBeNull();
  });

  it("shows only Google when it is the only enabled provider", () => {
    jest.mocked(getEnabledSocialProviders).mockReturnValue(["google"]);
    const { getByLabelText, getByText, queryByLabelText, queryByText, UNSAFE_getAllByType } = render(
      <OAuthButtons strings={strings} isDark={false} />,
    );
    expect(getByLabelText(strings.authContinueWithGoogle)).toBeTruthy();
    expect(queryByLabelText(strings.authContinueWithApple)).toBeNull();
    expect(queryByLabelText(strings.authContinueWithFacebook)).toBeNull();
    expect(queryByText(strings.authContinueWithQuranFoundation)).toBeNull();
    expect(UNSAFE_getAllByType(Image)).toHaveLength(1);
    expect(getByText(strings.authOrContinueWith)).toBeTruthy();
  });

  it("keeps Quran Foundation and the divider without any social provider", () => {
    jest.mocked(getEnabledSocialProviders).mockReturnValue([]);
    jest.mocked(isQfLoginEnabled).mockReturnValue(true);
    const { getByText, queryByLabelText } = render(<OAuthButtons strings={strings} isDark={false} />);
    expect(getByText(strings.authContinueWithQuranFoundation)).toBeTruthy();
    expect(getByText(strings.authOrContinueWith)).toBeTruthy();
    expect(queryByLabelText(strings.authContinueWithGoogle)).toBeNull();
    expect(queryByLabelText(strings.authContinueWithApple)).toBeNull();
    expect(queryByLabelText(strings.authContinueWithFacebook)).toBeNull();
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
