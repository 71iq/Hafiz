import React from "react";
import { Linking, Text } from "react-native";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { NavigationContainer, NavigationIndependentTree } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { AppNavigation } from "@/components/ui/AppNavigation";
import { ErrorBoundary, SUPPORT_CONTACT_URL } from "@/components/ui/ErrorBoundary";
import { DATABASE_SLOW_HINT_MS, LoadingScreen, importStageLabelKey } from "@/components/LoadingScreen";
import { strings } from "@/lib/i18n/strings";
import { documentTitleFor } from "@/lib/navigation/document-title";
import {
  consumeSearchRequest,
  isSearchShortcut,
  requestSearch,
  usePendingSearchRequest,
} from "@/lib/navigation/search-launcher";

const mockReplace = jest.fn();
// Native scheduling boundary only, as in the other navigation tests.
jest.mock("react-native-reanimated", () => {
  const RN = require("react-native");
  const { ReduceMotion } = jest.requireActual("react-native-reanimated/src/commonTypes");
  return {
    __esModule: true,
    default: { View: RN.View, createAnimatedComponent: (component: unknown) => component },
    ReduceMotion,
    useSharedValue: (initial: number) => require("react").useRef({ value: initial }).current,
    useAnimatedStyle: (read: () => object) => read(),
    withTiming: (value: number) => value,
    withSpring: (value: number) => value,
  };
});
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: (...args: unknown[]) => mockReplace(...args) },
}));
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
jest.mock("@/lib/settings/context", () => ({
  ...jest.requireActual("@/lib/settings/context"),
  useSettings: () => ({
    isDark: false,
    themeSurface: "#fff",
    themeColors: { surfaceHigh: "#E8E1DA" },
    effectiveTheme: "beige",
    uiLanguage: "en",
  }),
}));
jest.mock("@/lib/auth/store", () => ({ useAuthStore: () => ({ user: null, profile: null }) }));
jest.mock("@/lib/settings/ui-bootstrap", () => ({ useUiBootstrap: () => ({ resolved: true }) }));
jest.mock("@/lib/i18n/startup-language", () => ({ getStartupLanguage: () => "en" }));

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("phone tab bar", () => {
  const Tabs = createBottomTabNavigator();
  const names = ["home", "mushaf", "leaderboard", "progress", "settings", "reflection-feed"];
  const Screen = () => <Text>screen</Text>;

  it("shows Home, Mushaf, Progress and Settings in that order below 768px", () => {
    jest.spyOn(require("react-native"), "useWindowDimensions").mockReturnValue({
      width: 320,
      height: 700,
      scale: 1,
      fontScale: 1,
    });
    const view = render(
      <NavigationIndependentTree>
        <NavigationContainer>
          <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <AppNavigation {...props} />}>
            {names.map((name) => (
              <Tabs.Screen key={name} name={name} component={Screen} options={{ title: `T-${name}` }} />
            ))}
          </Tabs.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>,
    );
    const labels = view.getAllByRole("button").map((node) => node.props.children);
    const tabTitles = view.getAllByText(/^T-/).map((node) => node.props.children as string);
    expect(tabTitles).toEqual(["T-home", "T-mushaf", "T-progress", "T-settings"]);
    expect(labels).toHaveLength(4);
    jest.restoreAllMocks();
  });
});

describe("browser tab titles", () => {
  it("names the route in the UI language", () => {
    expect(documentTitleFor("/mushaf", strings.en)).toBe("Mushaf | Hafiz");
    expect(documentTitleFor("/progress", strings.en)).toBe("Progress | Hafiz");
    expect(documentTitleFor("/mushaf", strings.ar)).toBe(`${strings.ar.tabMushaf} | ${strings.ar.appName}`);
    expect(documentTitleFor("/", strings.ar)).toBe(strings.ar.appName);
    expect(documentTitleFor("/unknown", strings.en)).toBe("Hafiz");
    // Halaqa is removed for now: an old /halaqa link opens the not-found screen under the app's name.
    expect(documentTitleFor("/halaqa", strings.en)).toBe("Hafiz");
  });
});

