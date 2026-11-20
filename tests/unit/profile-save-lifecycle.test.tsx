import { authCommands } from "@/lib/auth/commands";
import React, { StrictMode, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient } from "@tanstack/react-query";
import { useAuthStore as mockAuthStore } from "@/lib/auth/store";
import type { Profile } from "@/lib/auth/types";
import { ProfileModalContent, resetFailedProfileDraftForTests } from "@/components/profile/ProfileModalContent";
import { strings } from "@/lib/i18n/strings";

type Response = { data: Profile | null; error: Error | null };
let mockQueryClient: QueryClient;
let mockSave: () => void;
let mockCloseEdit: () => void;
let mockRootClose: () => void;
let mockNameChange: (value: string) => void;
const mockWrite = jest.fn<Promise<Response>, [unknown]>();
const mockUpload = jest.fn<Promise<string>, [string, unknown]>();
const mockPermission = jest.fn();
const mockPicker = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockDb = { getFirstAsync: jest.fn(async () => ({ count: 0 })) };
const mockRouter = { canGoBack: () => true, back: mockBack, replace: mockReplace };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: () => mockPermission(),
  launchImageLibraryAsync: () => mockPicker(),
}));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => mockQueryClient,
}));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabaseAnonKey: () => "synthetic-public-key",
  supabase: {
    from: () => {
      let updating = false;
      let patch: unknown;
      const chain = {
        select: () => chain,
        eq: () => chain,
        update: (value: unknown) => {
          updating = true;
          patch = value;
          return chain;
        },
        maybeSingle: async () => ({ data: mockAuthStore.getState().profile, error: null }),
        single: () =>
          updating ? mockWrite(patch) : Promise.resolve({ data: mockAuthStore.getState().profile, error: null }),
      };
      return chain;
    },
  },
}));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/auth/config", () => ({ isEmailAuthFlowsEnabled: () => true }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));
jest.mock("@/lib/i18n/useStrings", () => ({ useStrings: () => jest.requireActual("@/lib/i18n/strings").strings.en }));
jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    isDark: false,
    isRTL: false,
    uiLanguage: "en",
    themeColors: { surfaceLow: "white", surfaceBright: "white", surfaceHigh: "white" },
  }),
}));
jest.mock("@/lib/achievements/queries", () => ({ getRecentUnlocks: async () => [] }));
jest.mock("@/lib/fsrs/queries", () => ({
  getReviewStats: async () => ({ activity: [], activeDays: 0, totalReviews: 0 }),
}));
jest.mock("@/lib/fsrs/leaderboard-sync", () => ({ updateProfileStats: async () => undefined }));
jest.mock("@/lib/fsrs/review-events", () => ({ subscribeReviewActivity: () => () => undefined }));
jest.mock("@/lib/sync/events", () => ({
  subscribeSyncCompleted: () => () => undefined,
  subscribeSyncQueued: () => () => undefined,
}));
jest.mock("@/lib/leaderboard/api", () => ({
  fetchPublicProfile: async () => null,
  fetchPublicAchievementUnlocks: async () => [],
  fetchPublicSurahProgress: async () => [],
}));
jest.mock("@/lib/profile/privacy", () => ({
  fetchProfileSummary: async () => null,
  fetchProfilePrivacy: async () => ({ boardJoined: false, boardNickname: null, showStreak: false, showJuzCompletions: false, isMinor: false }),
  profilePrivacyKeys: {
    summary: (viewer: string | null, target: string) => ["profileSummary", viewer, target],
    mine: (userId: string | null) => ["profilePrivacy", userId ?? "signed-out"],
  },
}));
jest.mock("@/lib/profile/avatar", () => ({
  ...jest.requireActual("@/lib/profile/avatar"),
  uploadProfileAvatar: (id: string, asset: unknown) => mockUpload(id, asset),
}));
// A successful save closes the editor and confirms it through the shared notice.
const mockNotice = jest.fn();
jest.mock("@/components/ui/OperationNoticeProvider", () => ({ useOptionalOperationNotice: () => mockNotice }));
let mockRestorePause: "pending_consent" | "cancelled" | null = null;
jest.mock("@/lib/sync/restore-consent", () => ({
  useSyncRestorePause: (userId: string | null) => ({
    paused: userId !== null && mockRestorePause !== null,
    pause: userId !== null ? mockRestorePause : null,
    resuming: false,
    resume: () => undefined,
  }),
}));
jest.mock("@/lib/profile/progress", () => ({
  attachSurahNames: async () => [],
  getDefaultDeckProgress: async () => [],
  getLocalSurahProgress: async () => [],
  summarizeSurahProgress: () => ({ memorized: 0, totalCards: 0, retentionPct: 0 }),
}));
jest.mock("@/components/ui/Button", () => ({
  Button: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled: boolean }) => {
    const { Pressable } = jest.requireActual("react-native");
    mockSave = onPress;
    return (
      <Pressable testID="save" accessibilityRole="button" onPress={onPress} disabled={disabled}>
        {children}
      </Pressable>
    );
  },
}));
jest.mock("@/components/ui/Input", () => ({
  Input: (props: { accessibilityLabel?: string; onChangeText?: (value: string) => void }) => {
    if (props.accessibilityLabel === "Display Name" && props.onChangeText) mockNameChange = props.onChangeText;
    const { TextInput } = jest.requireActual("react-native");
    return <TextInput {...props} />;
  },
}));
jest.mock("@/components/ui/ResponsiveOverlay", () => {
  const { View, Pressable, Text } = jest.requireActual("react-native");
  return {
    ResponsiveSheet: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => {
      mockRootClose = onClose;
      return <View>{children}</View>;
    },
    // The edit dialog is the modal that avoids the keyboard; the discard prompt and lists are others.
    ResponsiveModal: ({
      children,
      open,
      onClose,
      avoidKeyboard,
    }: {
      children: ReactNode;
      open: boolean;
      onClose: () => void;
      avoidKeyboard?: boolean;
    }) => {
      if (avoidKeyboard) mockCloseEdit = onClose;
      return open ? <View>{children}</View> : null;
    },
    OverlayFooter: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    OverlayFooterLabel: ({ children }: { children: ReactNode }) => <Text>{children}</Text>,
    OverlayButton: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
      <Pressable onPress={onPress}>{children}</Pressable>
    ),
    OverlayBody: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    OverlayHeader: ({ actions }: { actions: ReactNode }) => <View>{actions}</View>,
  };
});
jest.mock("@/components/achievements/PublicBadgesGrid", () => ({ PublicBadgesGrid: () => null }));
jest.mock("@/components/progress/ActivityHeatmap", () => ({ ActivityHeatmap: () => null }));
jest.mock("@/components/progress/DefaultDeckProgressChart", () => ({ DefaultDeckProgressChart: () => null }));
jest.mock("@/components/progress/SurahProgressList", () => ({ SurahProgressList: () => null }));
jest.mock("@/components/ui/Card", () => ({ Card: () => null }));
jest.mock("@/components/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("@/components/profile/ProfileAvatar", () => ({ ProfileAvatar: () => null }));
jest.mock("@/components/profile/ProfileNotesManager", () => ({ ProfileNotesManager: () => null }));
jest.mock("@/components/profile/ProfileStatCard", () => ({ ProfileStatCard: () => null }));

const uid = (id: string) =>
  id === "a" ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002";
let sequence = 0;
const user = (id: string): User => ({
  id: uid(id),
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01",
});
const session = (id: string): Session => ({
  user: user(id),
  access_token: [
    "e30",
    Buffer.from(
      JSON.stringify({ sub: uid(id), session_id: `10000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` }),
    ).toString("base64url"),
    "c2ln",
  ].join("."),
  refresh_token: "synthetic",
  token_type: "bearer",
  expires_in: 3600,
});
const profile = (id: string, name = `Name-${id}`): Profile => ({
  id: uid(id),
  username: id,
  display_name: name,
  avatar_url: null,
  bio: null,
  country: null,
  created_at: "2026-01-01",
});
function activate(value: Session | null, current: Profile | null) {
  mockAuthStore.setState({ user: value?.user ?? null, session: value, profile: current });
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw Error("Uninitialized response");
  };
  let reject: (error: Error) => void = () => {
    throw Error("Uninitialized rejection");
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
beforeEach(() => {
  resetFailedProfileDraftForTests();
  mockNotice.mockReset();
  mockRestorePause = null;
  mockQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  activate(session("a"), profile("a"));
  mockAuthStore.setState({ isLoading: false, error: null, isInitialized: true });
  mockWrite.mockReset();
  mockUpload.mockReset();
  mockPermission.mockReset();
  mockPicker.mockReset();
  mockPermission.mockResolvedValue({ granted: true });
  mockPicker.mockResolvedValue({ canceled: true, assets: [] });
  mockBack.mockClear();
  mockReplace.mockClear();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  mockQueryClient.clear();
  activate(null, null);
  jest.restoreAllMocks();
});
async function open(strict = false) {
  const screen = render(
    strict ? (
      <StrictMode>
        <ProfileModalContent />
      </StrictMode>
    ) : (
      <ProfileModalContent />
    ),
  );
  await flush();
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  return screen;
}
function change(screen: ReturnType<typeof render>, value = "Changed A") {
  fireEvent.changeText(screen.getByLabelText(strings.en.authDisplayName), value);
}
it("saves a current trimmed profile and updates its real Query cache", async () => {
  mockWrite.mockResolvedValue({ data: profile("a", "Changed A"), error: null });
  const screen = await open();
  change(screen, "  Changed A  ");
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaved));
  expect(mockWrite).toHaveBeenCalledWith({ display_name: "Changed A" });
  expect(mockQueryClient.getQueryData(["publicProfile", uid("a")])).toEqual(profile("a", "Changed A"));
});
it.each(["success", "error", "rejection"])("ignores late profile %s after account replacement", async (outcome) => {
  const pending = deferred<Response>();
  mockWrite.mockReturnValue(pending.promise);
  const screen = await open();
  change(screen);
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
  await act(async () => activate(session("b"), profile("b")));
  await act(async () => {
    if (outcome === "rejection") pending.reject(new Error("old-save-error"));
    else
      pending.resolve({
        data: outcome === "success" ? profile("a", "old-a") : null,
        error: outcome === "error" ? new Error("old-save-error") : null,
      });
  });
  expect(mockAuthStore.getState().profile?.id).toBe(uid("b"));
  expect(mockQueryClient.getQueryData(["publicProfile", uid("a")])).toBeUndefined();
  // Confirmed when pressed; the old account's outcome reaches no one.
  expect(mockNotice).toHaveBeenCalledTimes(1);
  expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaved);
  expect(screen.queryByText(strings.en.profileSaveFailed)).toBeNull();
});
it("guards duplicate same-stack submit callbacks", async () => {
  const pending = deferred<Response>();
  mockWrite.mockReturnValue(pending.promise);
  const screen = await open();
  change(screen);
  const save = mockSave;
  await act(async () => {
    void save();
    void save();
  });
  await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
  await act(async () => pending.resolve({ data: profile("a", "Changed A"), error: null }));
  expect(mockWrite).toHaveBeenCalledTimes(1);
});
it("does not submit a later account from a captured old save callback", async () => {
  const screen = await open();
  change(screen);
  const save = mockSave;
  await act(async () => activate(session("b"), profile("b")));
  await act(async () => save());
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
});
it("does not mutate the current edit after old avatar upload finishes", async () => {
  const upload = deferred<string>();
  mockUpload.mockReturnValue(upload.promise);
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:synthetic", width: 10, height: 10 }] });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  change(screen);
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  await act(async () => activate(session("b"), profile("b")));
  await act(async () => upload.resolve("https://synthetic.example.invalid/old-a.png"));
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockNotice).toHaveBeenCalledTimes(1);
  expect(mockAuthStore.getState().profile).toEqual(profile("b"));
});
it("suppresses picker permission continuation after account replacement", async () => {
  const permission = deferred<{ granted: boolean }>();
  mockPermission.mockReturnValue(permission.promise);
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await act(async () => activate(session("b"), profile("b")));
  await act(async () => permission.resolve({ granted: true }));
  expect(mockPicker).not.toHaveBeenCalled();
});
it("closes the editor on Save and keeps saving with the uploaded photo", async () => {
  const upload = deferred<string>();
  const url = "https://synthetic.example.invalid/new.png";
  mockUpload.mockReturnValue(upload.promise);
  mockWrite.mockResolvedValue({ data: { ...profile("a"), avatar_url: url }, error: null });
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:synthetic", width: 10, height: 10 }] });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  fireEvent.press(screen.getByTestId("save"));
  expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
  expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaved);
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  await act(async () => upload.resolve(url));
  await flush();
  expect(mockWrite).toHaveBeenCalledWith({ avatar_url: url });
  expect(mockAuthStore.getState().profile?.avatar_url).toBe(url);
});
it("keeps the editor usable through StrictMode effect replay", async () => {
  mockWrite.mockResolvedValue({ data: profile("a", "Changed A"), error: null });
  const screen = await open(true);
  change(screen);
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
});

