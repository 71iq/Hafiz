import React, { type ReactNode } from "react";
import * as RN from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import type { SQLiteDatabase } from "expo-sqlite";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MoreHorizontal } from "lucide-react-native";
import { DirectionProvider } from "@/lib/ui/direction";
import { useAuthStore } from "@/lib/auth/store";
import { ReflectionCard } from "@/components/reflections/ReflectionCard";
import { CommentsSheet } from "@/components/reflections/CommentsSheet";
import { WriteReflectionSheet } from "@/components/reflections/WriteReflectionSheet";
import { profilePrivacyKeys } from "@/lib/profile/privacy";
import {
  addComment,
  createReflection,
  fetchComments,
  reportReflection,
  toggleCommentLike,
  toggleLike,
} from "@/lib/reflections/api";
import type { Reflection, ReflectionComment } from "@/lib/reflections/types";
import { SavedRowUnreadableError } from "@/lib/reflections/rows";
import { ReflectionPrivacyChangedError } from "@/lib/reflections/errors";
import { reflectionQueryKeys as keys } from "@/lib/reflections/query-keys";
import { strings } from "@/lib/i18n/strings";
import { loadMushafIndex, type MushafIndex } from "@/lib/mushaf/position";
import { recordAchievementEvent } from "@/lib/achievements/queries";

let mockLocale: "en" | "ar" = "en";
const firstDb = {} as SQLiteDatabase,
  secondDb = {} as SQLiteDatabase;
let mockDb = firstDb;
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));
jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true, supabase: {} }));
jest.mock("@/lib/haptics", () => ({ hapticLight: jest.fn() }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/mushaf/position", () => ({
  ...jest.requireActual("@/lib/mushaf/position"),
  loadMushafIndex: jest.fn(),
}));
jest.mock("@/lib/achievements/queries", () => ({ recordAchievementEvent: jest.fn() }));
jest.mock("@/lib/reflections/api", () => ({
  addComment: jest.fn(),
  createReflection: jest.fn(),
  fetchComments: jest.fn(),
  reportReflection: jest.fn(),
  toggleCommentLike: jest.fn(),
  toggleLike: jest.fn(),
}));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    isDark: false,
    isRTL: mockLocale === "ar",
    uiLanguage: mockLocale,
    themeColors: { surfaceLow: "white", surfaceMid: "white", surfaceBright: "white", surfaceHigh: "white" },
  }),
}));
jest.mock("@/lib/i18n/useStrings", () => ({
  ...jest.requireActual("@/lib/i18n/useStrings"),
  useStrings: () => jest.requireActual<typeof import("@/lib/i18n/strings")>("@/lib/i18n/strings").strings[mockLocale],
}));
jest.mock("@/components/profile/ProfileIdentity", () => ({ ProfileIdentity: () => null }));
jest.mock("@/components/ui/Input", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { TextInput } = jest.requireActual<typeof import("react-native")>("react-native");
  return { Input: (props: React.ComponentProps<typeof TextInput>) => <TextInput {...props} /> };
});
jest.mock("@/components/ui/ResponsiveOverlay", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View, Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ResponsiveSheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <View>{children}</View> : null,
    OverlayBody: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    OverlayHeader: ({ onClose }: { onClose: () => void }) => (
      <Pressable testID="close-sheet" onPress={onClose}>
        <Text>Close fixture</Text>
      </Pressable>
    ),
  };
});

