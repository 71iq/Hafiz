import React, { type ReactNode } from "react";
import * as RN from "react-native";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import type { SQLiteDatabase } from "expo-sqlite";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MoreHorizontal } from "lucide-react-native";
import { DirectionProvider } from "@/lib/ui/direction";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import { useAuthStore } from "@/lib/auth/store";
import { ReflectionCard } from "@/components/reflections/ReflectionCard";
import { CommentsSheet } from "@/components/reflections/CommentsSheet";
import { WriteReflectionSheet } from "@/components/reflections/WriteReflectionSheet";
import { profilePrivacyKeys } from "@/lib/profile/privacy";
import {
  addComment,
  createReflection,
  deleteReflection,
  deleteReflectionComment,
  fetchComments,
  reportReflection,
  toggleCommentLike,
  toggleLike,
} from "@/lib/reflections/api";
import { resetLikeSendersForTests } from "@/components/reflections/use-optimistic-like";
import { resetPendingReflectionWritesForTests } from "@/lib/reflections/pending";
import type { Reflection, ReflectionComment } from "@/lib/reflections/types";
import { SavedRowUnreadableError } from "@/lib/reflections/rows";
import { ReflectionPrivacyChangedError } from "@/lib/reflections/errors";
import { reflectionQueryKeys as keys } from "@/lib/reflections/query-keys";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { toArabicNumber } from "@/lib/arabic";
import { loadMushafIndex, type MushafIndex } from "@/lib/mushaf/position";
import { recordAchievementEvent } from "@/lib/achievements/queries";