it.each(["packet", "rejection"])(
  "a failed save (%s) puts the earlier name back and keeps the draft for the editor",
  async (outcome) => {
    const error = new Error("current-save-error");
    const pending = deferred<Response>();
    mockWrite.mockReturnValue(pending.promise);
    const screen = await open();
    change(screen);
    fireEvent.press(screen.getByTestId("save"));
    // Shown everywhere at once, with the editor closed, before the server answers.
    expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
    expect(mockAuthStore.getState().profile?.display_name).toBe("Changed A");
    expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaved);
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    await act(async () => {
      if (outcome === "packet") pending.resolve({ data: null, error });
      else pending.reject(error);
    });
    await flush();
    expect(mockAuthStore.getState().profile?.display_name).toBe("Name-a");
    expect(mockNotice).toHaveBeenLastCalledWith(strings.en.profileSaveFailedDraftKept);
    expect(mockQueryClient.getQueryData(["publicProfile", uid("a")])).toBeUndefined();
    fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
    await flush();
    expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Changed A");
    expect(screen.getByText(strings.en.profileSaveFailed)).toBeTruthy();
    expect(screen.getByTestId("save").props.accessibilityState.disabled).toBe(false);
  },
);
it("a photo save that fails while the editor is open again puts the photo back there", async () => {
  const upload = deferred<string>();
  mockUpload.mockReturnValue(upload.promise);
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:synthetic", width: 10, height: 10 }] });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  expect(screen.getByTestId("save").props.accessibilityState.disabled).toBe(true);
  await act(async () => upload.reject(new Error("upload failed")));
  await flush();
  expect(screen.getByText(strings.en.profilePhotoFailed)).toBeTruthy();
  // The chosen photo is back as a draft, so Save is available to try again.
  expect(screen.getByTestId("save").props.accessibilityState.disabled).toBe(false);
});
it("a save that fails while the editor is open again shows the reason there", async () => {
  const pending = deferred<Response>();
  mockWrite.mockReturnValue(pending.promise);
  const screen = await open();
  change(screen);
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  // The reopened editor starts from what the screen shows now.
  expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Changed A");
  await act(async () => pending.reject(new Error("current-save-error")));
  await flush();
  expect(screen.getByText(strings.en.profileSaveFailed)).toBeTruthy();
  expect(mockNotice).not.toHaveBeenCalledWith(strings.en.profileSaveFailedDraftKept);
  expect(screen.getByTestId("save").props.accessibilityState.disabled).toBe(false);
});
it.each(["metadata", "token-refresh"])("retains the current edit draft through %s", async (kind) => {
  const screen = await open();
  change(screen, "Unsaved A");
  const original = mockAuthStore.getState().session;
  if (!original) throw Error("Missing synthetic session");
  await act(async () => {
    if (kind === "metadata")
      mockAuthStore.setState({
        user: { ...original.user, user_metadata: { name: "refreshed" } },
        profile: profile("a", "New remote name"),
      });
    else
      activate(
        { ...original, access_token: original.access_token.replace(/c2ln$/, "c2lnMg") },
        profile("a", "New remote name"),
      );
  });
  expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Unsaved A");
});
it("old close callback cannot close a reopened editor", async () => {
  const screen = await open();
  const oldClose = mockCloseEdit;
  await act(async () => oldClose());
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  change(screen, "Reopened draft");
  await act(async () => oldClose());
  expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Reopened draft");
});
it("same-user replacement clears an old draft before another save", async () => {
  const screen = await open();
  change(screen, "Private old draft");
  await act(async () => activate(session("a"), profile("a", "Replacement name")));
  expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Replacement name");
});
it("unmounted upload cannot mutate a new component instance", async () => {
  const upload = deferred<string>();
  mockUpload.mockReturnValue(upload.promise);
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:synthetic", width: 10, height: 10 }] });
  const old = await open();
  fireEvent.press(old.getByText(strings.en.profileChangePhoto));
  await flush();
  fireEvent.press(old.getByTestId("save"));
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  old.unmount();
  activate(session("b"), profile("b"));
  const current = await open();
  change(current, "Draft B");
  await act(async () => upload.resolve("https://synthetic.example.invalid/old.png"));
  expect(mockWrite).not.toHaveBeenCalled();
  expect(current.getByLabelText(strings.en.authDisplayName).props.value).toBe("Draft B");
});
it("a second save while a photo uploads is not blocked, and both reach the server", async () => {
  const upload = deferred<string>();
  const url = "https://synthetic.example.invalid/old.png";
  mockUpload.mockReturnValue(upload.promise);
  mockWrite.mockImplementation(async (patch) => ({
    data: { ...mockAuthStore.getState().profile!, ...(patch as Partial<Profile>) },
    error: null,
  }));
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:synthetic", width: 10, height: 10 }] });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  change(screen, "New edit");
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockWrite).toHaveBeenCalledWith({ display_name: "New edit" }));
  expect(mockNotice).toHaveBeenCalledTimes(2);
  await act(async () => upload.resolve(url));
  await flush();
  expect(mockWrite).toHaveBeenCalledWith({ avatar_url: url });
  expect(mockAuthStore.getState().profile).toMatchObject({ display_name: "New edit", avatar_url: url });
});
it("a newer explicit intent without a store notification cancels the stale edit at completion", async () => {
  const upload = deferred<string>();
  mockUpload.mockReturnValue(upload.promise);
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:synthetic", width: 10, height: 10 }] });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  await act(async () => authCommands.transition(async () => undefined));
  await act(async () => upload.resolve("https://synthetic.example.invalid/old.png"));
  await flush();
  expect(mockWrite).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
  expect(mockNotice).not.toHaveBeenCalledWith(strings.en.profileSaveFailedDraftKept);
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  expect(screen.getByTestId("save").props.accessibilityState.disabled).toBe(true);
  change(screen, "New intent draft");
  expect(screen.getByTestId("save").props.accessibilityState.disabled).toBe(false);
});
it("current permission denial retains its existing localized notice", async () => {
  mockPermission.mockResolvedValue({ granted: false });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  expect(screen.getByText(strings.en.profilePhotoPermissionDenied)).toBeTruthy();
  expect(mockPicker).not.toHaveBeenCalled();
});