const user = (id: number): User => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01",
});
const session = (id: number): Session => ({
  user: user(id),
  access_token: [
    "e30",
    Buffer.from(
      JSON.stringify({ sub: user(id).id, session_id: `10000000-0000-4000-8000-${String(id).padStart(12, "0")}` }),
    ).toString("base64url"),
    "c2ln",
  ].join("."),
  refresh_token: "synthetic",
  token_type: "bearer",
  expires_in: 3600,
});
const post = (id = "post", count = 11): Reflection => ({
  id,
  user_id: user(3).id,
  surah: 2,
  ayah_start: 1,
  ayah_end: 2,
  juz_start: 3,
  juz_end: 3,
  content: "Synthetic reflection",
  likes_count: count,
  comments_count: 3,
  user_has_liked: false,
  status: "active",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
});
const comment = (id = "comment", count = 17): ReflectionComment => ({
  id,
  reflection_id: "post",
  user_id: user(3).id,
  content: `Synthetic ${id}`,
  likes_count: count,
  user_has_liked: false,
  created_at: "2026-01-01",
});
const minorPrivacy = {
  boardJoined: false,
  boardNickname: null,
  showStreak: false,
  showJuzCompletions: false,
  isMinor: true,
};
const index: MushafIndex = {
  juzRows: [{ juz: 3, surah: 2, ayah_start: 1, ayah_end: 286 }],
  hizbRows: [],
  surahByNumber: new Map(),
  pageByNumber: new Map(),
};
let client: QueryClient;
const drainers = new Set<() => void>();
function deferred<T>(fallback: T) {
  let accept!: (value: T) => void, decline!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    accept = resolve;
    decline = reject;
  });
  const drain = () => accept(fallback);
  drainers.add(drain);
  return {
    promise,
    resolve: (value: T) => {
      drainers.delete(drain);
      accept(value);
    },
    reject: (error: Error) => {
      drainers.delete(drain);
      decline(error);
    },
  };
}
function activate(id: number) {
  const value = session(id);
  useAuthStore.setState({ user: value.user, session: value, profile: null, isLoading: false, error: null });
}
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <DirectionProvider dir={mockLocale === "ar" ? "rtl" : "ltr"}>{children}</DirectionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
function button(node: ReturnType<typeof render>["root"]) {
  let current = node;
  while (typeof current.props.onPress !== "function" && current.parent) current = current.parent;
  if (typeof current.props.onPress !== "function") throw new Error("No pressable ancestor");
  return current;
}
function twice(node: ReturnType<typeof render>["root"]) {
  const press: () => void = button(node).props.onPress;
  act(() => {
    press();
    press();
  });
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  activate(1);
  mockDb = firstDb;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  jest.spyOn(RN, "useWindowDimensions").mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.mocked(fetchComments).mockResolvedValue({ data: [comment(), comment("second", 29)], hasMore: false });
  jest.mocked(addComment).mockResolvedValue(comment("new"));
  jest.mocked(createReflection).mockResolvedValue(post("new"));
  jest.mocked(toggleLike).mockImplementation(async (_u, _p, liked) => !liked);
  jest.mocked(toggleCommentLike).mockImplementation(async (_u, _p, liked) => !liked);
  jest.mocked(reportReflection).mockResolvedValue();
  jest.mocked(loadMushafIndex).mockResolvedValue(index);
  jest.mocked(recordAchievementEvent).mockResolvedValue();
});
afterEach(async () => {
  cleanup();
  for (const drain of drainers) drain();
  drainers.clear();
  await flush();
  client.clear();
  useAuthStore.setState({ user: null, session: null, profile: null });
  jest.restoreAllMocks();
});