describe("search launcher", () => {
  it("hands one pending request to its owner once and ignores a replaced one", () => {
    const first = requestSearch("  الرحمن ");
    const second = requestSearch("2:255");
    expect(consumeSearchRequest(first.id)).toBeNull();
    expect(consumeSearchRequest(second.id)).toEqual({ id: second.id, query: "2:255" });
    expect(consumeSearchRequest(second.id)).toBeNull();
  });

  it("publishes pending requests to subscribers", () => {
    const seen: (string | null)[] = [];
    function Probe() {
      const request = usePendingSearchRequest();
      seen.push(request?.query ?? null);
      return null;
    }
    render(<Probe />);
    act(() => {
      requestSearch("light");
    });
    expect(seen.at(-1)).toBe("light");
    const pending = requestSearch("x");
    act(() => {
      consumeSearchRequest(pending.id);
    });
    expect(seen.at(-1)).toBeNull();
  });

  const key = (overrides: Record<string, unknown>) =>
    ({
      key: "k",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      target: { tagName: "DIV" },
      ...overrides,
    }) as unknown as KeyboardEvent;

  it("matches Ctrl/Cmd+K and bare / outside text editing only", () => {
    expect(isSearchShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ metaKey: true, key: "K" }))).toBe(true);
    expect(isSearchShortcut(key({ key: "/" }))).toBe(true);
    expect(isSearchShortcut(key({ key: "/", ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ key: "k" }))).toBe(false);
    expect(isSearchShortcut(key({ ctrlKey: true, target: { tagName: "INPUT" } }))).toBe(false);
    expect(isSearchShortcut(key({ key: "/", target: { tagName: "DIV", isContentEditable: true } }))).toBe(false);
    expect(isSearchShortcut(key({ ctrlKey: true, isComposing: true }))).toBe(false);
    expect(isSearchShortcut(key({ ctrlKey: true, defaultPrevented: true }))).toBe(false);
  });
});

describe("startup loading screen", () => {
  it("labels each import stage and finishes on Complete", () => {
    expect(importStageLabelKey(null)).toBe("databaseStageSchema");
    expect(importStageLabelKey({ step: "Surahs", current: 1, total: 22 })).toBe("databaseStageText");
    expect(importStageLabelKey({ step: "Tafsir", current: 5, total: 22 })).toBe("databaseStageTafsir");
    expect(importStageLabelKey({ step: "Page Map", current: 9, total: 22 })).toBe("databaseStageWords");
    expect(importStageLabelKey({ step: "Complete", current: 22, total: 22 })).toBe("databaseStageFinish");
  });

  it("shows the localized title, the stage, and the truthful slow hint after ten seconds", () => {
    jest.useFakeTimers();
    const view = render(<LoadingScreen progress={{ step: "Surahs", current: 1, total: 22 }} />);
    expect(view.getByText(strings.en.appName)).toBeTruthy();
    expect(view.getByText(strings.en.databaseStageText)).toBeTruthy();
    act(() => jest.advanceTimersByTime(DATABASE_SLOW_HINT_MS - 1));
    expect(view.queryByText(strings.en.databaseSlowHint)).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByText(strings.en.databaseSlowHint)).toBeTruthy();
  });

  it("keeps only the logo and title during the onboarding lookup", () => {
    jest.useFakeTimers();
    const view = render(<LoadingScreen progress={null} showProgress={false} />);
    act(() => jest.advanceTimersByTime(DATABASE_SLOW_HINT_MS));
    expect(view.queryByText(strings.en.databaseStageSchema)).toBeNull();
    expect(view.queryByText(strings.en.databaseSlowHint)).toBeNull();
    expect(view.getByText(strings.en.appName)).toBeTruthy();
  });
});

describe("scoped error fallback", () => {
  let shouldThrow = true;
  function Broken() {
    if (shouldThrow) throw new Error("isolated crash");
    return <Text>recovered</Text>;
  }

  beforeEach(() => {
    shouldThrow = true;
    mockReplace.mockClear();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("offers Retry, Go to Home through the root entry and the support link", () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const view = render(
      <ErrorBoundary section="test">
        <Broken />
      </ErrorBoundary>,
    );
    fireEvent.press(view.getByText(strings.en.errorReportProblem));
    expect(open).toHaveBeenCalledWith(SUPPORT_CONTACT_URL);
    shouldThrow = false;
    fireEvent.press(view.getByText(strings.en.errorGoHome));
    expect(mockReplace).toHaveBeenCalledWith("/");
    expect(view.getByText("recovered")).toBeTruthy();
  });

  it("uses a compact card without Home for a section such as a sheet body", () => {
    const view = render(
      <ErrorBoundary section="sheet" variant="section" showHome={false}>
        <Broken />
      </ErrorBoundary>,
    );
    expect(view.getByText(strings.en.errorSectionTitle)).toBeTruthy();
    expect(view.queryByText(strings.en.errorGoHome)).toBeNull();
    shouldThrow = false;
    fireEvent.press(view.getByText(strings.en.errorTryAgain));
    expect(view.getByText("recovered")).toBeTruthy();
  });
});
