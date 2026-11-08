import React, { type ReactNode } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReflectionFeedScreen from "@/app/(tabs)/reflection-feed";
import { fetchReflectionFeed } from "@/lib/reflections/api";
import { reflectionQueryKeys as keys } from "@/lib/reflections/query-keys";
import type { Reflection } from "@/lib/reflections/types";
import { strings } from "@/lib/i18n/strings";
let mockLocale: "en" | "ar" = "en";
const mockDb = { getAllAsync: async () => [] };
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ isDark: false, isRTL: mockLocale === "ar", uiLanguage: mockLocale }),
}));
jest.mock("@/lib/i18n/useStrings", () => ({
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings[mockLocale],
}));
jest.mock("@/lib/auth/store", () => ({ useAuthStore: () => null }));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true }));
jest.mock("@/lib/reflections/api", () => ({ fetchReflectionFeed: jest.fn() }));
jest.mock("@/lib/deep-link", () => ({ setPendingDeepLink: jest.fn() }));
jest.mock("@/components/ui/ScreenContent", () => ({ useScreenContentLayout: () => ({}) }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: jest.requireActual<typeof import("react-native")>("react-native").View,
}));
jest.mock("@/components/ui/ResponsiveOverlay", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ResponsiveSheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <View>{children}</View> : null,
    OverlayBody: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    OverlayHeader: () => null,
  };
});
jest.mock("@/components/ui/Toast", () => ({ Toast: () => null }));
jest.mock("@/components/ui/Skeleton", () => ({ ReflectionsSkeleton: () => null }));
jest.mock("@/components/ui/EmptyState", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    EmptyState: ({
      subtitle,
      actionLabel,
      onAction,
    }: {
      subtitle: string;
      actionLabel: string;
      onAction: () => void;
    }) => (
      <>
        <Text>{subtitle}</Text>
        <Pressable onPress={onAction}>
          <Text>{actionLabel}</Text>
        </Pressable>
      </>
    ),
  };
});
jest.mock("@/components/reflections/ReflectionCard", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ReflectionCard: ({
      reflection,
      onCommentsPress,
    }: {
      reflection: Reflection;
      onCommentsPress: (id: string) => void;
    }) => (
      <Pressable onPress={() => onCommentsPress(reflection.id)}>
        <Text>{`${reflection.id}|${reflection.comments_count}`}</Text>
      </Pressable>
    ),
  };
});
jest.mock("@/components/reflections/CommentsSheet", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    CommentsSheet: ({
      reflectionId,
      onCommentAdded,
    }: {
      reflectionId: string | null;
      onCommentAdded: (id: string) => void;
    }) =>
      reflectionId ? (
        <Pressable testID="confirmed-comment" onPress={() => onCommentAdded(reflectionId)}>
          <Text>Confirmed fixture comment</Text>
        </Pressable>
      ) : null,
  };
});
jest.mock("@shopify/flash-list", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    FlashList: ({
      data,
      renderItem,
      ListFooterComponent,
    }: {
      data: Reflection[];
      renderItem: (row: { item: Reflection }) => ReactNode;
      ListFooterComponent: ReactNode;
    }) => (
      <>
        {data.map((item) => (
          <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>
        ))}
        {ListFooterComponent}
      </>
    ),
  };
});
const row = (id = "post", count = 3): Reflection => ({
  id,
  user_id: "author",
  surah: 2,
  ayah_start: 1,
  ayah_end: 1,
  content: "Synthetic",
  likes_count: 0,
  comments_count: count,
  status: "active",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
});
type Page = { data: Reflection[]; hasMore: boolean };
const page = (id = "post", count = 3, hasMore = false): Page => ({ data: [row(id, count)], hasMore });
let client: QueryClient;
let drain: (() => void) | undefined;
function deferred() {
  let resolve!: (value: Page) => void, reject!: (error: Error) => void;
  const promise = new Promise<Page>((a, b) => {
    resolve = a;
    reject = b;
  });
  drain = () => resolve(page());
  return { promise, resolve, reject };
}
function screen() {
  return render(
    <QueryClientProvider client={client}>
      <ReflectionFeedScreen />
    </QueryClientProvider>,
  );
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  jest.mocked(fetchReflectionFeed).mockResolvedValue(page());
});
afterEach(async () => {
  cleanup();
  drain?.();
  drain = undefined;
  await flush();
  client.clear();
});
describe.each(["en", "ar"] as const)("feed recovery in %s", (locale) => {
  beforeEach(() => {
    mockLocale = locale;
  });
  it("does not restart a pending next page and retains rows through page error and retry", async () => {
    const pending = deferred();
    jest
      .mocked(fetchReflectionFeed)
      .mockResolvedValueOnce(page("post", 3, true))
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(pending.promise);
    const view = screen();
    await waitFor(() => expect(view.getByText("post|3")).toBeTruthy());
    const text = view.getByText(strings[locale].reflectionLoadMore);
    let node = text;
    while (typeof node.props.onPress !== "function" && node.parent) node = node.parent;
    const press: () => void = node.props.onPress;
    act(() => {
      press();
      press();
    });
    expect(fetchReflectionFeed).toHaveBeenCalledTimes(2);
    pending.reject(new Error("synthetic page rejected"));
    await flush();
    await waitFor(() => expect(view.getByText(strings[locale].reflectionFeedRetry)).toBeTruthy());
    expect(view.getByText("post|3")).toBeTruthy();
    jest.mocked(fetchReflectionFeed).mockReset().mockResolvedValue(page("next"));
    fireEvent.press(view.getByText(strings[locale].reflectionFeedRetry));
    await waitFor(() => expect(view.getByText("next|3")).toBeTruthy());
    expect(view.getByText("post|3")).toBeTruthy();
    expect(fetchReflectionFeed).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });
  it("admits one retry after a retained-data background refetch error", async () => {
    const pending = deferred();
    jest
      .mocked(fetchReflectionFeed)
      .mockReset()
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error("synthetic background refetch rejected"))
      .mockReturnValue(pending.promise);
    const view = screen();
    await waitFor(() => expect(view.getByText("post|3")).toBeTruthy());
    await act(async () => {
      await client.invalidateQueries({ queryKey: keys.feed.all });
    });
    await flush();
    const text = view.getByText(strings[locale].reflectionFeedRetry);
    expect(view.getByText("post|3")).toBeTruthy();
    let node = text;
    while (typeof node.props.onPress !== "function" && node.parent) node = node.parent;
    const press: () => void = node.props.onPress;
    act(() => {
      press();
      press();
    });
    expect(fetchReflectionFeed).toHaveBeenCalledTimes(3);
    pending.resolve(page());
    await flush();
    expect(view.queryByText(strings[locale].reflectionFeedRetry)).toBeNull();
    expect(view.getByText("post|3")).toBeTruthy();
  });
  it("retires a confirmed comment delta before an authoritative count returns to its old value", async () => {
    const pending = deferred();
    jest.mocked(fetchReflectionFeed).mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    const view = screen();
    await waitFor(() => expect(view.getByText("post|3")).toBeTruthy());
    fireEvent.press(view.getByText("post|3"));
    fireEvent.press(view.getByTestId("confirmed-comment"));
    await waitFor(() => expect(view.getByText("post|4")).toBeTruthy());
    pending.resolve(page("post", 4));
    await flush();
    expect(view.getByText("post|4")).toBeTruthy();
    jest.mocked(fetchReflectionFeed).mockResolvedValue(page("post", 3));
    await act(async () => {
      await client.invalidateQueries({ queryKey: keys.feed.all });
    });
    await flush();
    expect(view.getByText("post|3")).toBeTruthy();
    expect(view.queryByText("post|4")).toBeNull();
  });
  it("retires a local comment delta after a successful unchanged-count reply", async () => {
    const pending = deferred();
    jest.mocked(fetchReflectionFeed).mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    const view = screen();
    await waitFor(() => expect(view.getByText("post|3")).toBeTruthy());
    fireEvent.press(view.getByText("post|3"));
    fireEvent.press(view.getByTestId("confirmed-comment"));
    await waitFor(() => expect(view.getByText("post|4")).toBeTruthy());
    pending.resolve(page("post", 3));
    await flush();
    expect(view.getByText("post|3")).toBeTruthy();
    expect(view.queryByText("post|4")).toBeNull();
  });
  it("does not carry a count delta into a different feed key with the same revision", async () => {
    const pending = deferred();
    jest
      .mocked(fetchReflectionFeed)
      .mockResolvedValueOnce(page())
      .mockImplementation((input) => (input.sort === "oldest" ? Promise.resolve(page()) : pending.promise));
    const view = screen();
    await waitFor(() => expect(view.getByText("post|3")).toBeTruthy());
    fireEvent.press(view.getByText("post|3"));
    fireEvent.press(view.getByTestId("confirmed-comment"));
    await waitFor(() => expect(view.getByText("post|4")).toBeTruthy());
    act(() => {
      client.setQueryData(keys.feed.list({ filter: { type: "all" }, sort: "oldest", searchTerm: "" }), {
        pages: [page()],
        pageParams: [0],
      });
    });
    fireEvent.press(view.getByLabelText(strings[locale].reflectionFeedSortBy));
    fireEvent.press(view.getByText(strings[locale].reflectionFeedSortOldest));
    await flush();
    expect(
      view.getByText(`${strings[locale].reflectionFeedSortBy}: ${strings[locale].reflectionFeedSortOldest}`),
    ).toBeTruthy();
    expect(view.getByText("post|3")).toBeTruthy();
    expect(view.queryByText("post|4")).toBeNull();
  });
  it("uses the refreshed server comment count without adding its local increment twice", async () => {
    const pending = deferred();
    jest.mocked(fetchReflectionFeed).mockResolvedValueOnce(page()).mockReturnValueOnce(pending.promise);
    const view = screen();
    await waitFor(() => expect(view.getByText("post|3")).toBeTruthy());
    fireEvent.press(view.getByText("post|3"));
    fireEvent.press(view.getByTestId("confirmed-comment"));
    await waitFor(() => expect(view.getByText("post|4")).toBeTruthy());
    pending.resolve(page("post", 4));
    await flush();
    await waitFor(() =>
      expect(
        client.getQueryData(keys.feed.list({ filter: { type: "all" }, sort: "newest", searchTerm: "" })),
      ).toMatchObject({ pages: [{ data: [{ comments_count: 4 }] }] }),
    );
    expect(view.getByText("post|4")).toBeTruthy();
    expect(view.queryByText("post|5")).toBeNull();
  });
});