describe.each(["en", "ar"] as const)("community writes in %s phone", (locale) => {
  beforeEach(() => {
    mockLocale = locale;
  });
  it.each(["compact", "feed"] as const)("keeps every %s card row explicit under ambient direction", (variant) => {
    const view = render(
      <ReflectionCard reflection={post()} variant={variant} onLikeToggled={jest.fn()} onCommentsPress={jest.fn()} />,
      { wrapper },
    );
    fireEvent.press(view.UNSAFE_getByType(MoreHorizontal));
    const rows = view.root.findAll(
      (node) => typeof node.props.className === "string" && /\bflex-row(?:-reverse)?\b/.test(node.props.className),
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      const style = typeof row.props.style === "function" ? row.props.style({ pressed: false }) : row.props.style;
      expect(RN.StyleSheet.flatten(style)).toMatchObject({
        direction: "ltr",
        flexDirection: locale === "ar" ? "row-reverse" : "row",
      });
    }
    expect(RN.StyleSheet.flatten(view.getByText(post().content).props.style)).toMatchObject({
      textAlign: locale === "ar" ? "right" : "left",
      writingDirection: locale === "ar" ? "rtl" : "ltr",
    });
  });
  it("admits one same-turn like and restores retry after failure", async () => {
    const pending = deferred(false),
      changed = jest.fn();
    jest.mocked(toggleLike).mockReturnValueOnce(pending.promise);
    const view = render(
      <ReflectionCard reflection={post()} variant="feed" onLikeToggled={changed} onCommentsPress={jest.fn()} />,
      { wrapper },
    );
    twice(view.getByText("11"));
    expect(toggleLike).toHaveBeenCalledTimes(1);
    expect(view.getByText("12")).toBeTruthy();
    pending.reject(new Error("synthetic like rejected"));
    await flush();
    expect(view.getByText("11")).toBeTruthy();
    expect(view.getByText(strings[locale].reflectionLikeFailed)).toBeTruthy();
    expect(changed).not.toHaveBeenCalled();
    fireEvent.press(view.getByText("11"));
    await flush();
    expect(toggleLike).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith("post", true, 1);
  });
  it("failed like restores fresh canonical counts instead of subtracting from them", async () => {
    const pending = deferred(false),
      changed = jest.fn();
    jest.mocked(toggleLike).mockReturnValue(pending.promise);
    const screen = (count: number) => (
      <ReflectionCard
        reflection={post("post", count)}
        variant="feed"
        onLikeToggled={changed}
        onCommentsPress={jest.fn()}
      />
    );
    const view = render(screen(11), { wrapper });
    fireEvent.press(view.getByText("11"));
    view.rerender(screen(30));
    await flush();
    pending.reject(new Error("synthetic like rejected"));
    await flush();
    expect(view.getByText("30")).toBeTruthy();
    expect(view.queryByText("29")).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });
  it("admits one comment across duplicate Enter events and keeps it after close/reopen", async () => {
    const pending = deferred(comment("new")),
      added = jest.fn();
    jest.mocked(addComment).mockReturnValue(pending.promise);
    const screen = (id: string | null) => (
      <CommentsSheet reflectionId={id} onClose={jest.fn()} onCommentAdded={added} />
    );
    const view = render(screen("post"), { wrapper });
    await waitFor(() => expect(view.getByText("Synthetic comment")).toBeTruthy());
    const input = view.getByPlaceholderText(strings[locale].reflectionAddComment);
    fireEvent.changeText(input, "  New comment  ");
    act(() => {
      fireEvent(input, "submitEditing");
      fireEvent(input, "keyPress", { nativeEvent: { key: "Enter" } });
    });
    expect(addComment).toHaveBeenCalledTimes(1);
    expect(addComment).toHaveBeenCalledWith(user(1).id, "post", "New comment", false);
    jest.mocked(fetchComments).mockResolvedValue({ data: [comment(), comment("new")], hasMore: false });
    pending.resolve(comment("new"));
    await flush();
    expect(added).toHaveBeenCalledTimes(1);
    view.rerender(screen(null));
    view.rerender(screen("post"));
    await waitFor(() => expect(view.getByText("Synthetic new")).toBeTruthy());
    expect(fetchComments).toHaveBeenCalledTimes(2);
  });
  it("serializes each comment like independently before React updates busy state", async () => {
    const one = deferred(false),
      two = deferred(true);
    jest.mocked(toggleCommentLike).mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
    const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, {
      wrapper,
    });
    await waitFor(() => expect(view.getByText("17")).toBeTruthy());
    const pressOne: () => void = button(view.getByText("17")).props.onPress,
      pressTwo: () => void = button(view.getByText("29")).props.onPress;
    act(() => {
      pressOne();
      pressOne();
      pressTwo();
    });
    expect(toggleCommentLike).toHaveBeenCalledTimes(2);
    one.reject(new Error("first like rejected"));
    two.resolve(true);
    await flush();
    expect(view.getByText("17")).toBeTruthy();
    expect(view.getByText(strings[locale].reflectionLikeFailed)).toBeTruthy();
  });
  it("admits one public post before the Mushaf index finishes loading", async () => {
    const pending = deferred(index);
    jest.mocked(loadMushafIndex).mockReturnValue(pending.promise);
    const close = jest.fn(),
      success = jest.fn();
    const view = render(
      <WriteReflectionSheet open surah={2} ayahStart={1} ayahEnd={2} onClose={close} onSuccess={success} />,
      { wrapper },
    );
    fireEvent.changeText(
      view.getByPlaceholderText(strings[locale].reflectionPlaceholder),
      "  Synthetic public reflection  ",
    );
    twice(view.getByText(strings[locale].reflectionSubmit));
    expect(loadMushafIndex).toHaveBeenCalledTimes(1);
    pending.resolve(index);
    await flush();
    expect(createReflection).toHaveBeenCalledTimes(1);
    expect(createReflection).toHaveBeenCalledWith(
      user(1).id,
      2,
      1,
      2,
      3,
      3,
      "Synthetic public reflection",
      false,
      expect.any(Function),
    );
    expect(recordAchievementEvent).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledTimes(1);
  });
  it("tells an account under 18 that its reflections are visible only to it (ETH-07)", async () => {
    const sheet = <WriteReflectionSheet open surah={2} ayahStart={1} ayahEnd={1} onClose={jest.fn()} />;
    const adult = render(sheet, { wrapper });
    expect(adult.queryByText(strings[locale].reflectionMinorPrivate)).toBeNull();
    adult.unmount();
    client.setQueryData(profilePrivacyKeys.mine(user(1).id), {
      boardJoined: false,
      boardNickname: null,
      showStreak: false,
      showJuzCompletions: false,
      isMinor: true,
    });
    const minor = render(sheet, { wrapper });
    expect(minor.getByText(strings[locale].reflectionMinorPrivate)).toBeTruthy();
    expect(minor.getByPlaceholderText(strings[locale].reflectionPlaceholderPrivate)).toBeTruthy();
  });
  it("sends the privacy the composer promised and posts nothing when the account is no longer a minor (ETH-07)", async () => {
    const privacyKey = profilePrivacyKeys.mine(user(1).id);
    client.setQueryData(privacyKey, minorPrivacy);
    jest.mocked(createReflection).mockRejectedValue(new ReflectionPrivacyChangedError());
    const close = jest.fn(),
      success = jest.fn();
    const view = render(
      <WriteReflectionSheet open surah={2} ayahStart={1} ayahEnd={2} onClose={close} onSuccess={success} />,
      { wrapper },
    );
    fireEvent.changeText(view.getByPlaceholderText(strings[locale].reflectionPlaceholderPrivate), "A private thought");
    fireEvent.press(view.getByText(strings[locale].reflectionSubmit));
    await flush();
    expect(createReflection).toHaveBeenCalledWith(user(1).id, 2, 1, 2, 3, 3, "A private thought", true, expect.any(Function));
    expect(view.getByText(strings[locale].reflectionPrivacyChanged).props.accessibilityRole).toBe("alert");
    // The private note would contradict the message, so it waits while the message shows.
    expect(view.queryByText(strings[locale].reflectionMinorPrivate)).toBeNull();
    expect(client.getQueryState(privacyKey)?.isInvalidated).toBe(true);
    expect(view.getByDisplayValue("A private thought")).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(recordAchievementEvent).not.toHaveBeenCalled();
  });
  it("sends the privacy the comment input promised and posts nothing when the account is no longer a minor (ETH-07)", async () => {
    const privacyKey = profilePrivacyKeys.mine(user(1).id);
    client.setQueryData(privacyKey, minorPrivacy);
    jest.mocked(addComment).mockRejectedValue(new ReflectionPrivacyChangedError());
    const added = jest.fn();
    const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={added} />, { wrapper });
    await waitFor(() => expect(view.getByText("Synthetic comment")).toBeTruthy());
    expect(view.getByText(strings[locale].reflectionMinorPrivate)).toBeTruthy();
    const input = view.getByPlaceholderText(strings[locale].reflectionAddComment);
    fireEvent.changeText(input, "A private comment");
    fireEvent(input, "submitEditing");
    await flush();
    expect(addComment).toHaveBeenCalledWith(user(1).id, "post", "A private comment", true);
    // Shown above the input, where the person is looking, in place of the private note.
    expect(view.getByText(strings[locale].commentPrivacyChanged).props.accessibilityRole).toBe("alert");
    expect(view.queryByText(strings[locale].reflectionMinorPrivate)).toBeNull();
    expect(view.queryByText(strings[locale].commentPostFailed)).toBeNull();
    expect(client.getQueryState(privacyKey)?.isInvalidated).toBe(true);
    expect(view.getByDisplayValue("A private comment")).toBeTruthy();
    expect(added).not.toHaveBeenCalled();
  });
  it("does not dispatch a public post after its index wait loses the source", async () => {
    const pending = deferred(index);
    jest.mocked(loadMushafIndex).mockReturnValue(pending.promise);
    const close = jest.fn();
    const screen = (ayah: number) => (
      <WriteReflectionSheet open surah={2} ayahStart={ayah} ayahEnd={ayah} onClose={close} />
    );
    const view = render(screen(1), { wrapper });
    fireEvent.changeText(
      view.getByPlaceholderText(strings[locale].reflectionPlaceholder),
      "Synthetic public reflection",
    );
    fireEvent.press(view.getByText(strings[locale].reflectionSubmit));
    view.rerender(screen(2));
    pending.resolve(index);
    await flush();
    expect(createReflection).not.toHaveBeenCalled();
    expect(recordAchievementEvent).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
  it("old like cleanup cannot clear a new account's busy lease or publish its failure", async () => {
    const old = deferred(false),
      newer = deferred(true),
      changed = jest.fn();
    jest.mocked(toggleLike).mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    const view = render(
      <ReflectionCard reflection={post()} variant="feed" onLikeToggled={changed} onCommentsPress={jest.fn()} />,
      { wrapper },
    );
    fireEvent.press(view.getByText("11"));
    act(() => activate(2));
    await flush();
    fireEvent.press(view.getByText("11"));
    expect(toggleLike).toHaveBeenCalledTimes(2);
    old.reject(new Error("old account error"));
    await flush();
    expect(view.queryByText(strings[locale].reflectionLikeFailed)).toBeNull();
    expect(button(view.getByText("12")).props.disabled).toBe(true);
    newer.resolve(true);
    await flush();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith("post", true, 1);
  });
});