let mockLocale: "en" | "ar" = "en";
// Comment like counts use the interface's digits (Arabic-Indic in Arabic).
const commentCount = (value: number) => (mockLocale === "ar" ? toArabicNumber(value) : String(value));
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
  deleteReflection: jest.fn(),
  deleteReflectionComment: jest.fn(),
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
    // The discard dialog renders through the real modal pieces.
    ...jest.requireActual("@/components/ui/ResponsiveOverlay"),
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
        <DirectionProvider dir={mockLocale === "ar" ? "rtl" : "ltr"}>
          <OperationNoticeProvider ready>{children}</OperationNoticeProvider>
        </DirectionProvider>
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
  // The shared menu opens once its trigger is measured.
  jest
    .spyOn(RN.View.prototype, "measureInWindow")
    .mockImplementation((callback: (x: number, y: number, width: number, height: number) => void) =>
      callback(300, 100, 32, 32),
    );
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.mocked(fetchComments).mockResolvedValue({ data: [comment(), comment("second", 29)], hasMore: false });
  jest.mocked(addComment).mockResolvedValue(comment("new"));
  jest.mocked(createReflection).mockResolvedValue(post("new"));
  jest.mocked(toggleLike).mockImplementation(async (_u, _p, liked) => !liked);
  jest.mocked(toggleCommentLike).mockImplementation(async (_u, _p, liked) => !liked);
  jest.mocked(reportReflection).mockResolvedValue();
  jest.mocked(deleteReflection).mockResolvedValue(true);
  jest.mocked(deleteReflectionComment).mockResolvedValue(true);
  resetPendingReflectionWritesForTests();
  resetLikeSendersForTests();
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
  it("answers every like tap at once, stays pressable and sends only the latest choice", async () => {
    const first = deferred(false),
      changed = jest.fn();
    jest.mocked(toggleLike).mockReturnValueOnce(first.promise);
    const view = render(
      <ReflectionCard reflection={post()} variant="feed" onLikeToggled={changed} onCommentsPress={jest.fn()} />,
      { wrapper },
    );
    fireEvent.press(view.getByText(commentCount(11)));
    expect(view.getByText(commentCount(12))).toBeTruthy();
    expect(button(view.getByText(commentCount(12))).props.disabled).toBeFalsy();
    // Two more taps while the first request runs: unlike, then like again. Nothing else is sent yet.
    fireEvent.press(view.getByText(commentCount(12)));
    expect(view.getByText(commentCount(11))).toBeTruthy();
    fireEvent.press(view.getByText(commentCount(11)));
    expect(view.getByText(commentCount(12))).toBeTruthy();
    expect(toggleLike).toHaveBeenCalledTimes(1);
    expect(toggleLike).toHaveBeenCalledWith(user(1).id, "post", false);
    first.resolve(true);
    await flush();
    // The server already holds the last choice, so the burst cost one request.
    expect(toggleLike).toHaveBeenCalledTimes(1);
    expect(view.getByText(commentCount(12))).toBeTruthy();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith("post", true, 1);
  });
  it("sends the latest choice after the running request when a burst ends elsewhere", async () => {
    const first = deferred(false);
    jest.mocked(toggleLike).mockReturnValueOnce(first.promise);
    const view = render(
      <ReflectionCard reflection={post()} variant="feed" onLikeToggled={jest.fn()} onCommentsPress={jest.fn()} />,
      { wrapper },
    );
    twice(view.getByText(commentCount(11)));
    expect(view.getByText(commentCount(11))).toBeTruthy();
    expect(toggleLike).toHaveBeenCalledTimes(1);
    first.resolve(true);
    await flush();
    expect(toggleLike).toHaveBeenCalledTimes(2);
    expect(toggleLike).toHaveBeenLastCalledWith(user(1).id, "post", true);
    expect(view.getByText(commentCount(11))).toBeTruthy();
  });
  it("a failed like shows the last choice the server accepted, with an error, and can be tapped again", async () => {
    const pending = deferred(false),
      changed = jest.fn();
    jest.mocked(toggleLike).mockReturnValueOnce(pending.promise);
    const view = render(
      <ReflectionCard reflection={post()} variant="feed" onLikeToggled={changed} onCommentsPress={jest.fn()} />,
      { wrapper },
    );
    fireEvent.press(view.getByText(commentCount(11)));
    expect(view.getByText(commentCount(12))).toBeTruthy();
    pending.reject(new Error("synthetic like rejected"));
    await flush();
    expect(view.getByText(commentCount(11))).toBeTruthy();
    expect(view.getByText(strings[locale].reflectionLikeFailed)).toBeTruthy();
    expect(changed).not.toHaveBeenCalled();
    fireEvent.press(view.getByText(commentCount(11)));
    expect(view.queryByText(strings[locale].reflectionLikeFailed)).toBeNull();
    await flush();
    expect(toggleLike).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith("post", true, 1);
  });
  it("a pending like follows a refreshed count and a failure shows the refreshed count", async () => {
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
    fireEvent.press(view.getByText(commentCount(11)));
    view.rerender(screen(30));
    await flush();
    // The refreshed list does not have this like yet, so it shows on top of the new count.
    expect(view.getByText(commentCount(31))).toBeTruthy();
    pending.reject(new Error("synthetic like rejected"));
    await flush();
    expect(view.getByText(commentCount(30))).toBeTruthy();
    expect(view.queryByText(commentCount(29))).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });
  it("shows a sent comment at once, sends it once across duplicate Enter events and keeps it after close/reopen", async () => {
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
    // Before the server answers: the input is clear, the comment shows and the count rose.
    expect(input.props.value).toBe("");
    expect(view.getAllByText("New comment").length).toBeGreaterThan(0);
    expect(added).toHaveBeenCalledTimes(1);
    expect(added).toHaveBeenCalledWith("post");
    jest.mocked(fetchComments).mockResolvedValue({ data: [comment(), comment("new")], hasMore: false });
    pending.resolve(comment("new"));
    await flush();
    expect(added).toHaveBeenCalledTimes(1);
    view.rerender(screen(null));
    view.rerender(screen("post"));
    await waitFor(() => expect(view.getAllByText("Synthetic new").length).toBeGreaterThan(0));
    expect(view.queryAllByText("New comment")).toHaveLength(0);
  });
  it("a sending comment takes no like or menu until the server names it", async () => {
    const pending = deferred(comment("new"));
    jest.mocked(addComment).mockReturnValue(pending.promise);
    const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, {
      wrapper,
    });
    await waitFor(() => expect(view.getByText("Synthetic comment")).toBeTruthy());
    const menus = view.UNSAFE_getAllByType(MoreHorizontal).length;
    const input = view.getByPlaceholderText(strings[locale].reflectionAddComment);
    fireEvent.changeText(input, "Sending comment");
    fireEvent(input, "submitEditing");
    const likes = view.getAllByLabelText(strings[locale].likeComment);
    expect(likes).toHaveLength(3);
    expect(likes[2].props.accessibilityState?.disabled ?? button(likes[2]).props.disabled).toBe(true);
    expect(view.UNSAFE_getAllByType(MoreHorizontal)).toHaveLength(menus);
    pending.resolve(comment("new"));
    await flush();
  });
  it("sends each comment's like on its own and keeps both pressable", async () => {
    const one = deferred(false),
      two = deferred(true);
    jest.mocked(toggleCommentLike).mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
    const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, {
      wrapper,
    });
    await waitFor(() => expect(view.getByText(commentCount(17))).toBeTruthy());
    const pressOne: () => void = button(view.getByText(commentCount(17))).props.onPress,
      pressTwo: () => void = button(view.getByText(commentCount(29))).props.onPress;
    act(() => {
      pressOne();
      pressOne();
      pressTwo();
    });
    // The first comment's double tap is a like and an unlike; the server gets the like first.
    expect(toggleCommentLike).toHaveBeenCalledTimes(2);
    expect(view.getByText(commentCount(17))).toBeTruthy();
    expect(view.getByText(commentCount(30))).toBeTruthy();
    expect(button(view.getByText(commentCount(30))).props.disabled).toBeFalsy();
    one.reject(new Error("first like rejected"));
    two.resolve(true);
    await flush();
    expect(view.getByText(commentCount(17))).toBeTruthy();
    expect(view.getByText(commentCount(30))).toBeTruthy();
    expect(view.getByText(strings[locale].reflectionLikeFailed)).toBeTruthy();
    // The like error shows above the input, below the comments, where the person is looking.
    const tree = JSON.stringify(view.toJSON());
    const likeError = tree.indexOf(strings[locale].reflectionLikeFailed);
    expect(likeError).toBeGreaterThan(tree.indexOf("Synthetic second"));
    expect(likeError).toBeLessThan(tree.indexOf(strings[locale].reflectionAddComment));
  });
  it("closes on Post at once and publishes once, before the Mushaf index finishes loading", async () => {
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
    // The person sees it done before anything reaches the server.
    expect(close).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledTimes(1);
    expect(view.getByText(strings[locale].reflectionPosted)).toBeTruthy();
    expect(view.getByPlaceholderText(strings[locale].reflectionPlaceholder).props.value).toBe("");
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
  it("sends the privacy the composer promised and brings the draft back when the account is no longer a minor (ETH-07)", async () => {
    const privacyKey = profilePrivacyKeys.mine(user(1).id);
    client.setQueryData(privacyKey, minorPrivacy);
    jest.mocked(createReflection).mockRejectedValue(new ReflectionPrivacyChangedError());
    const close = jest.fn();
    // The parent keeps this composer open, so the draft returns to it rather than waiting.
    const view = render(<WriteReflectionSheet open surah={2} ayahStart={1} ayahEnd={2} onClose={close} />, {
      wrapper,
    });
    fireEvent.changeText(view.getByPlaceholderText(strings[locale].reflectionPlaceholderPrivate), "A private thought");
    fireEvent.press(view.getByText(strings[locale].reflectionSubmit));
    expect(close).toHaveBeenCalledTimes(1);
    await flush();
    expect(createReflection).toHaveBeenCalledWith(user(1).id, 2, 1, 2, 3, 3, "A private thought", true, expect.any(Function));
    expect(view.getByText(strings[locale].reflectionPrivacyChanged).props.accessibilityRole).toBe("alert");
    // The private note would contradict the message, so it waits while the message shows.
    expect(view.queryByText(strings[locale].reflectionMinorPrivate)).toBeNull();
    expect(client.getQueryState(privacyKey)?.isInvalidated).toBe(true);
    expect(view.getByDisplayValue("A private thought")).toBeTruthy();
    expect(recordAchievementEvent).not.toHaveBeenCalled();
  });
  it("sends the privacy the comment input promised and brings the comment back when the account is no longer a minor (ETH-07)", async () => {
    const privacyKey = profilePrivacyKeys.mine(user(1).id);
    client.setQueryData(privacyKey, minorPrivacy);
    jest.mocked(addComment).mockRejectedValue(new ReflectionPrivacyChangedError());
    const added = jest.fn(),
      removed = jest.fn();
    const view = render(
      <CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={added} onCommentRemoved={removed} />,
      { wrapper },
    );
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
    // The count rose when it showed and fell when it was taken back.
    expect(added).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch a public post after the account changes during its index wait", async () => {
    const pending = deferred(index);
    jest.mocked(loadMushafIndex).mockReturnValue(pending.promise);
    const view = render(<WriteReflectionSheet open surah={2} ayahStart={1} ayahEnd={1} onClose={jest.fn()} />, {
      wrapper,
    });
    fireEvent.changeText(view.getByPlaceholderText(strings[locale].reflectionPlaceholder), "Synthetic public reflection");
    fireEvent.press(view.getByText(strings[locale].reflectionSubmit));
    act(() => activate(2));
    pending.resolve(index);
    await flush();
    expect(createReflection).not.toHaveBeenCalled();
    expect(recordAchievementEvent).not.toHaveBeenCalled();
  });
  it("a like from an earlier account neither shows nor reports in the next account's view", async () => {
    const old = deferred(false),
      newer = deferred(true),
      changed = jest.fn();
    jest.mocked(toggleLike).mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    const view = render(
      <ReflectionCard reflection={post()} variant="feed" onLikeToggled={changed} onCommentsPress={jest.fn()} />,
      { wrapper },
    );
    fireEvent.press(view.getByText(commentCount(11)));
    act(() => activate(2));
    await flush();
    expect(view.getByText(commentCount(11))).toBeTruthy();
    fireEvent.press(view.getByText(commentCount(11)));
    expect(toggleLike).toHaveBeenCalledTimes(2);
    expect(toggleLike).toHaveBeenLastCalledWith(user(2).id, "post", false);
    old.reject(new Error("old account error"));
    await flush();
    expect(view.queryByText(strings[locale].reflectionLikeFailed)).toBeNull();
    expect(view.getByText(commentCount(12))).toBeTruthy();
    newer.resolve(true);
    await flush();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith("post", true, 1);
  });
});