it("a captured old input event cannot replace another account's draft", async () => {
  const screen = await open();
  const oldChange = mockNameChange;
  await act(async () => activate(session("b"), profile("b")));
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  change(screen, "Draft B");
  await act(async () => oldChange("Private A"));
  expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Draft B");
});
it("stops save invalidations if its real Query cache subscriber replaces the account", async () => {
  mockWrite.mockResolvedValue({ data: profile("a", "Changed A"), error: null });
  const invalidate = jest.spyOn(mockQueryClient, "invalidateQueries");
  const unsubscribe = mockQueryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.query.queryKey[0] === "publicProfile") activate(session("b"), profile("b"));
  });
  const screen = await open();
  change(screen);
  fireEvent.press(screen.getByTestId("save"));
  await flush();
  expect(mockAuthStore.getState().user?.id).toBe(uid("b"));
  expect(invalidate).not.toHaveBeenCalled();
  expect(mockNotice).toHaveBeenCalledTimes(1);
  unsubscribe();
});
it("stops later invalidations if the first invalidation replaces the account", async () => {
  mockWrite.mockResolvedValue({ data: profile("a", "Changed A"), error: null });
  const real = mockQueryClient.invalidateQueries.bind(mockQueryClient);
  const invalidate = jest.spyOn(mockQueryClient, "invalidateQueries").mockImplementation((filters, options) => {
    const result = real(filters, options);
    activate(session("b"), profile("b"));
    return result;
  });
  const screen = await open();
  change(screen);
  fireEvent.press(screen.getByTestId("save"));
  await flush();
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(mockNotice).toHaveBeenCalledTimes(1);
});