it.each(["account", "ABA", "target", "close", "database", "unmount"] as const)(
  "issued public-post reply cannot publish after %s retirement",
  async (retirement) => {
    mockLocale = "en";
    const pending = deferred(post("new")),
      close = jest.fn(),
      success = jest.fn();
    jest.mocked(createReflection).mockReturnValue(pending.promise);
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const screen = (ayah = 1, open = true) => (
      <WriteReflectionSheet open={open} surah={2} ayahStart={ayah} ayahEnd={ayah} onClose={close} onSuccess={success} />
    );
    const view = render(screen(), { wrapper });
    fireEvent.changeText(view.getByPlaceholderText(strings.en.reflectionPlaceholder), "Original synthetic draft");
    fireEvent.press(view.getByText(strings.en.reflectionSubmit));
    await waitFor(() => expect(createReflection).toHaveBeenCalledTimes(1));
    if (retirement === "account" || retirement === "ABA") {
      act(() => activate(2));
      if (retirement === "ABA") act(() => activate(1));
    }
    if (retirement === "target") view.rerender(screen(2));
    if (retirement === "close") {
      fireEvent.press(view.getByTestId("close-sheet"));
      view.rerender(screen(1, false));
      view.rerender(screen());
    }
    if (retirement === "database") {
      mockDb = secondDb;
      view.rerender(screen());
    }
    if (retirement === "unmount") view.unmount();
    if (retirement !== "unmount")
      fireEvent.changeText(view.getByPlaceholderText(strings.en.reflectionPlaceholder), "Current replacement draft");
    expect(jest.mocked(createReflection).mock.calls[0][8]?.()).toBe(false);
    pending.resolve(post("new"));
    await flush();
    expect(recordAchievementEvent).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(retirement === "close" ? 1 : 0);
    if (retirement !== "unmount")
      expect(view.getByPlaceholderText(strings.en.reflectionPlaceholder).props.value).toBe("Current replacement draft");
  },
);