it.each(["account", "ABA"] as const)("a post's reply after an %s change publishes nothing", async (retirement) => {
  mockLocale = "en";
  const pending = deferred(post("new"));
  jest.mocked(createReflection).mockReturnValue(pending.promise);
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const view = render(<WriteReflectionSheet open surah={2} ayahStart={1} ayahEnd={1} onClose={jest.fn()} />, {
    wrapper,
  });
  fireEvent.changeText(view.getByPlaceholderText(strings.en.reflectionPlaceholder), "Original synthetic draft");
  fireEvent.press(view.getByText(strings.en.reflectionSubmit));
  await waitFor(() => expect(createReflection).toHaveBeenCalledTimes(1));
  act(() => activate(2));
  if (retirement === "ABA") act(() => activate(1));
  fireEvent.changeText(view.getByPlaceholderText(strings.en.reflectionPlaceholder), "Current replacement draft");
  expect(jest.mocked(createReflection).mock.calls[0][8]?.()).toBe(false);
  pending.resolve(post("new"));
  await flush();
  expect(recordAchievementEvent).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  expect(view.getByPlaceholderText(strings.en.reflectionPlaceholder).props.value).toBe("Current replacement draft");
});

it.each(["target", "close", "database", "unmount"] as const)(
  "a post keeps going after its composer's %s, since it belongs to the account",
  async (retirement) => {
    mockLocale = "en";
    const pending = deferred(post("new"));
    jest.mocked(createReflection).mockReturnValue(pending.promise);
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const screen = (ayah = 1, open = true) => (
      <WriteReflectionSheet open={open} surah={2} ayahStart={ayah} ayahEnd={ayah} onClose={jest.fn()} />
    );
    const view = render(screen(), { wrapper });
    fireEvent.changeText(view.getByPlaceholderText(strings.en.reflectionPlaceholder), "Original synthetic draft");
    fireEvent.press(view.getByText(strings.en.reflectionSubmit));
    await waitFor(() => expect(createReflection).toHaveBeenCalledTimes(1));
    if (retirement === "target") view.rerender(screen(2));
    if (retirement === "close") {
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
    expect(jest.mocked(createReflection).mock.calls[0][8]?.()).toBe(true);
    pending.resolve(post("new"));
    await flush();
    expect(recordAchievementEvent).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.feed.all });
    if (retirement !== "unmount")
      expect(view.getByPlaceholderText(strings.en.reflectionPlaceholder).props.value).toBe("Current replacement draft");
  },
);