it("a save superseded by a newer intent writes nothing after its upload settles", async () => {
  const upload = deferred<string>();
  mockUpload.mockReturnValue(upload.promise);
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:synthetic", width: 10, height: 10 }] });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  await act(async () => authCommands.transition(async () => undefined));
  expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
  await act(async () => upload.resolve("https://synthetic.example.invalid/old.png"));
  expect(mockWrite).not.toHaveBeenCalled();
});
it("uploads the current chosen avatar and saves its URL once", async () => {
  const asset = { uri: "file:synthetic", width: 10, height: 10 };
  const url = "https://synthetic.example.invalid/current.png";
  mockUpload.mockResolvedValue(url);
  mockPicker.mockResolvedValue({ canceled: false, assets: [asset] });
  mockWrite.mockResolvedValue({ data: { ...profile("a"), avatar_url: url }, error: null });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaved));
  expect(mockUpload).toHaveBeenCalledWith(uid("a"), asset);
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockWrite).toHaveBeenCalledWith({ avatar_url: url });
  expect(mockQueryClient.getQueryData(["publicProfile", uid("a")])).toEqual({ ...profile("a"), avatar_url: url });
});
it("removes the current existing avatar with an explicit null patch", async () => {
  mockAuthStore.setState({ profile: { ...profile("a"), avatar_url: "https://synthetic.example.invalid/current.png" } });
  mockWrite.mockResolvedValue({ data: profile("a"), error: null });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileRemovePhoto));
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaved));
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockWrite).toHaveBeenCalledWith({ avatar_url: null });
});
it("keeps the avatar draft after an upload rejection and saves it on retry", async () => {
  const url = "https://synthetic.example.invalid/retry.png";
  mockUpload.mockRejectedValueOnce(new Error("upload failed")).mockResolvedValueOnce(url);
  mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: "file:synthetic", width: 10, height: 10 }] });
  mockWrite.mockResolvedValue({ data: { ...profile("a"), avatar_url: url }, error: null });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  fireEvent.press(screen.getByTestId("save"));
  await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaveFailedDraftKept));
  expect(mockWrite).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  expect(screen.getByText(strings.en.profilePhotoFailed)).toBeTruthy();
  expect(screen.getByTestId("save").props.accessibilityState.disabled).toBe(false);
  fireEvent.press(screen.getByTestId("save"));
  await flush();
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect(mockWrite).toHaveBeenCalledWith({ avatar_url: url });
});