it("public-post failure retains its draft, enables editing and retries with the same source", async () => {
  mockLocale = "ar";
  const pending = deferred(post("new")),
    close = jest.fn();
  jest.mocked(createReflection).mockReturnValueOnce(pending.promise);
  const view = render(<WriteReflectionSheet open surah={2} ayahStart={1} ayahEnd={2} onClose={close} />, { wrapper });
  const draft = "Synthetic retained draft";
  fireEvent.changeText(view.getByPlaceholderText(strings.ar.reflectionPlaceholder), draft);
  fireEvent.press(view.getByText(strings.ar.reflectionSubmit));
  await waitFor(() => expect(createReflection).toHaveBeenCalledTimes(1));
  expect(view.getByPlaceholderText(strings.ar.reflectionPlaceholder).props.editable).toBe(false);
  pending.reject(new Error("synthetic post rejected"));
  await flush();
  expect(view.getByText("synthetic post rejected")).toBeTruthy();
  expect(view.getByPlaceholderText(strings.ar.reflectionPlaceholder).props.value).toBe(draft);
  expect(view.getByPlaceholderText(strings.ar.reflectionPlaceholder).props.editable).toBe(true);
  fireEvent.press(view.getByText(strings.ar.reflectionSubmit));
  await flush();
  expect(createReflection).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(1);
});