it("a failed post brings its draft back to the open composer with Try again", async () => {
  mockLocale = "ar";
  const pending = deferred(post("new")),
    close = jest.fn();
  jest.mocked(createReflection).mockReturnValueOnce(pending.promise);
  const view = render(<WriteReflectionSheet open surah={2} ayahStart={1} ayahEnd={2} onClose={close} />, { wrapper });
  const draft = "Synthetic retained draft";
  fireEvent.changeText(view.getByPlaceholderText(strings.ar.reflectionPlaceholder), draft);
  fireEvent.press(view.getByText(strings.ar.reflectionSubmit));
  expect(close).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(createReflection).toHaveBeenCalledTimes(1));
  pending.reject(new Error("synthetic post rejected"));
  await flush();
  // Server details go to the log; the person sees the plain message with Try again.
  expect(view.getByText(strings.ar.reflectionPostFailed)).toBeTruthy();
  expect(view.queryByText("synthetic post rejected")).toBeNull();
  expect(view.getByPlaceholderText(strings.ar.reflectionPlaceholder).props.value).toBe(draft);
  // Returned to the open composer, so no separate notice repeats it.
  expect(view.queryByText(strings.ar.reflectionPostFailedDraftKept)).toBeNull();
  fireEvent.press(view.getByText(strings.ar.sharedTryAgain));
  await flush();
  expect(createReflection).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(2);
});

it("a post that fails after its composer closed says so and offers its draft when the composer opens again", async () => {
  mockLocale = "en";
  const pending = deferred(post("new"));
  jest.mocked(createReflection).mockReturnValueOnce(pending.promise);
  const screen = (open: boolean) => (
    <WriteReflectionSheet open={open} surah={2} ayahStart={1} ayahEnd={2} onClose={jest.fn()} />
  );
  const view = render(screen(true), { wrapper });
  fireEvent.changeText(view.getByPlaceholderText(strings.en.reflectionPlaceholder), "Kept synthetic draft");
  fireEvent.press(view.getByText(strings.en.reflectionSubmit));
  view.rerender(screen(false));
  await waitFor(() => expect(createReflection).toHaveBeenCalledTimes(1));
  pending.reject(new Error("synthetic post rejected"));
  await flush();
  expect(view.getByText(strings.en.reflectionPostFailedDraftKept)).toBeTruthy();
  view.rerender(screen(true));
  expect(view.getByPlaceholderText(strings.en.reflectionPlaceholder).props.value).toBe("Kept synthetic draft");
  expect(view.getByText(strings.en.reflectionPostFailed)).toBeTruthy();
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

it("refreshes the feed and ayah counts when posting from the standalone comments sheet", async () => {
  const invalidate = jest.spyOn(client, "invalidateQueries");
  jest.mocked(addComment).mockResolvedValueOnce(comment("new"));
  const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} />, { wrapper });
  const input = await view.findByPlaceholderText(strings.en.reflectionAddComment);
  fireEvent.changeText(input, "A comment after signing in");
  fireEvent(input, "submitEditing");
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.feed.all }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.reflections.all });
});

it("comment likes follow new canonical rows, restore them after failure and invalidate only that post on success", async () => {
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
  await waitFor(() => expect(view.getByText(commentCount(17))).toBeTruthy());
  fireEvent.press(view.getByText(commentCount(17)));
  act(() =>
    client.setQueryData(keys.comments.list({ reflectionId: "post", sort: "oldest", viewerId: user(1).id }), {
      pages: [{ data: [comment("comment", 30)], hasMore: false }],
      pageParams: [0],
    }),
  );
  // The new rows do not have this like yet, so it shows on top of them.
  await waitFor(() => expect(view.getByText(commentCount(31))).toBeTruthy());
  pending.reject(new Error("like rejected"));
  await flush();
  expect(view.getByText(commentCount(30))).toBeTruthy();
  expect(client.getQueryState(target)?.isInvalidated).toBe(false);
  fireEvent.press(view.getByText(commentCount(30)));
  await flush();
  expect(client.getQueryState(target)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});

it("a comment sent before its sheet closed still posts and leaves the new draft alone", async () => {
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
  // Still shown in the reopened sheet while it sends.
  expect(view.getAllByText("Old draft").length).toBeGreaterThan(0);
  const invalidate = jest.spyOn(client, "invalidateQueries");
  pending.resolve(comment("new"));
  await flush();
  expect(added).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.comments.forReflection("post") });
  expect(view.getAllByText("Synthetic new").length).toBeGreaterThan(0);
  expect(view.getByPlaceholderText(strings.en.reflectionAddComment).props.value).toBe("New draft");
});