it("discards a late picker result after another account opens its editor", async () => {
  const picker = deferred<{ canceled: boolean; assets: { uri: string; width: number; height: number }[] }>();
  mockPicker.mockReturnValue(picker.promise);
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await waitFor(() => expect(mockPicker).toHaveBeenCalledTimes(1));
  await act(async () => activate(session("b"), profile("b")));
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  await act(async () =>
    picker.resolve({ canceled: false, assets: [{ uri: "file:private-a", width: 10, height: 10 }] }),
  );
  expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Name-b");
  expect(screen.getByTestId("save").props.accessibilityState.disabled).toBe(true);
  expect(mockUpload).not.toHaveBeenCalled();
});

it("waits for the first matching profile before allowing an edit or an empty write", async () => {
  mockAuthStore.setState({ profile: null });
  const screen = render(<ProfileModalContent />);
  await flush();
  const edit = screen.queryByLabelText(strings.en.profileEditAction);
  if (edit) fireEvent.press(edit);
  expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
  await act(async () => mockAuthStore.setState({ profile: { ...profile("a"), bio: "Existing bio", country: "PS" } }));
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Name-a");
  expect(screen.getByTestId("save").props.accessibilityState.disabled).toBe(true);
  await act(async () => mockSave());
  expect(mockWrite).not.toHaveBeenCalled();
});
it("renews closed-editor ownership after batched A-B-A without reviving captured callbacks", async () => {
  const original = mockAuthStore.getState().session;
  if (!original) throw Error("Missing synthetic session");
  const screen = render(<ProfileModalContent />);
  await flush();
  let button: typeof screen.root | null = screen.getByLabelText(strings.en.profileEditAction);
  while (button && typeof button.props.onPress !== "function") button = button.parent;
  if (!button) throw Error("Missing profile edit handler");
  const oldOpen: () => void = button.props.onPress;
  const oldClose = mockRootClose;
  await act(async () => {
    activate(session("b"), profile("b"));
    activate(original, profile("a"));
  });
  await act(async () => {
    oldOpen();
    oldClose();
  });
  expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
  expect(mockBack).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText(strings.en.profileEditAction));
  await flush();
  expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Name-a");
  fireEvent.press(screen.getByLabelText(strings.en.genericClose));
  await act(async () => mockRootClose());
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it.each(["name", "remove-avatar"])(
  "preserves newer stats in the actual store and Query cache after %s save",
  async (kind) => {
    if (kind === "remove-avatar")
      mockAuthStore.setState({ profile: { ...profile("a"), avatar_url: "https://synthetic.example.invalid/old.png" } });
    const pending = deferred<Response>();
    mockWrite.mockReturnValue(pending.promise);
    const screen = await open();
    if (kind === "name") change(screen);
    else fireEvent.press(screen.getByText(strings.en.profileRemovePhoto));
    fireEvent.press(screen.getByTestId("save"));
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    const stats = {
    };
    await act(async () => {
      const current = mockAuthStore.getState().profile;
      if (!current) throw Error("Missing current profile");
      mockAuthStore.setState({ profile: { ...current, ...stats } });
    });
    await act(async () => pending.resolve({ data: profile("a", kind === "name" ? "Changed A" : "a"), error: null }));
    await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaved));
    const accepted = mockAuthStore.getState().profile;
    const cached = mockQueryClient.getQueryData<Profile>(["publicProfile", uid("a")]);
    expect(accepted).toMatchObject({
      ...stats,
      ...(kind === "name" ? { display_name: "Changed A" } : { avatar_url: null }),
    });
    expect(cached).toEqual(accepted);
    expect(cached).toMatchObject(stats);
    expect(mockWrite).toHaveBeenCalledWith(kind === "name" ? { display_name: "Changed A" } : { avatar_url: null });
  },
);