it.each(["en", "ar"] as const)(
  "a saved post whose reply cannot be read closes as posted without a retry (%s)",
  async (locale) => {
    mockLocale = locale;
    const close = jest.fn(),
      success = jest.fn(),
      invalidate = jest.spyOn(client, "invalidateQueries");
    jest.mocked(createReflection).mockRejectedValueOnce(new SavedRowUnreadableError("reflection"));
    const view = render(
      <WriteReflectionSheet open surah={2} ayahStart={1} ayahEnd={1} onClose={close} onSuccess={success} />,
      { wrapper },
    );
    fireEvent.changeText(view.getByPlaceholderText(strings[locale].reflectionPlaceholder), "Synthetic saved post");
    fireEvent.press(view.getByText(strings[locale].reflectionSubmit));
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.feed.all });
    expect(view.queryByText(strings[locale].reflectionPostFailed)).toBeNull();
    expect(recordAchievementEvent).not.toHaveBeenCalled();
    expect(createReflection).toHaveBeenCalledTimes(1);
  },
);

it.each(["en", "ar"] as const)(
  "a saved comment whose reply cannot be read clears the draft and refetches (%s)",
  async (locale) => {
    mockLocale = locale;
    const added = jest.fn(),
      invalidate = jest.spyOn(client, "invalidateQueries");
    jest.mocked(addComment).mockRejectedValueOnce(new SavedRowUnreadableError("comment"));
    const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={added} />, {
      wrapper,
    });
    await waitFor(() => expect(view.getByText("Synthetic comment")).toBeTruthy());
    const input = view.getByPlaceholderText(strings[locale].reflectionAddComment);
    fireEvent.changeText(input, "Synthetic saved comment");
    fireEvent(input, "submitEditing");
    await flush();
    expect(input.props.value).toBe("");
    expect(added).toHaveBeenCalledWith("post");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.comments.forReflection("post") });
    expect(view.queryByText(strings[locale].commentPostFailed)).toBeNull();
  },
);

it("comments preserve newly typed text while a prior submitted snapshot finishes", async () => {
  mockLocale = "en";
  const pending = deferred(comment("new"));
  jest.mocked(addComment).mockReturnValue(pending.promise);
  const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, {
    wrapper,
  });
  await waitFor(() => expect(view.getByText("Synthetic comment")).toBeTruthy());
  const input = view.getByPlaceholderText(strings.en.reflectionAddComment);
  fireEvent.changeText(input, "Submitted draft");
  fireEvent(input, "submitEditing");
  fireEvent.changeText(input, "Next draft");
  pending.resolve(comment("new"));
  await flush();
  expect(input.props.value).toBe("Next draft");
  expect(addComment).toHaveBeenCalledWith(user(1).id, "post", "Submitted draft", false);
});

it("comment likes restore new canonical query rows after failure and invalidate only that post on success", async () => {
  mockLocale = "en";
  const pending = deferred(false);
  jest.mocked(toggleCommentLike).mockReturnValueOnce(pending.promise);
  const other = keys.comments.list({ reflectionId: "other", sort: "oldest", viewerId: user(1).id }),
    target = keys.comments.list({ reflectionId: "post", sort: "popular", viewerId: user(2).id });
  client.setQueryData(other, 1);
  client.setQueryData(target, 1);
  const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, {
    wrapper,
  });
  await waitFor(() => expect(view.getByText("17")).toBeTruthy());
  fireEvent.press(view.getByText("17"));
  act(() =>
    client.setQueryData(keys.comments.list({ reflectionId: "post", sort: "oldest", viewerId: user(1).id }), {
      pages: [{ data: [comment("comment", 30)], hasMore: false }],
      pageParams: [0],
    }),
  );
  await waitFor(() => expect(view.getByText("30")).toBeTruthy());
  pending.reject(new Error("like rejected"));
  await flush();
  expect(view.getByText("30")).toBeTruthy();
  expect(client.getQueryState(target)?.isInvalidated).toBe(false);
  fireEvent.press(view.getByText("30"));
  await flush();
  expect(client.getQueryState(target)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});