it("a comment from an earlier account is dropped without touching the next account's sheet", async () => {
  mockLocale = "en";
  const pending = deferred(comment("new")),
    removed = jest.fn();
  jest.mocked(addComment).mockReturnValue(pending.promise);
  const view = render(
    <CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} onCommentRemoved={removed} />,
    { wrapper },
  );
  await waitFor(() => expect(view.getByText("Synthetic comment")).toBeTruthy());
  fireEvent.changeText(view.getByPlaceholderText(strings.en.reflectionAddComment), "Old account draft");
  fireEvent(view.getByPlaceholderText(strings.en.reflectionAddComment), "submitEditing");
  act(() => activate(2));
  await flush();
  expect(view.queryAllByText("Old account draft")).toHaveLength(0);
  pending.reject(new Error("old account comment rejected"));
  await flush();
  expect(removed).not.toHaveBeenCalled();
  expect(view.getByPlaceholderText(strings.en.reflectionAddComment).props.value).toBe("");
  expect(view.queryByText(strings.en.commentPostFailed)).toBeNull();
});

it("a failed comment leaves the list, brings its text back and retries", async () => {
  mockLocale = "ar";
  const pending = deferred(comment("new")),
    added = jest.fn(),
    removed = jest.fn();
  jest.mocked(addComment).mockReturnValueOnce(pending.promise);
  const view = render(
    <CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={added} onCommentRemoved={removed} />,
    { wrapper },
  );
  await waitFor(() => expect(view.getByText("Synthetic comment")).toBeTruthy());
  const input = view.getByPlaceholderText(strings.ar.reflectionAddComment);
  fireEvent.changeText(input, "Synthetic draft");
  fireEvent(input, "submitEditing");
  expect(input.props.value).toBe("");
  expect(view.getAllByText("Synthetic draft").length).toBeGreaterThan(0);
  pending.reject(new Error("comment rejected"));
  await flush();
  expect(view.queryAllByText("Synthetic draft").filter((node) => node.props.value === undefined)).toHaveLength(0);
  expect(input.props.value).toBe("Synthetic draft");
  expect(view.getByText(strings.ar.commentPostFailed)).toBeTruthy();
  expect(added).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledTimes(1);
  fireEvent(input, "submitEditing");
  await flush();
  expect(addComment).toHaveBeenCalledTimes(2);
  expect(added).toHaveBeenCalledTimes(2);
  expect(removed).toHaveBeenCalledTimes(1);
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

/** Opens the card's shared More options menu and picks an item (the menu runs it on the next frame). */
async function pickMenuItem(view: ReturnType<typeof render>, label: string, trigger = 0) {
  fireEvent.press(view.UNSAFE_getAllByType(MoreHorizontal)[trigger]);
  fireEvent.press(view.getByText(label));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
const ownPost = (id = "post") => ({ ...post(id), user_id: user(1).id });

it("reports after a confirmation, shows Reported at once, and takes it back with a notice when the report fails", async () => {
  mockLocale = "en";
  const pending = deferred<void>(undefined);
  jest.mocked(reportReflection).mockReturnValueOnce(pending.promise);
  const view = render(
    <ReflectionCard reflection={post()} variant="feed" onLikeToggled={jest.fn()} onCommentsPress={jest.fn()} />,
    { wrapper },
  );
  expect(view.queryByText(strings.en.reflectionDeleteAction)).toBeNull();
  await pickMenuItem(view, strings.en.reflectionReportAction);
  expect(reportReflection).not.toHaveBeenCalled();
  expect(view.getByText(strings.en.reflectionReportBody)).toBeTruthy();
  twice(view.getByText(strings.en.reflectionReportConfirm));
  expect(reportReflection).toHaveBeenCalledTimes(1);
  expect(reportReflection).toHaveBeenCalledWith(user(1).id, "post");
  // Closed and confirmed before the server answers.
  expect(view.queryByText(strings.en.reflectionReportBody)).toBeNull();
  expect(view.getByText(strings.en.reflectionReportSent)).toBeTruthy();
  fireEvent.press(view.UNSAFE_getByType(MoreHorizontal));
  expect(button(view.getByText(strings.en.reflectionReported)).props.disabled).toBe(true);
  pending.reject(new Error("report rejected"));
  await flush();
  expect(view.getByText(strings.en.reflectionReportFailed)).toBeTruthy();
  await pickMenuItem(view, strings.en.reflectionReportAction);
  fireEvent.press(view.getByText(strings.en.reflectionReportConfirm));
  await flush();
  expect(reportReflection).toHaveBeenCalledTimes(2);
  fireEvent.press(view.UNSAFE_getByType(MoreHorizontal));
  expect(button(view.getByText(strings.en.reflectionReported)).props.disabled).toBe(true);
});

it("an owned reflection offers Delete with cascade copy, leaves at once and is removed from caches once the server confirms", async () => {
  mockLocale = "en";
  const pending = deferred(false),
    gone = jest.fn();
  jest.mocked(deleteReflection).mockReturnValueOnce(pending.promise);
  const source = ownPost();
  const feed = keys.feed.list({ filter: { type: "all" }, sort: "newest", viewerId: user(1).id, searchTerm: "" });
  const ayah = keys.reflections.firstPage({ surah: 2, ayah: 2, viewerId: user(1).id });
  const comments = keys.comments.list({ reflectionId: "post", sort: "oldest", viewerId: user(1).id });
  const count = keys.count({ surah: 2, ayah: 1, viewerId: user(1).id });
  client.setQueryData(feed, { pages: [{ data: [source, post("other")], hasMore: true }], pageParams: [0] });
  client.setQueryData(ayah, { data: [source], hasMore: false });
  client.setQueryData(comments, { pages: [{ data: [comment()], hasMore: false }], pageParams: [0] });
  client.setQueryData(count, 2);
  const view = render(
    <ReflectionCard
      reflection={source}
      variant="feed"
      onLikeToggled={jest.fn()}
      onCommentsPress={jest.fn()}
      onGone={gone}
    />,
    { wrapper },
  );
  expect(view.queryByText(strings.en.reflectionReportAction)).toBeNull();
  await pickMenuItem(view, strings.en.reflectionDeleteAction);
  expect(view.getByText(strings.en.reflectionDeleteBody)).toBeTruthy();
  expect(strings.en.reflectionDeleteBody).toMatch(/comments and likes/);
  twice(view.getByText(strings.en.reflectionDeleteConfirm));
  expect(deleteReflection).toHaveBeenCalledTimes(1);
  expect(deleteReflection).toHaveBeenCalledWith(user(1).id, "post");
  // Gone from the screen before the server answers; the caches change only after it does.
  expect(view.queryByText(source.content)).toBeNull();
  expect(view.queryByText(strings.en.reflectionDeleteBody)).toBeNull();
  expect(view.getByText(strings.en.reflectionDeleted)).toBeTruthy();
  expect(gone).toHaveBeenCalledWith(source);
  expect(client.getQueryData<{ pages: { data: Reflection[] }[] }>(feed)?.pages[0].data).toHaveLength(2);
  pending.resolve(true);
  await flush();
  expect(client.getQueryData<{ pages: { data: Reflection[]; hasMore: boolean }[] }>(feed)?.pages).toEqual([
    { data: [post("other")], hasMore: true },
  ]);
  expect(client.getQueryData<{ data: Reflection[] }>(ayah)?.data).toEqual([]);
  expect(client.getQueryData(comments)).toBeUndefined();
  expect(client.getQueryState(count)?.isInvalidated).toBe(true);
  expect(view.queryByText(source.content)).toBeNull();
});

it("a false delete result keeps it gone and refreshes the lists", async () => {
  mockLocale = "en";
  jest.mocked(deleteReflection).mockResolvedValueOnce(false);
  const source = ownPost();
  const feed = keys.feed.list({ filter: { type: "all" }, sort: "newest", viewerId: user(1).id, searchTerm: "" });
  client.setQueryData(feed, { pages: [{ data: [source], hasMore: false }], pageParams: [0] });
  const view = render(
    <ReflectionCard reflection={source} variant="feed" onLikeToggled={jest.fn()} onCommentsPress={jest.fn()} />,
    { wrapper },
  );
  await pickMenuItem(view, strings.en.reflectionDeleteAction);
  fireEvent.press(view.getByText(strings.en.reflectionDeleteConfirm));
  await flush();
  expect(client.getQueryState(feed)?.isInvalidated).toBe(true);
  expect(view.queryByText(source.content)).toBeNull();
  expect(view.queryByText(strings.en.reflectionDeleteFailed)).toBeNull();
});

it("a failed delete brings the reflection back, refreshes the lists that dropped it and says so", async () => {
  mockLocale = "en";
  jest.mocked(deleteReflection).mockRejectedValueOnce(new Error("synthetic delete failure"));
  const source = ownPost();
  const feed = keys.feed.list({ filter: { type: "all" }, sort: "newest", viewerId: user(1).id, searchTerm: "" });
  const ayah = keys.reflections.firstPage({ surah: 2, ayah: 1, viewerId: user(1).id });
  client.setQueryData(feed, { pages: [{ data: [source], hasMore: false }], pageParams: [0] });
  client.setQueryData(ayah, { data: [source], hasMore: false });
  const gone = jest.fn();
  const view = render(
    <ReflectionCard
      reflection={source}
      variant="feed"
      onLikeToggled={jest.fn()}
      onCommentsPress={jest.fn()}
      onGone={gone}
    />,
    { wrapper },
  );
  await pickMenuItem(view, strings.en.reflectionDeleteAction);
  fireEvent.press(view.getByText(strings.en.reflectionDeleteConfirm));
  expect(view.queryByText(source.content)).toBeNull();
  await flush();
  expect(view.getByText(source.content)).toBeTruthy();
  expect(view.getByText(strings.en.reflectionDeleteFailed)).toBeTruthy();
  expect(client.getQueryData<{ pages: { data: Reflection[] }[] }>(feed)?.pages[0].data).toEqual([source]);
  expect(client.getQueryState(ayah)?.isInvalidated).toBe(true);
  await pickMenuItem(view, strings.en.reflectionDeleteAction);
  fireEvent.press(view.getByText(strings.en.reflectionDeleteConfirm));
  await flush();
  expect(deleteReflection).toHaveBeenCalledTimes(2);
  expect(client.getQueryData<{ pages: { data: Reflection[] }[] }>(feed)?.pages[0].data).toEqual([]);
});

it("a delete that completes after an account switch changes nothing in the new account's view", async () => {
  mockLocale = "en";
  const pending = deferred(false),
    gone = jest.fn();
  jest.mocked(deleteReflection).mockReturnValueOnce(pending.promise);
  const source = ownPost();
  const otherFeed = keys.feed.list({ filter: { type: "all" }, sort: "newest", viewerId: user(2).id, searchTerm: "" });
  client.setQueryData(otherFeed, { pages: [{ data: [source], hasMore: false }], pageParams: [0] });
  const view = render(
    <ReflectionCard
      reflection={source}
      variant="feed"
      onLikeToggled={jest.fn()}
      onCommentsPress={jest.fn()}
      onGone={gone}
    />,
    { wrapper },
  );
  await pickMenuItem(view, strings.en.reflectionDeleteAction);
  fireEvent.press(view.getByText(strings.en.reflectionDeleteConfirm));
  expect(deleteReflection).toHaveBeenCalledWith(user(1).id, "post");
  expect(gone).toHaveBeenCalledTimes(1);
  act(() => activate(2));
  // Another account sees the reflection; the hidden entry belongs to the first account.
  expect(view.getByText(source.content)).toBeTruthy();
  pending.resolve(true);
  await flush();
  expect(client.getQueryData<{ pages: { data: Reflection[] }[] }>(otherFeed)?.pages[0].data).toEqual([source]);
  expect(client.getQueryState(otherFeed)?.isInvalidated).toBe(false);
});

it("an own comment offers Delete through the comment RPC; another's offers Report reflection for the parent", async () => {
  mockLocale = "en";
  const removed = jest.fn();
  jest.mocked(fetchComments).mockResolvedValue({
    data: [{ ...comment("mine"), user_id: user(1).id }, comment("theirs")],
    hasMore: false,
  });
  const view = render(
    <CommentsSheet
      reflectionId="post"
      reflection={post()}
      referenceLabel="Al-Baqarah 2:1-2"
      onClose={jest.fn()}
      onCommentAdded={jest.fn()}
      onCommentRemoved={removed}
    />,
    { wrapper },
  );
  await waitFor(() => expect(view.getByText("Synthetic theirs")).toBeTruthy());
  // After a confirmed delete the server no longer returns it.
  jest.mocked(fetchComments).mockResolvedValue({ data: [comment("theirs")], hasMore: false });
  // Triggers: the card's menu first, then one per comment in order.
  await pickMenuItem(view, strings.en.reflectionReportAction, 2);
  expect(view.getByText(interpolate(strings.en.reflectionReportFromCommentBody, { reference: "Al-Baqarah 2:1-2" }))).toBeTruthy();
  fireEvent.press(view.getByText(strings.en.reflectionReportConfirm));
  await flush();
  expect(reportReflection).toHaveBeenCalledWith(user(1).id, "post");
  await pickMenuItem(view, strings.en.commentDeleteAction, 1);
  expect(view.getByText(strings.en.commentDeleteBody)).toBeTruthy();
  fireEvent.press(view.getByText(strings.en.reflectionDeleteConfirm));
  await flush();
  expect(deleteReflectionComment).toHaveBeenCalledWith(user(1).id, "mine");
  expect(removed).toHaveBeenCalledWith("post");
  await waitFor(() => expect(view.queryAllByText("Synthetic mine")).toHaveLength(0));
});

it("a false comment delete keeps the comment gone and refreshes the list", async () => {
  mockLocale = "en";
  const removed = jest.fn(),
    added = jest.fn();
  jest.mocked(deleteReflectionComment).mockResolvedValueOnce(false);
  jest.mocked(fetchComments).mockResolvedValue({ data: [{ ...comment("mine"), user_id: user(1).id }], hasMore: false });
  const view = render(
    <CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={added} onCommentRemoved={removed} />,
    { wrapper },
  );
  await waitFor(() => expect(view.getByText("Synthetic mine")).toBeTruthy());
  const calls = jest.mocked(fetchComments).mock.calls.length;
  await pickMenuItem(view, strings.en.commentDeleteAction, 0);
  fireEvent.press(view.getByText(strings.en.reflectionDeleteConfirm));
  expect(removed).toHaveBeenCalledTimes(1);
  await flush();
  expect(added).not.toHaveBeenCalled();
  expect(view.queryAllByText("Synthetic mine")).toHaveLength(0);
  expect(jest.mocked(fetchComments).mock.calls.length).toBeGreaterThan(calls);
});

it("a failed comment delete brings the comment and its count back and says so", async () => {
  mockLocale = "ar";
  const removed = jest.fn(),
    added = jest.fn();
  jest.mocked(deleteReflectionComment).mockRejectedValueOnce(new Error("synthetic comment delete failure"));
  jest.mocked(fetchComments).mockResolvedValue({ data: [{ ...comment("mine"), user_id: user(1).id }], hasMore: false });
  const view = render(
    <CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={added} onCommentRemoved={removed} />,
    { wrapper },
  );
  await waitFor(() => expect(view.getByText("Synthetic mine")).toBeTruthy());
  await pickMenuItem(view, strings.ar.commentDeleteAction, 0);
  fireEvent.press(view.getByText(strings.ar.reflectionDeleteConfirm));
  expect(view.queryAllByText("Synthetic mine")).toHaveLength(0);
  expect(removed).toHaveBeenCalledTimes(1);
  await flush();
  expect(view.getAllByText("Synthetic mine").length).toBeGreaterThan(0);
  expect(added).toHaveBeenCalledTimes(1);
  expect(view.getByText(strings.ar.commentDeleteFailed)).toBeTruthy();
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
  await waitFor(() => expect(view.getByText(commentCount(17))).toBeTruthy());
  fireEvent.press(view.getByText(commentCount(17)));
  expect(view.getByText(commentCount(18))).toBeTruthy();
  const next = session(1),
    parts = next.access_token.split(".");
  parts[1] = Buffer.from(
    JSON.stringify({ sub: user(1).id, session_id: "10000000-0000-4000-8000-000000000009" }),
  ).toString("base64url");
  next.access_token = parts.join(".");
  act(() => useAuthStore.setState({ session: next, user: next.user }));
  await flush();
  expect(view.getByText(commentCount(17))).toBeTruthy();
  expect(view.queryByText(commentCount(18))).toBeNull();
  pending.resolve(true);
  await flush();
});

it("a confirmed comment like holds until the list shows it, then the next press unlikes", async () => {
  mockLocale = "en";
  const pending = deferred(true),
    refetch = deferred({ data: [{ ...comment("comment", 31), user_has_liked: true }], hasMore: false });
  jest.mocked(toggleCommentLike).mockReturnValueOnce(pending.promise);
  const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, {
    wrapper,
  });
  await waitFor(() => expect(view.getByText(commentCount(17))).toBeTruthy());
  fireEvent.press(view.getByText(commentCount(17)));
  act(() =>
    client.setQueryData(keys.comments.list({ reflectionId: "post", sort: "oldest", viewerId: user(1).id }), {
      pages: [{ data: [comment("comment", 30)], hasMore: false }],
      pageParams: [0],
    }),
  );
  await waitFor(() => expect(view.getByText(commentCount(31))).toBeTruthy());
  jest.mocked(fetchComments).mockReturnValue(refetch.promise);
  pending.resolve(true);
  await flush();
  expect(view.getByText(commentCount(31))).toBeTruthy();
  refetch.resolve({ data: [{ ...comment("comment", 31), user_has_liked: true }], hasMore: false });
  await flush();
  expect(view.getByText(commentCount(31))).toBeTruthy();
  fireEvent.press(view.getByText(commentCount(31)));
  expect(view.getByText(commentCount(30))).toBeTruthy();
  expect(toggleCommentLike).toHaveBeenLastCalledWith(user(1).id, "comment", true);
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
  // A failed page shows beside "Load more", not above the list the person scrolled past.
  const tree = JSON.stringify(view.toJSON());
  expect(tree.indexOf(strings.en.commentLoadFailed)).toBeGreaterThan(tree.indexOf(strings.en.reflectionLoadMore));
  expect(tree.indexOf(strings.en.commentLoadFailed)).toBeGreaterThan(tree.indexOf("Synthetic comment"));
  jest.mocked(fetchComments).mockResolvedValue({ data: [comment("next")], hasMore: false });
  fireEvent.press(view.getByText(strings.en.reflectionLoadMore));
  await waitFor(() => expect(view.getByText("Synthetic next")).toBeTruthy());
  expect(view.getByText("Synthetic comment")).toBeTruthy();
  expect(fetchComments).toHaveBeenLastCalledWith("post", 1, "oldest", user(1).id);
});

it("asks before closing a typed comment and shows the counter near the limit", async () => {
  mockLocale = "en";
  const close = jest.fn();
  const view = render(<CommentsSheet reflectionId="post" onClose={close} onCommentAdded={jest.fn()} />, { wrapper });
  await waitFor(() => expect(view.getByText(commentCount(17))).toBeTruthy());
  const input = view.getByPlaceholderText(strings.en.reflectionAddComment);
  fireEvent.changeText(input, "x".repeat(1800));
  expect(view.queryByText("1,800 / 2,000")).toBeNull();
  fireEvent.changeText(input, "x".repeat(1801));
  expect(view.getByText("1,801 / 2,000")).toBeTruthy();
  fireEvent.press(view.getByTestId("close-sheet"));
  // The mocked header omits titles; the dialog's actions show it asked.
  expect(view.getByText(strings.en.discardChangesKeepEditing)).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  fireEvent.press(view.getByText(strings.en.discardChangesConfirm));
  expect(close).toHaveBeenCalledTimes(1);
});

it("explains a guest's comment like instead of ignoring it when no sign-in path is given", async () => {
  mockLocale = "en";
  useAuthStore.setState({ user: null, session: null, profile: null });
  const view = render(<CommentsSheet reflectionId="post" onClose={jest.fn()} onCommentAdded={jest.fn()} />, { wrapper });
  await waitFor(() => expect(view.getByText(commentCount(17))).toBeTruthy());
  fireEvent.press(view.getByText(commentCount(17)));
  expect(view.getByText(strings.en.reflectionFeedAuthRequired)).toBeTruthy();
  expect(toggleCommentLike).not.toHaveBeenCalled();
});