it("caches newer same-owner stats published synchronously during the save notification", async () => {
  const stats = {
  };
  mockWrite.mockResolvedValue({ data: profile("a", "Changed A"), error: null });
  const screen = await open();
  change(screen);
  let observed = false;
  const unsubscribe = mockAuthStore.subscribe((state, previous) => {
    if (!observed && state.profile !== previous.profile && state.profile?.display_name === "Changed A") {
      observed = true;
      mockAuthStore.setState({ profile: { ...state.profile, ...stats } });
    }
  });
  try {
    fireEvent.press(screen.getByTestId("save"));
    await waitFor(() => expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaved));
    expect(observed).toBe(true);
    expect(mockAuthStore.getState().profile).toMatchObject({ ...stats, display_name: "Changed A" });
    expect(mockQueryClient.getQueryData(["publicProfile", uid("a")])).toEqual(mockAuthStore.getState().profile);
    expect(mockQueryClient.getQueryData(["publicProfile", uid("a")])).toMatchObject(stats);
  } finally {
    unsubscribe();
  }
});

it("closes the editor and shows the new name before the server answers", async () => {
  const pending = deferred<Response>();
  mockWrite.mockReturnValue(pending.promise);
  const screen = await open();
  change(screen);
  fireEvent.press(screen.getByTestId("save"));
  expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
  expect(mockNotice).toHaveBeenCalledWith(strings.en.profileSaved);
  expect(mockAuthStore.getState().profile?.display_name).toBe("Changed A");
  await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
  // A profile read during the save does not put the old name back.
  await act(async () => {
    await mockAuthStore.getState().fetchProfile();
  });
  expect(mockAuthStore.getState().profile?.display_name).toBe("Changed A");
  await act(async () => pending.resolve({ data: profile("a", "Changed A"), error: null }));
  await flush();
  expect(mockAuthStore.getState().profile?.display_name).toBe("Changed A");
  expect(mockQueryClient.getQueryData(["publicProfile", uid("a")])).toEqual(profile("a", "Changed A"));
});