it("a comment completion after closed ABA cannot clear a new draft, append or invalidate", async () => {
  mockLocale = "en";
  const pending = deferred(comment("new")),
    added = jest.fn();
  jest.mocked(addComment).mockReturnValue(pending.promise);
  const screen = (id: string | null) => <CommentsSheet reflectionId={id} onClose={jest.fn()} onCommentAdded={added} />;
  const view = render(screen("post"), { wrapper });
  await waitFor(() => expect(view.getByText("Synthetic comment")).toBeTruthy());
  fireEvent.changeText(view.getByPlaceholderText(strings.en.reflectionAddComment), "Old draft");
  fireEvent(view.getByPlaceholderText(strings.en.reflectionAddComment), "submitEditing");
  view.rerender(screen(null));
  view.rerender(screen("post"));
  fireEvent.changeText(view.getByPlaceholderText(strings.en.reflectionAddComment), "New draft");
  const invalidate = jest.spyOn(client, "invalidateQueries");
  pending.resolve(comment("new"));
  await flush();
  expect(added).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  expect(view.queryByText("Synthetic new")).toBeNull();
  expect(view.getByPlaceholderText(strings.en.reflectionAddComment).props.value).toBe("New draft");
});

it("a failed comment retains its draft and retries without duplicate writes", async () => {
  mockLocale = "ar";
  const pending = deferred(comment("new")),
    added = jest.fn();
  jest.mocked(addComment).mockReturnValueOnce(pending.promise);
  const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={added} />, { wrapper });
  await waitFor(() => expect(view.getByText("Synthetic comment")).toBeTruthy());
  const input = view.getByPlaceholderText(strings.ar.reflectionAddComment);
  fireEvent.changeText(input, "Synthetic draft");
  fireEvent(input, "submitEditing");
  pending.reject(new Error("comment rejected"));
  await flush();
  expect(input.props.value).toBe("Synthetic draft");
  expect(view.getByText(strings.ar.commentPostFailed)).toBeTruthy();
  fireEvent(input, "submitEditing");
  await flush();
  expect(addComment).toHaveBeenCalledTimes(2);
  expect(added).toHaveBeenCalledTimes(1);
});

it("confirmed unlike updates only the affected ayahs and feed caches", async () => {
  mockLocale = "en";
  const changed = jest.fn(),
    source = { ...post(), user_has_liked: true };
  const affected = keys.reflections.firstPage({ surah: 2, ayah: 2, viewerId: user(2).id }),
    unrelated = keys.reflections.firstPage({ surah: 2, ayah: 3, viewerId: user(1).id }),
    publicCount = keys.count({ surah: 2, ayah: 1 }),
    feed = keys.feed.list({ filter: { type: "all" }, sort: "newest", searchTerm: "" });
  [affected, unrelated, publicCount, feed].forEach((key) => client.setQueryData(key, 1));
  const view = render(
    <ReflectionCard reflection={source} variant="feed" onLikeToggled={changed} onCommentsPress={jest.fn()} />,
    { wrapper },
  );
  fireEvent.press(view.getByText("11"));
  await flush();
  expect(toggleLike).toHaveBeenCalledWith(user(1).id, "post", true);
  expect(view.getByText("10")).toBeTruthy();
  expect(changed).toHaveBeenCalledWith("post", false, -1);
  expect(client.getQueryState(affected)?.isInvalidated).toBe(true);
  expect(client.getQueryState(feed)?.isInvalidated).toBe(true);
  expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  expect(client.getQueryState(publicCount)?.isInvalidated).toBe(false);
});

it("reporting has independent synchronous admission and recovers after rejection", async () => {
  mockLocale = "en";
  const pending = deferred<void>(undefined);
  jest.mocked(reportReflection).mockReturnValueOnce(pending.promise);
  const view = render(
    <ReflectionCard reflection={post()} variant="feed" onLikeToggled={jest.fn()} onCommentsPress={jest.fn()} />,
    { wrapper },
  );
  fireEvent.press(view.UNSAFE_getByType(MoreHorizontal));
  twice(view.getByText(strings.en.reflectionReport));
  expect(reportReflection).toHaveBeenCalledTimes(1);
  pending.reject(new Error("report rejected"));
  await flush();
  expect(view.getByText(strings.en.reflectionReportFailed)).toBeTruthy();
  fireEvent.press(view.UNSAFE_getByType(MoreHorizontal));
  fireEvent.press(view.getByText(strings.en.reflectionReport));
  await flush();
  expect(reportReflection).toHaveBeenCalledTimes(2);
  fireEvent.press(view.UNSAFE_getByType(MoreHorizontal));
  expect(button(view.getByText(strings.en.reflectionReported)).props.disabled).toBe(true);
});

