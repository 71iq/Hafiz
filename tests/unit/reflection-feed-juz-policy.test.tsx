import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import ReflectionFeedScreen from "@/app/(tabs)/reflection-feed";
import { strings } from "@/lib/i18n/strings";
import { toArabicNumber } from "@/lib/arabic";
import type { Reflection, ReflectionJuzRange } from "@/lib/reflections/types";

let mockLanguage: "ar" | "en" = "en";
let mockGroups: { juz: number; ranges: ReflectionJuzRange[] }[] = [];
let mockReflection: Reflection;
const mockForbidden = jest.fn<never, unknown[]>(() => {
  throw new Error("Unexpected fixture database, network or navigation call");
});

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { surahs: [], juz: mockGroups } }),
  useInfiniteQuery: () => ({
    data: { pages: [{ data: [mockReflection] }] },
    isPending: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    refetch: mockForbidden,
    fetchNextPage: mockForbidden,
  }),
  useQueryClient: () => ({ invalidateQueries: mockForbidden }),
}));
jest.mock("expo-router", () => ({ router: { push: mockForbidden } }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => ({ getAllAsync: mockForbidden }) }));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ isDark: false, isRTL: mockLanguage === "ar", uiLanguage: mockLanguage }),
}));
jest.mock("@/lib/i18n/useStrings", () => ({
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings[mockLanguage],
}));
jest.mock("@/lib/auth/store", () => ({ useAuthStore: () => null }));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true }));
jest.mock("@/lib/reflections/api", () => ({ fetchReflectionFeed: mockForbidden }));
jest.mock("@/lib/deep-link", () => ({ setPendingDeepLink: mockForbidden }));
jest.mock("@/components/ui/ScreenContent", () => ({ useScreenContentLayout: () => ({}) }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: jest.requireActual<typeof import("react-native")>("react-native").View,
}));
jest.mock("@/components/reflections/CommentsSheet", () => ({ CommentsSheet: () => null }));
jest.mock("@/components/ui/ResponsiveOverlay", () => ({
  ResponsiveSheet: () => null,
  OverlayBody: () => null,
  OverlayHeader: () => null,
}));
jest.mock("@/components/ui/Toast", () => ({ Toast: () => null }));
jest.mock("@/components/ui/Skeleton", () => ({ ReflectionsSkeleton: () => null }));
jest.mock("@/components/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("@/components/reflections/ReflectionCard", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ReflectionCard: ({ referenceLabel }: { referenceLabel?: string }) => (
      <Text testID="reference-label">{referenceLabel}</Text>
    ),
  };
});
jest.mock("@shopify/flash-list", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    FlashList: ({
      data,
      renderItem,
    }: {
      data: Reflection[];
      renderItem: (row: { item: Reflection }) => React.ReactNode;
    }) => (
      <>
        {data.map((item) => (
          <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>
        ))}
      </>
    ),
  };
});

const row = (juz: number, start = 1, end = 10): ReflectionJuzRange => ({
  juz,
  surah: 2,
  ayah_start: start,
  ayah_end: end,
});
const locales: ("ar" | "en")[] = ["ar", "en"];
describe.each(locales)("Reflection feed juz labels in %s", (language) => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockForbidden.mockClear();
    mockLanguage = language;
    mockGroups = [];
    mockReflection = {
      id: "isolated-juz-policy",
      user_id: "fixture",
      surah: 2,
      ayah_start: 1,
      ayah_end: 1,
      juz_start: null,
      juz_end: null,
      content: "Isolated fixture",
      likes_count: 0,
      comments_count: 0,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  });
  afterEach(() => {
    cleanup();
    expect(mockForbidden).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
  const number = (juz: number) => (language === "ar" ? toArabicNumber(juz) : String(juz));
  const label = () => render(<ReflectionFeedScreen />).getByTestId("reference-label").props.children;

  it("omits juz when no range matches rather than using the reader fallback", () => {
    expect(label()).toBe(`${strings[language].tabSurah} 2:1`);
  });
  it("uses the first matching parent group even when the row juz is zero", () => {
    mockGroups = [
      { juz: 22, ranges: [row(0)] },
      { juz: 7, ranges: [row(9)] },
    ];
    expect(label()).toBe(`${strings[language].tabSurah} 2:1 · ${strings[language].tabJuz} ${number(22)}`);
  });
  it("preserves reordered overlap precedence", () => {
    mockGroups = [
      { juz: 7, ranges: [row(9)] },
      { juz: 22, ranges: [row(0)] },
    ];
    expect(label()).toBe(`${strings[language].tabSurah} 2:1 · ${strings[language].tabJuz} ${number(7)}`);
  });
  it("resolves start and end inclusively across separate groups", () => {
    mockReflection.ayah_end = 6;
    mockGroups = [
      { juz: 4, ranges: [row(4, 1, 5)] },
      { juz: 5, ranges: [row(5, 6, 10)] },
    ];
    expect(label()).toBe(`${strings[language].tabSurah} 2:1-6 · ${strings[language].tabJuz} ${number(4)}-${number(5)}`);
  });
  it("prefers stored finite juz labels over lookup", () => {
    mockReflection.juz_start = 8;
    mockReflection.juz_end = 8;
    mockGroups = [{ juz: 22, ranges: [row(0)] }];
    expect(label()).toBe(`${strings[language].tabSurah} 2:1 · ${strings[language].tabJuz} ${number(8)}`);
  });
  it("retains omission for a matching parent zero label", () => {
    mockGroups = [{ juz: 0, ranges: [row(9)] }];
    expect(label()).toBe(`${strings[language].tabSurah} 2:1`);
  });
});