it("asks before discarding changed fields; keep editing retains them", async () => {
  const screen = await open();
  change(screen, "Unsaved A");
  act(() => mockCloseEdit());
  expect(screen.getByText(strings.en.discardChangesMessage)).toBeTruthy();
  fireEvent.press(screen.getByText(strings.en.discardChangesKeepEditing));
  expect(screen.getByLabelText(strings.en.authDisplayName).props.value).toBe("Unsaved A");
  act(() => mockCloseEdit());
  fireEvent.press(screen.getByText(strings.en.discardChangesConfirm));
  await flush();
  expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
  expect(mockWrite).not.toHaveBeenCalled();
});

it("closes an unchanged editor without asking", async () => {
  const screen = await open();
  act(() => mockCloseEdit());
  await flush();
  expect(screen.queryByText(strings.en.discardChangesMessage)).toBeNull();
  expect(screen.queryByLabelText(strings.en.authDisplayName)).toBeNull();
});

it("rejects an unsupported or undecoded photo before upload and keeps the previous draft", async () => {
  mockPicker.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:synthetic.heic", mimeType: "image/heic", width: 10, height: 10 }],
  });
  const screen = await open();
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  expect(screen.getByText(strings.en.profilePhotoInvalidType)).toBeTruthy();
  mockPicker.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:synthetic.png", mimeType: "image/png", width: 0, height: 0 }] });
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  expect(screen.getByText(strings.en.profilePhotoUnreadable)).toBeTruthy();
  mockPicker.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:synthetic.png", mimeType: "image/png", width: 10, height: 10, fileSize: 3 * 1024 * 1024 + 1 }],
  });
  fireEvent.press(screen.getByText(strings.en.profileChangePhoto));
  await flush();
  expect(screen.getByText(strings.en.profilePhotoTooLarge)).toBeTruthy();
  // Nothing was taken as a draft, so Save stays unavailable and nothing uploads.
  expect(screen.getByTestId("save").props.accessibilityState?.disabled ?? screen.getByTestId("save").props.disabled).toBe(true);
  expect(mockUpload).not.toHaveBeenCalled();
});

it("labels the owner's figures as local while sync waits for restore consent", async () => {
  mockRestorePause = "pending_consent";
  const screen = render(<ProfileModalContent />);
  await flush();
  expect(screen.getByText(strings.en.profileStatsAwaitingSync)).toBeTruthy();
  mockRestorePause = null;
  screen.rerender(<ProfileModalContent />);
  expect(screen.queryByText(strings.en.profileStatsAwaitingSync)).toBeNull();
});