it("an old callback cannot capture a new account before React commits its replacement render", () => {
  mockLocale = "en";
  const view = render(
    <ReflectionCard reflection={post()} variant="feed" onLikeToggled={jest.fn()} onCommentsPress={jest.fn()} />,
    { wrapper },
  );
  const press: () => void = button(view.getByText("11")).props.onPress;
  act(() => {
    activate(2);
    press();
  });
  expect(toggleLike).not.toHaveBeenCalled();
});

it("same-user session replacement removes the prior optimistic comment preview", async () => {
  mockLocale = "en";
  const pending = deferred(false);
  jest.mocked(toggleCommentLike).mockReturnValue(pending.promise);
  const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, {
    wrapper,
  });
  await waitFor(() => expect(view.getByText("17")).toBeTruthy());
  fireEvent.press(view.getByText("17"));
  expect(view.getByText("18")).toBeTruthy();
  const next = session(1),
    parts = next.access_token.split(".");
  parts[1] = Buffer.from(
    JSON.stringify({ sub: user(1).id, session_id: "10000000-0000-4000-8000-000000000009" }),
  ).toString("base64url");
  next.access_token = parts.join(".");
  act(() => useAuthStore.setState({ session: next, user: next.user }));
  await flush();
  expect(view.getByText("17")).toBeTruthy();
  expect(view.queryByText("18")).toBeNull();
  pending.resolve(true);
  await flush();
});

it("a confirmed comment like rebases fresh counts before another press", async () => {
  mockLocale = "en";
  const pending = deferred(true),
    refetch = deferred({ data: [comment("comment", 31)], hasMore: false });
  jest.mocked(toggleCommentLike).mockReturnValueOnce(pending.promise);
  const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, {
    wrapper,
  });
  await waitFor(() => expect(view.getByText("17")).toBeTruthy());
  fireEvent.press(view.getByText("17"));
  act(() =>
    client.setQueryData(keys.comments.list({ reflectionId: "post", sort: "oldest", viewerId: user(1).id }), {
      pages: [{ data: [comment("comment", 30)], hasMore: false }],
      pageParams: [0],
    }),
  );
  await waitFor(() => expect(view.getByText("30")).toBeTruthy());
  jest.mocked(fetchComments).mockReturnValue(refetch.promise);
  pending.resolve(true);
  await flush();
  expect(view.getByText("31")).toBeTruthy();
  fireEvent.press(view.getByText("31"));
  expect(toggleCommentLike).toHaveBeenLastCalledWith(user(1).id, "comment", true);
  await flush();
  refetch.resolve({ data: [comment("comment", 30)], hasMore: false });
  await flush();
});

it("comment pagination admits one pending page and retains rows through error and retry", async () => {
  mockLocale = "en";
  const pending = deferred({ data: [comment("next")], hasMore: false });
  jest
    .mocked(fetchComments)
    .mockReset()
    .mockResolvedValueOnce({ data: [comment()], hasMore: true })
    .mockReturnValueOnce(pending.promise);
  const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, {
    wrapper,
  });
  await waitFor(() => expect(view.getByText(strings.en.reflectionLoadMore)).toBeTruthy());
  twice(view.getByText(strings.en.reflectionLoadMore));
  expect(fetchComments).toHaveBeenCalledTimes(2);
  pending.reject(new Error("synthetic page rejected"));
  await waitFor(() => expect(view.getByText(strings.en.commentLoadFailed)).toBeTruthy());
  expect(view.getByText("Synthetic comment")).toBeTruthy();
  jest.mocked(fetchComments).mockResolvedValue({ data: [comment("next")], hasMore: false });
  fireEvent.press(view.getByText(strings.en.reflectionLoadMore));
  await waitFor(() => expect(view.getByText("Synthetic next")).toBeTruthy());
  expect(view.getByText("Synthetic comment")).toBeTruthy();
  expect(fetchComments).toHaveBeenLastCalledWith("post", 1, "oldest", user(1).id);
});
