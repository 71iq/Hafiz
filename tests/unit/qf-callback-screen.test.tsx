import React from "react";
import { act, cleanup, render } from "@testing-library/react-native";
import { Platform } from "react-native";
import QfAppCallbackScreen from "@/app/auth/qf-app-callback";
import QfCallbackScreen from "@/app/auth/qf-callback";

const mockReplace = jest.fn();
const mockComplete = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => ({ code: "synthetic-code", state: "synthetic-state" }),
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { SafeAreaView: View };
});
jest.mock("@/lib/i18n/useStrings", () => ({ useAppLanguage: () => "en" }));
jest.mock("@/lib/quran-foundation/user", () => ({
  completeQfOAuthConnection: (...args: unknown[]) => mockComplete(...args),
}));

describe("Quran Foundation callback routes", () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");

  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "web");
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://hafizquran.app" },
      configurable: true,
    });
    mockComplete.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    mockReplace.mockReset();
    mockComplete.mockReset();
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
    else Reflect.deleteProperty(globalThis, "location");
  });

  it.each([
    ["website", QfCallbackScreen, "https://hafizquran.app/auth/qf-callback"],
    ["app", QfAppCallbackScreen, "https://hafizquran.app/auth/qf-app-callback"],
  ] as const)("completes the %s callback with the address it was issued for", async (_name, Screen, redirectUri) => {
    render(<Screen />);
    await act(async () => {});

    expect(mockComplete).toHaveBeenCalledWith("synthetic-code", "synthetic-state", redirectUri);
    expect(mockReplace).toHaveBeenCalledWith("/settings?qf=connected");
  });
});
