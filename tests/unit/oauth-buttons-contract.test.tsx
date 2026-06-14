import React from "react";
import * as ReactNative from "react-native";
import { Image, View } from "react-native";
import { render } from "@testing-library/react-native";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { DirectionProvider } from "@/lib/ui/direction";
import { flattenStyle, type RtlTestNode } from "../rtl/rtl-test-utils";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
}));

jest.mock("@/lib/auth/oauth", () => ({
  startAppOAuth: jest.fn(),
}));

jest.mock("@/lib/database/provider", () => ({
  useDatabaseStatus: () => ({ db: null }),
}));

jest.mock("@/lib/quran-foundation/config", () => ({
  isQfLoginEnabled: () => false,
}));

jest.mock("@/lib/quran-foundation/user-sync", () => ({
  runInitialQfUserSync: jest.fn(),
}));

const strings = {
  authOrContinueWith: "or continue with",
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

  it("renders clean icon-only rounded rectangles for social providers", () => {
    const { getByLabelText, queryByText, UNSAFE_getAllByType } = render(
      <DirectionProvider dir="ltr">
        <OAuthButtons strings={strings} isDark={false} />
      </DirectionProvider>
    );

    const buttons = [
      getByLabelText(strings.authContinueWithGoogle),
      getByLabelText(strings.authContinueWithApple),
      getByLabelText(strings.authContinueWithFacebook),
    ];

    for (const button of buttons) {
      const style = resolvePressableStyle(button.props.style);
      expect(style).toMatchObject({
        height: 56,
        borderRadius: 14,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
      });
      expect([104, 120]).toContain(style.width);
    }

    expect(queryByText(strings.authContinueWithGoogle)).toBeNull();
    expect(queryByText(strings.authContinueWithApple)).toBeNull();
    expect(queryByText(strings.authContinueWithFacebook)).toBeNull();

    const images = UNSAFE_getAllByType(Image);
    expect(images).toHaveLength(3);
    expect(flattenStyle(images[0].props.style)).toMatchObject({ width: 26, height: 26 });
    expect(flattenStyle(images[1].props.style)).toMatchObject({ width: 24, height: 24 });
    expect(flattenStyle(images[2].props.style)).toMatchObject({ width: 26, height: 26 });

    for (const image of images) {
      expect(flattenStyle(image.parent?.props.style).borderWidth).toBeUndefined();
      expect(flattenStyle(image.parent?.props.style).overflow).toBe("visible");
    }

    expect(UNSAFE_getAllByType(View).some((node: RtlTestNode) => flattenStyle(node.props.style).width === 28)).toBe(true);
  });
});
