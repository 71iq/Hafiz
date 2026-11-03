import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { useAuthStore } from "@/lib/auth/store";
import { ReflectionsSection } from "@/components/reflections/ReflectionsSection";
import { fetchReflections } from "@/lib/reflections/api";
import type { Reflection } from "@/lib/reflections/types";
import { strings } from "@/lib/i18n/strings";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({ isDark: false, themeColors: { surfaceLow: "white" } }),
}));
jest.mock("@/lib/i18n/useStrings", () => ({
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings.en,
}));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true, supabase: {} }));
jest.mock("@/lib/reflections/api", () => ({ fetchReflections: jest.fn(), fetchReflectionCount: async () => 1 }));
jest.mock("@/components/reflections/WriteReflectionSheet", () => ({ WriteReflectionSheet: () => null }));
jest.mock("@/components/ui/Skeleton", () => ({ ReflectionsSkeleton: () => null }));
jest.mock("@/components/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("@/components/reflections/CommentsSheet", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    CommentsSheet: ({
      reflectionId,
      onCommentAdded,
    }: {
      reflectionId: string | null;
      onCommentAdded: (id: string) => void;
    }) =>
      reflectionId ? (
        <Pressable testID="add-comment" onPress={() => onCommentAdded(reflectionId)}>
          <Text>Add</Text>
        </Pressable>
      ) : null,
  };
});
jest.mock("@/components/reflections/ReflectionCard", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text, View, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ReflectionCard: ({
      reflection,
      onLikeToggled,
      onCommentsPress,
    }: {
      reflection: Reflection;
      onLikeToggled: (id: string, liked: boolean, delta: number) => void;
      onCommentsPress: (id: string) => void;
    }) => (
      <View>
        <Text
          testID={reflection.id}
        >{`${reflection.id}|liked:${reflection.user_has_liked}|comments:${reflection.comments_count}`}</Text>
        <Pressable
          testID={`like-${reflection.id}`}
          onPress={() => onLikeToggled(reflection.id, !reflection.user_has_liked, reflection.user_has_liked ? -1 : 1)}
        >
          <Text>Like</Text>
        </Pressable>
        <Pressable testID={`comments-${reflection.id}`} onPress={() => onCommentsPress(reflection.id)}>
          <Text>Comments</Text>
        </Pressable>
      </View>
    ),
  };
});
const user = (id: string): User => ({
  id,
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01",
});
const row = (liked: boolean, id = "synthetic-post"): Reflection => ({
  id,
  user_id: "synthetic-author",
  surah: 2,
  ayah_start: 1,
  ayah_end: 1,
  content: "Synthetic",
  likes_count: 1,
  comments_count: 0,
  status: "active",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  user_has_liked: liked,
});
type Page = { data: Reflection[]; hasMore: boolean };
const page = (liked: boolean, hasMore = false, id = "synthetic-post"): Page => ({ data: [row(liked, id)], hasMore });
const key = (id?: string, surah = 2, ayah = 1) => ["reflections", surah, ayah, 0, id];
function deferred() {
  let resolve: (data: Page) => void = () => {
    throw new Error("Missing deferred resolver");
  };
  const promise = new Promise<Page>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("reflection state follows active viewer and ayah", () => {
  let client: QueryClient;
  const screen = (surah = 2, ayah = 1) => (
    <QueryClientProvider client={client}>
      <ReflectionsSection surah={surah} ayah={ayah} initiallyExpanded />
    </QueryClientProvider>
  );
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ user: user("synthetic-a"), session: null, profile: null });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  });
  afterEach(() => {
    cleanup();
    client.clear();
    useAuthStore.setState({ user: null, session: null, profile: null });
    jest.restoreAllMocks();
  });
  it.each(["synthetic-b", undefined])("renders the fresh active cache after switching to %s", async (id) => {
    client.setQueryData(key(id), page(false));
    jest.mocked(fetchReflections).mockResolvedValue(page(true));
    const view = render(screen());
    await waitFor(() => expect(view.getByText("synthetic-post|liked:true|comments:0")).toBeTruthy());
    act(() => useAuthStore.setState({ user: id ? user(id) : null }));
    await waitFor(() => expect(view.getByText("synthetic-post|liked:false|comments:0")).toBeTruthy());
    expect(client.getQueryData(key(id))).toEqual(page(false));
    expect(fetchReflections).toHaveBeenCalledTimes(1);
  });
  it("late first-page A completion cannot overwrite active B rows", async () => {
    const a = deferred(),
      b = deferred();
    jest
      .mocked(fetchReflections)
      .mockImplementation((_s, _a, _p, id) => (id === "synthetic-a" ? a.promise : b.promise));
    const view = render(screen());
    await waitFor(() => expect(fetchReflections).toHaveBeenCalledWith(2, 1, 0, "synthetic-a"));
    act(() => useAuthStore.setState({ user: user("synthetic-b") }));
    await waitFor(() => expect(fetchReflections).toHaveBeenCalledWith(2, 1, 0, "synthetic-b"));
    await act(async () => {
      b.resolve(page(false));
    });
    await waitFor(() => expect(view.getByText("synthetic-post|liked:false|comments:0")).toBeTruthy());
    await act(async () => {
      a.resolve(page(true));
    });
    expect(view.getByText("synthetic-post|liked:false|comments:0")).toBeTruthy();
    expect(client.getQueryData(key("synthetic-b"))).toEqual(page(false));
  });
  it("renders fresh cached rows and appends manual pagination without losing them", async () => {
    client.setQueryData(key("synthetic-a"), page(true, true));
    jest.mocked(fetchReflections).mockResolvedValue(page(false, false, "second-page"));
    const view = render(screen());
    expect(view.getByText("synthetic-post|liked:true|comments:0")).toBeTruthy();
    fireEvent.press(view.getByText(strings.en.reflectionLoadMore));
    await waitFor(() => expect(view.getByTestId("second-page")).toBeTruthy());
    expect(view.getByTestId("synthetic-post")).toBeTruthy();
    expect(fetchReflections).toHaveBeenCalledWith(2, 1, 1, "synthetic-a");
    expect(client.getQueryData(key("synthetic-a"))).toEqual(page(true, true));
  });
  it("late manual A pagination cannot append after B has loaded its own rows", async () => {
    const extra = deferred();
    jest.mocked(fetchReflections).mockImplementation((_surah, _ayah, pageNumber, id) => {
      if (id === "synthetic-a") return pageNumber === 0 ? Promise.resolve(page(true, true)) : extra.promise;
      return Promise.resolve(page(false));
    });
    const view = render(screen());
    await waitFor(() => expect(view.getByText(strings.en.reflectionLoadMore)).toBeTruthy());
    fireEvent.press(view.getByText(strings.en.reflectionLoadMore));
    await waitFor(() => expect(fetchReflections).toHaveBeenCalledWith(2, 1, 1, "synthetic-a"));
    act(() => useAuthStore.setState({ user: user("synthetic-b") }));
    await waitFor(() => expect(view.getByText("synthetic-post|liked:false|comments:0")).toBeTruthy());
    await act(async () => {
      extra.resolve(page(true, false, "late-a-row"));
    });
    expect(view.queryByTestId("late-a-row")).toBeNull();
    expect(view.getByText("synthetic-post|liked:false|comments:0")).toBeTruthy();
  });
  it("ayah change uses its fresh cache instead of the preceding target's rows", async () => {
    client.setQueryData(key("synthetic-a", 3, 5), page(false, false, "next-ayah"));
    jest.mocked(fetchReflections).mockResolvedValue(page(true));
    const view = render(screen());
    await waitFor(() => expect(view.getByTestId("synthetic-post")).toBeTruthy());
    view.rerender(screen(3, 5));
    await waitFor(() => expect(view.getByTestId("next-ayah")).toBeTruthy());
    expect(view.queryByTestId("synthetic-post")).toBeNull();
  });
  it("like and comment callbacks retain cached base rows without mutating Query data", () => {
    client.setQueryData(key("synthetic-a"), page(true));
    const view = render(screen());
    fireEvent.press(view.getByTestId("like-synthetic-post"));
    expect(view.getByText("synthetic-post|liked:false|comments:0")).toBeTruthy();
    fireEvent.press(view.getByTestId("comments-synthetic-post"));
    fireEvent.press(view.getByTestId("add-comment"));
    expect(view.getByText("synthetic-post|liked:false|comments:1")).toBeTruthy();
    expect(client.getQueryData(key("synthetic-a"))).toEqual(page(true));
  });
  it("refetch retains existing first-page replacement behavior after manual pages", async () => {
    jest
      .mocked(fetchReflections)
      .mockResolvedValueOnce(page(true, true))
      .mockResolvedValueOnce(page(true, false, "second-page"))
      .mockResolvedValueOnce(page(false));
    const view = render(screen());
    await waitFor(() => expect(view.getByText(strings.en.reflectionLoadMore)).toBeTruthy());
    fireEvent.press(view.getByText(strings.en.reflectionLoadMore));
    await waitFor(() => expect(view.getByTestId("second-page")).toBeTruthy());
    await act(async () => {
      await client.invalidateQueries({ queryKey: key("synthetic-a"), exact: true });
    });
    await waitFor(() => expect(view.getByText("synthetic-post|liked:false|comments:0")).toBeTruthy());
    expect(view.queryByTestId("second-page")).toBeNull();
  });
  it("manual-page failure retains rows and supports the existing retry", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest
      .mocked(fetchReflections)
      .mockResolvedValueOnce(page(true, true))
      .mockRejectedValueOnce(new Error("Synthetic page failure"))
      .mockResolvedValueOnce(page(true, false, "retry-row"));
    const view = render(screen());
    await waitFor(() => expect(view.getByText(strings.en.reflectionLoadMore)).toBeTruthy());
    fireEvent.press(view.getByText(strings.en.reflectionLoadMore));
    await waitFor(() => expect(view.getByText(strings.en.reflectionLoadFailed)).toBeTruthy());
    expect(view.getByTestId("synthetic-post")).toBeTruthy();
    fireEvent.press(view.getByText(strings.en.reflectionLoadMore));
    await waitFor(() => expect(view.getByTestId("retry-row")).toBeTruthy());
    expect(view.queryByText(strings.en.reflectionLoadFailed)).toBeNull();
  });
  it("resets expansion and open comments on viewer changes", async () => {
    client.setQueryData(key("synthetic-a"), page(true));
    client.setQueryData(key("synthetic-b"), page(false));
    const view = render(
      <QueryClientProvider client={client}>
        <ReflectionsSection surah={2} ayah={1} />
      </QueryClientProvider>,
    );
    expect(view.queryByTestId("synthetic-post")).toBeNull();
    fireEvent.press(view.getByText(strings.en.reflections));
    expect(view.getByTestId("synthetic-post")).toBeTruthy();
    fireEvent.press(view.getByTestId("comments-synthetic-post"));
    expect(view.getByTestId("add-comment")).toBeTruthy();
    act(() => useAuthStore.setState({ user: user("synthetic-b") }));
    expect(view.queryByTestId("add-comment")).toBeNull();
    expect(view.queryByTestId("synthetic-post")).toBeNull();
    fireEvent.press(view.getByText(strings.en.reflections));
    await waitFor(() => expect(view.getByText("synthetic-post|liked:false|comments:0")).toBeTruthy());
  });
});
