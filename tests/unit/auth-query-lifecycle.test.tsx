import React, { StrictMode, useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  onlineManager,
  isCancelledError,
  useQueryClient,
} from "@tanstack/react-query";
import { bindAuthQueryCache } from "@/lib/query/auth-cache-lifecycle";
import { authCommands } from "@/lib/auth/commands";
import { useAuthStore } from "@/lib/auth/store";
import type { Session, User } from "@supabase/supabase-js";
import RootLayout from "@/app/_layout";

let mockRootClient: QueryClient | null = null;
let mockObserveViewer = false;
const mockViewerRead = jest.fn<Promise<string>, []>();
const mockViewerKey = ["currentUserPublicAchievementUnlocks", "00000000-0000-4000-8000-000000000001"];
const mockLoadFonts = jest.fn<Promise<void>, []>(async () => undefined);
jest.mock("@/global.css", () => ({}));
jest.mock("expo-font", () => ({ loadAsync: () => mockLoadFonts() }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn(async () => undefined) }));
jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  const ViewerProbe = () => {
    const { useQuery } = jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
    const result = useQuery({ queryKey: mockViewerKey, queryFn: () => mockViewerRead(), staleTime: Infinity });
    return React.createElement(Text, { testID: "viewer-result" }, result.data ?? "empty viewer result");
  };
  const Stack = ({ children }: { children: React.ReactNode }) => {
    const { useQueryClient } = jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
    mockRootClient = useQueryClient();
    return React.createElement(
      View,
      { testID: "root-stack" },
      children,
      mockObserveViewer ? React.createElement(ViewerProbe) : null,
    );
  };
  Stack.Screen = () => null;
  return { Stack, usePathname: () => "/profile" };
});
jest.mock("@rn-primitives/portal", () => ({ PortalHost: () => null }));
jest.mock("@/lib/auth/password-recovery", () => ({
  PasswordRecoveryProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/lib/database/provider", () => ({
  DatabaseProvider: ({ children }: { children: React.ReactNode }) => children,
  useDatabaseStatus: () => ({ db: null }),
}));
jest.mock("@/lib/audio/ayah-audio", () => ({
  AyahAudioProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/lib/fonts/ui-fonts", () => ({ UI_FONTS: {}, loadUiFontsWeb: async () => undefined }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
  updateOwnedPassword: jest.fn(),
  signOutOwnedSession: jest.fn(),
  restoreOwnedSession: jest.fn(),
  readOwnedSession: jest.fn(),
}));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));

const scopedRoots = [
  "reflectionFeed",
  "reflections",
  "reflectionComments",
  "currentUserPublicAchievementUnlocks",
] as const;
const publicKeys = [
  ["leaderboard", "daily"],
  ["publicProfile", "synthetic-user"],
  ["publicAchievementUnlocks", "synthetic-user"],
  ["publicReviewActivity", "synthetic-user"],
  ["publicSurahProgress", "synthetic-user"],
  ["reflectionCount", 1, 1],
  ["reflectionFeedOptions", "en"],
] as const;
const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
let serial = 0;

function sessionFor(id: string, sessionId = `10000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`): Session {
  const user: User = { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    user,
    access_token: [
      { alg: "HS256", typ: "JWT" },
      { sub: id, session_id: sessionId, exp, role: "authenticated" },
      "synthetic-signature",
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
      .join("."),
    refresh_token: `refresh-${sessionId}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
  };
}
function setIdentity(session: Session | null) {
  act(() => useAuthStore.setState({ session, user: session?.user ?? null }));
}
function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}
function seed(queryClient: QueryClient) {
  scopedRoots.forEach((root) => queryClient.setQueryData([root, "seed"], root));
  publicKeys.forEach((key) => queryClient.setQueryData([...key], key.join("/")));
}
function scopedData(queryClient: QueryClient) {
  return scopedRoots.map((root) => queryClient.getQueryData([root, "seed"]));
}
function expectScopedCleared(queryClient: QueryClient) {
  expect(scopedData(queryClient)).toEqual([undefined, undefined, undefined, undefined]);
}
function expectScopedPresent(queryClient: QueryClient) {
  expect(scopedData(queryClient)).toEqual([...scopedRoots]);
}
function expectPublicPresent(queryClient: QueryClient) {
  publicKeys.forEach((key) => expect(queryClient.getQueryData([...key])).toBe(key.join("/")));
}

beforeEach(() => {
  mockRootClient = null;
  mockObserveViewer = false;
  mockViewerRead.mockReset().mockResolvedValue("current viewer result");
  mockLoadFonts.mockReset().mockResolvedValue(undefined);
  useAuthStore.setState({
    session: null,
    user: null,
    profile: null,
    isLoading: false,
    isInitialized: true,
    error: null,
  });
});
afterEach(() => {
  mockRootClient?.clear();
  jest.restoreAllMocks();
  useAuthStore.setState({
    session: null,
    user: null,
    profile: null,
    isLoading: false,
    isInitialized: true,
    error: null,
  });
});

describe("auth-scoped query cache lifecycle", () => {
  it("evicts exactly the four scoped roots on an unknown initial binding and keeps public roots", () => {
    const queryClient = client();
    seed(queryClient);
    const stop = bindAuthQueryCache(queryClient);
    expectScopedCleared(queryClient);
    expectPublicPresent(queryClient);
    stop();
    queryClient.clear();
  });

  it("keeps an empty initial cache empty without shifting public query offsets", () => {
    const queryClient = client();
    const before = queryClient.getQueryCache().getAll().length;
    const stop = bindAuthQueryCache(queryClient);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(before);
    expect(queryClient.getQueryData(["leaderboard", "daily", 0])).toBeUndefined();
    stop();
    queryClient.clear();
  });

  it("evicts the scoped cache when the actual auth store moves A to B, but preserves public data", () => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    seed(queryClient);
    const stop = bindAuthQueryCache(queryClient);
    expectScopedCleared(queryClient);
    seed(queryClient);
    setIdentity(sessionFor(userB));
    expectScopedCleared(queryClient);
    expectPublicPresent(queryClient);
    stop();
    queryClient.clear();
  });

  it("evicts on sign-out and on a new session for the same user", () => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    seed(queryClient);
    setIdentity(sessionFor(userA));
    expectScopedCleared(queryClient);
    seed(queryClient);
    setIdentity(null);
    expectScopedCleared(queryClient);
    stop();
    queryClient.clear();
  });

  it("observes batched A to B to the original A session", () => {
    const queryClient = client();
    const original = sessionFor(userA);
    setIdentity(original);
    const owner = authCommands.captureOwner();
    const stop = bindAuthQueryCache(queryClient);
    seed(queryClient);
    act(() => {
      useAuthStore.setState({ session: sessionFor(userB), user: { ...original.user, id: userB } });
      expectScopedCleared(queryClient);
      seed(queryClient);
      useAuthStore.setState({ session: original, user: original.user });
    });
    expect(owner.isCurrent()).toBe(false);
    expectScopedCleared(queryClient);
    expectPublicPresent(queryClient);
    stop();
    queryClient.clear();
  });

  it("clears on an actual explicit auth intent even before the next identity is published", async () => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    seed(queryClient);
    await authCommands.transition(async () => {
      useAuthStore.setState({ isLoading: true });
    });
    expectScopedCleared(queryClient);
    expectPublicPresent(queryClient);
    stop();
    queryClient.clear();
  });

  it("aborts a scoped pending query and ignores its late successful result", async () => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    let resolve!: (value: string) => void;
    let observedSignal: AbortSignal | undefined;
    const observer = new QueryObserver(queryClient, {
      queryKey: ["reflectionFeed", "pending"],
      queryFn: ({ signal }) => {
        observedSignal = signal;
        return new Promise<string>((done) => {
          resolve = done;
        });
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await waitFor(() => expect(resolve).toBeDefined());
    setIdentity(sessionFor(userB));
    expect(observedSignal?.aborted).toBe(true);
    await act(async () => {
      resolve("late private result");
      await Promise.resolve();
    });
    expect(queryClient.getQueryData(["reflectionFeed", "pending"])).toBeUndefined();
    unsubscribe();
    stop();
    queryClient.clear();
  });

  it("does not cancel a live public pending query", async () => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    let resolve!: (value: string) => void;
    let observedSignal: AbortSignal | undefined;
    const observer = new QueryObserver(queryClient, {
      queryKey: ["publicProfile", "pending"],
      queryFn: ({ signal }) => {
        observedSignal = signal;
        return new Promise<string>((done) => {
          resolve = done;
        });
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await waitFor(() => expect(resolve).toBeDefined());
    setIdentity(sessionFor(userB));
    expect(observedSignal?.aborted).toBe(false);
    await act(async () => {
      resolve("public result");
      await Promise.resolve();
    });
    await waitFor(() => expect(queryClient.getQueryData(["publicProfile", "pending"])).toBe("public result"));
    unsubscribe();
    stop();
    queryClient.clear();
  });

  it("keeps scoped and public data through same-identity token and metadata refresh", () => {
    const queryClient = client();
    const first = sessionFor(userA);
    setIdentity(first);
    const stop = bindAuthQueryCache(queryClient);
    seed(queryClient);
    const refreshed = {
      ...first,
      access_token: first.access_token.replace(/[^.]+$/, "cmVmcmVzaGVk"),
      user: { ...first.user, user_metadata: { name: "new metadata" } },
    };
    setIdentity(refreshed);
    expectScopedPresent(queryClient);
    expectPublicPresent(queryClient);
    stop();
    queryClient.clear();
  });

  it("stops reacting after unbind, then detects an identity change while detached on rebind", () => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    seed(queryClient);
    stop();
    setIdentity(sessionFor(userB));
    expectScopedPresent(queryClient);
    const rebind = bindAuthQueryCache(queryClient);
    expectScopedCleared(queryClient);
    rebind();
    queryClient.clear();
  });

  it("retains the cache across same-owner unbind/rebind and StrictMode effect remount", () => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const first = bindAuthQueryCache(queryClient);
    seed(queryClient);
    first();
    const second = bindAuthQueryCache(queryClient);
    expectScopedPresent(queryClient);
    second();
    function Binding() {
      const current = useQueryClient();
      useEffect(() => bindAuthQueryCache(current), [current]);
      return null;
    }
    const view = render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <Binding />
        </QueryClientProvider>
      </StrictMode>,
    );
    expectScopedPresent(queryClient);
    view.unmount();
    expectScopedPresent(queryClient);
    queryClient.clear();
  });

  it("tracks bindings and detached ownership independently for separate clients", () => {
    const first = client();
    const second = client();
    setIdentity(sessionFor(userA));
    seed(first);
    seed(second);
    const stopFirst = bindAuthQueryCache(first);
    expectScopedCleared(first);
    expectScopedPresent(second);
    const stopSecond = bindAuthQueryCache(second);
    expectScopedCleared(second);
    seed(first);
    seed(second);
    stopFirst();
    setIdentity(sessionFor(userB));
    expectScopedPresent(first);
    expectScopedCleared(second);
    const rebindFirst = bindAuthQueryCache(first);
    expectScopedCleared(first);
    rebindFirst();
    stopSecond();
    first.clear();
    second.clear();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("query cancellation boundaries", () => {
  it.each(scopedRoots)("ignores a late rejected %s transport after cancellation", async (root) => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    const transport = deferred<string>();
    let signal: AbortSignal | undefined;
    const key = [root, "held-rejection"];
    const result = queryClient
      .fetchQuery({
        queryKey: key,
        queryFn: (context) => {
          signal = context.signal;
          return transport.promise;
        },
      })
      .catch((error: unknown) => error);
    expect(signal?.aborted).toBe(false);
    setIdentity(sessionFor(userB));
    expect(signal?.aborted).toBe(true);
    expect(isCancelledError(await result)).toBe(true);
    await act(async () => {
      transport.reject(new Error("late transport failure"));
      await Promise.resolve();
    });
    expect(queryClient.getQueryState(key)).toBeUndefined();
    stop();
    queryClient.clear();
  });

  it("a non-cooperative old transport cannot replace a fresh same-key result after A-B-A", async () => {
    const queryClient = client();
    const original = sessionFor(userA);
    setIdentity(original);
    const stop = bindAuthQueryCache(queryClient);
    const transport = deferred<string>();
    const key = ["currentUserPublicAchievementUnlocks", userA];
    const old = queryClient
      .fetchQuery({ queryKey: key, queryFn: () => transport.promise })
      .catch((error: unknown) => error);
    setIdentity(sessionFor(userB));
    setIdentity(original);
    expect(isCancelledError(await old)).toBe(true);
    queryClient.setQueryData(key, "fresh A result");
    await act(async () => {
      transport.resolve("obsolete A result");
      await Promise.resolve();
    });
    expect(queryClient.getQueryData(key)).toBe("fresh A result");
    stop();
    queryClient.clear();
  });

  it("does not hide a pending public query error across an account replacement", async () => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    const transport = deferred<string>();
    const failure = new Error("public request failed");
    const key = ["publicSurahProgress", "public-target"];
    const result = queryClient
      .fetchQuery({ queryKey: key, queryFn: () => transport.promise })
      .catch((error: unknown) => error);
    setIdentity(sessionFor(userB));
    transport.reject(failure);
    expect(await result).toBe(failure);
    expect(queryClient.getQueryState(key)?.error).toBe(failure);
    stop();
    queryClient.clear();
  });

  it("detects a coordinator-only intent when a detached client is rebound", async () => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    seed(queryClient);
    stop();
    await authCommands.transition(async () => undefined);
    expectScopedPresent(queryClient);
    const rebound = bindAuthQueryCache(queryClient);
    expectScopedCleared(queryClient);
    expectPublicPresent(queryClient);
    rebound();
    queryClient.clear();
  });
});

describe("actual root cache binding", () => {
  it.each([false, true])(
    "removes viewer/local cache on account switch through the actual root, strict=%s",
    async (strict) => {
      setIdentity(sessionFor(userA));
      const screen = render(
        strict ? (
          <StrictMode>
            <RootLayout />
          </StrictMode>
        ) : (
          <RootLayout />
        ),
      );
      await waitFor(() => expect(screen.getByTestId("root-stack")).toBeTruthy());
      const current = mockRootClient;
      if (!current) throw Error("Root QueryClient was not exposed by provider probe");
      seed(current);
      setIdentity(sessionFor(userB));
      expectScopedCleared(current);
      expectPublicPresent(current);
      screen.unmount();
      seed(current);
      setIdentity(null);
      expectScopedPresent(current);
      current.clear();
    },
  );

  it("binds while the native font gate is pending", async () => {
    setIdentity(sessionFor(userA));
    const fonts = deferred<void>();
    mockLoadFonts.mockReturnValue(fonts.promise);
    const cancellation = jest.spyOn(QueryClient.prototype, "getQueryCache");
    const screen = render(<RootLayout />);
    await waitFor(() => expect(mockLoadFonts).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("root-stack")).toBeNull();
    const current = cancellation.mock.contexts.find((value) => value instanceof QueryClient);
    if (!current) throw Error("No actual root cache binding before fonts resolved");
    seed(current);
    setIdentity(sessionFor(userB));
    expectScopedCleared(current);
    expectPublicPresent(current);
    await act(async () => {
      fonts.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("root-stack")).toBeTruthy());
    expect(mockRootClient).toBe(current);
    screen.unmount();
    current.clear();
  });
});

it("an obsolete cleanup cannot remove data created by a reentrant replacement owner", async () => {
  const queryClient = client();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflectionFeed", "reentrant"];
  queryClient.setQueryData(key, "A data");
  const transport = deferred<string>();
  const pending = queryClient
    .fetchQuery({ queryKey: key, queryFn: () => transport.promise })
    .catch((error: unknown) => error);
  let replaced = false;
  const c = sessionFor("00000000-0000-4000-8000-000000000003");
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      !replaced &&
      event.type === "updated" &&
      event.query.queryKey[0] === "reflectionFeed" &&
      useAuthStore.getState().user?.id === userB
    ) {
      replaced = true;
      useAuthStore.setState({ session: c, user: c.user });
      queryClient.setQueryData(key, "fresh C data");
    }
  });
  try {
    setIdentity(sessionFor(userB));
    expect(replaced).toBe(true);
    await pending;
    expect(useAuthStore.getState().user?.id).toBe(c.user.id);
    expect(queryClient.getQueryData(key)).toBe("fresh C data");
    await act(async () => {
      transport.resolve("late A result");
      await Promise.resolve();
    });
    expect(queryClient.getQueryData(key)).toBe("fresh C data");
  } finally {
    unsubscribe();
    stop();
    transport.resolve("late A result");
    await pending;
    queryClient.clear();
  }
});

it.each(["same-user-new-session", "batched-original-session-a-b-a"])(
  "clears a mounted resolved viewer result and permits a fresh read after %s",
  async (kind) => {
    const original = sessionFor(userA);
    setIdentity(original);
    const screen = render(<RootLayout />);
    await waitFor(() => expect(screen.getByTestId("root-stack")).toBeTruthy());
    const current = mockRootClient;
    if (!current) throw Error("Missing root client");
    current.setQueryData(mockViewerKey, "old owner local result");
    const originalQuery = current.getQueryCache().find({ queryKey: mockViewerKey, exact: true });
    const transport = deferred<string>();
    mockViewerRead.mockReturnValue(transport.promise);
    try {
      mockObserveViewer = true;
      screen.rerender(<RootLayout />);
      expect(screen.getByTestId("viewer-result").props.children).toBe("old owner local result");
      expect(mockViewerRead).not.toHaveBeenCalled();
      act(() => {
        if (kind === "batched-original-session-a-b-a") {
          const b = sessionFor(userB);
          useAuthStore.setState({ session: b, user: b.user });
          useAuthStore.setState({ session: original, user: original.user });
        } else {
          const next = { ...sessionFor(userA), user: original.user };
          useAuthStore.setState({ session: next, user: original.user });
        }
      });
      await waitFor(() =>
        expect(screen.getByTestId("viewer-result").props.children).not.toBe("old owner local result"),
      );
      await waitFor(() => expect(mockViewerRead).toHaveBeenCalled());
      expect(screen.getByTestId("viewer-result").props.children).toBe("empty viewer result");
      await act(async () => {
        transport.resolve("fresh owner local result");
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByTestId("viewer-result").props.children).toBe("fresh owner local result"));
      expect(current.getQueryData(mockViewerKey)).toBe("fresh owner local result");
    } finally {
      transport.resolve("fixture cleanup");
      screen.unmount();
      originalQuery?.destroy();
      current.clear();
    }
  },
);

it("clears a mounted observer without automatically invoking its old-viewer query function", () => {
  const queryClient = client();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflectionComments", "resolved-observer"];
  queryClient.setQueryData(key, "A result");
  const oldRead = jest.fn(async () => "old-viewer transport");
  const observer = new QueryObserver(queryClient, {
    queryKey: key,
    queryFn: oldRead,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    expect(observer.getCurrentResult().data).toBe("A result");
    setIdentity(sessionFor(userB));
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(queryClient.getQueryData(key)).toBeUndefined();
    expect(oldRead).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    observer.destroy();
    stop();
    queryClient.clear();
  }
});

it("preserves fresh data after a callback synchronously unbinds the lifecycle", async () => {
  const queryClient = client();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflections", "detach-during-cancel"];
  queryClient.setQueryData(key, "A result");
  const transport = deferred<string>();
  const pending = queryClient
    .fetchQuery({ queryKey: key, queryFn: () => transport.promise })
    .catch((error: unknown) => error);
  let detached = false;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      !detached &&
      event.type === "updated" &&
      event.query.queryKey[0] === "reflections" &&
      useAuthStore.getState().user?.id === userB
    ) {
      detached = true;
      stop();
      queryClient.setQueryData(key, "fresh B after detached");
    }
  });
  try {
    setIdentity(sessionFor(userB));
    expect(detached).toBe(true);
    await pending;
    expect(queryClient.getQueryData(key)).toBe("fresh B after detached");
    transport.resolve("late A result");
    await Promise.resolve();
    expect(queryClient.getQueryData(key)).toBe("fresh B after detached");
  } finally {
    unsubscribe();
    stop();
    transport.resolve("fixture cleanup");
    await pending;
    queryClient.clear();
  }
});

it("retains fresh same-owner data published synchronously during reset", () => {
  const queryClient = client();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflections", "reset-publication"];
  queryClient.setQueryData(key, "A data");
  let replaced = false;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      !replaced &&
      event.type === "updated" &&
      event.query.queryKey[0] === "reflections" &&
      event.query.state.data === undefined &&
      useAuthStore.getState().user?.id === userB
    ) {
      replaced = true;
      queryClient.setQueryData(key, "fresh B data");
    }
  });
  try {
    setIdentity(sessionFor(userB));
    expect(replaced).toBe(true);
    expect(queryClient.getQueryData(key)).toBe("fresh B data");
  } finally {
    unsubscribe();
    stop();
    queryClient.clear();
  }
});

it.each(["resolve", "reject"])(
  "does not abort fresh work admitted by reset or erase its replacement owner, %s",
  async (kind) => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    const key = ["reflectionFeed", "reset-abort-replacement"];
    queryClient.setQueryData(key, "A data");
    const transport = deferred<string>();
    let pending: Promise<unknown> | undefined;
    let started = false;
    let aborted = false;
    const c = sessionFor("00000000-0000-4000-8000-000000000003");
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        !started &&
        event.type === "updated" &&
        event.query.queryKey[0] === "reflectionFeed" &&
        event.query.state.data === undefined &&
        useAuthStore.getState().user?.id === userB
      ) {
        started = true;
        pending = queryClient
          .fetchQuery({
            queryKey: key,
            queryFn: ({ signal }) => {
              signal.addEventListener("abort", () => {
                aborted = true;
                useAuthStore.setState({ session: c, user: c.user });
                queryClient.setQueryData(key, "fresh C data");
              });
              return transport.promise;
            },
          })
          .catch((error: unknown) => error);
      }
    });
    try {
      setIdentity(sessionFor(userB));
      expect(started).toBe(true);
      if (aborted) expect(queryClient.getQueryData(key)).toBe("fresh C data");
      expect(aborted).toBe(false);
      if (kind === "resolve") {
        transport.resolve("fresh B data");
        await pending;
        expect(queryClient.getQueryData(key)).toBe("fresh B data");
      } else {
        const failure = new Error("current B transport failure");
        transport.reject(failure);
        expect(await pending).toBe(failure);
        expect(queryClient.getQueryState(key)?.error).toBe(failure);
      }
    } finally {
      unsubscribe();
      stop();
      transport.resolve("fixture cleanup");
      await pending;
      queryClient.clear();
    }
  },
);

it("retires the entire captured snapshot despite unbind and preserves fresh same-owner data on rebind", async () => {
  const queryClient = client();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflections", "stop-first"];
  queryClient.setQueryData(key, "A first");
  queryClient.setQueryData(["reflectionComments", "untouched"], "A remaining");
  const transport = deferred<string>();
  const pending = queryClient
    .fetchQuery({ queryKey: key, queryFn: () => transport.promise })
    .catch((error: unknown) => error);
  let detached = false;
  let rebound: (() => void) | undefined;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      !detached &&
      event.type === "updated" &&
      event.query.queryKey[0] === "reflections" &&
      useAuthStore.getState().user?.id === userB
    ) {
      detached = true;
      stop();
      queryClient.setQueryData(["reflectionComments", "untouched"], "fresh B");
    }
  });
  try {
    setIdentity(sessionFor(userB));
    expect(detached).toBe(true);
    expect(queryClient.getQueryData(["reflectionComments", "untouched"])).toBe("fresh B");
    rebound = bindAuthQueryCache(queryClient);
    expect(queryClient.getQueryData(["reflectionComments", "untouched"])).toBe("fresh B");
  } finally {
    unsubscribe();
    rebound?.();
    stop();
    transport.resolve("fixture cleanup");
    await pending;
    queryClient.clear();
  }
});

it("does not restart its own active eviction for a same-owner store notification", () => {
  const queryClient = client();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflections", "same-owner-notification"];
  queryClient.setQueryData(key, "A data");
  let resets = 0;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.query.queryKey[1] === "same-owner-notification" &&
      event.query.state.data === undefined &&
      useAuthStore.getState().user?.id === userB
    ) {
      resets += 1;
      if (resets < 3) useAuthStore.setState({ isLoading: !useAuthStore.getState().isLoading });
    }
  });
  try {
    setIdentity(sessionFor(userB));
    expect(resets).toBe(1);
    expect(queryClient.getQueryData(key)).toBeUndefined();
  } finally {
    unsubscribe();
    stop();
    queryClient.clear();
  }
});

it.each([{ fresh: null }, { fresh: [] }])("retains fresh defined empty data during reset: %p", ({ fresh }) => {
  const queryClient = client();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflections", "empty-current-result"];
  queryClient.setQueryData(key, "A data");
  let replaced = false;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      !replaced &&
      event.type === "updated" &&
      event.query.queryKey[1] === "empty-current-result" &&
      event.query.state.data === undefined &&
      useAuthStore.getState().user?.id === userB
    ) {
      replaced = true;
      queryClient.setQueryData(key, fresh);
    }
  });
  try {
    setIdentity(sessionFor(userB));
    expect(replaced).toBe(true);
    expect(queryClient.getQueryData(key)).toBe(fresh);
  } finally {
    unsubscribe();
    stop();
    queryClient.clear();
  }
});

it("retains newly paused current-owner work and lets it finish after connectivity returns", async () => {
  const queryClient = client();
  queryClient.mount();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflections", "paused-current-read"];
  queryClient.setQueryData(key, "A data");
  const read = jest.fn(async () => "fresh B data");
  let pending: Promise<unknown> | undefined;
  let started = false;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      !started &&
      event.type === "updated" &&
      event.query.queryKey[1] === "paused-current-read" &&
      event.query.state.data === undefined &&
      useAuthStore.getState().user?.id === userB
    ) {
      started = true;
      pending = queryClient
        .fetchQuery({ queryKey: key, queryFn: read, networkMode: "online" })
        .catch((error: unknown) => error);
    }
  });
  try {
    onlineManager.setOnline(false);
    setIdentity(sessionFor(userB));
    expect(started).toBe(true);
    expect(queryClient.getQueryState(key)?.fetchStatus).toBe("paused");
    expect(read).not.toHaveBeenCalled();
    onlineManager.setOnline(true);
    expect(await pending).toBe("fresh B data");
    expect(queryClient.getQueryData(key)).toBe("fresh B data");
  } finally {
    unsubscribe();
    stop();
    onlineManager.setOnline(true);
    await pending;
    queryClient.unmount();
    queryClient.clear();
  }
});

it.each([{ fresh: "fresh B data" }, { fresh: null }, { fresh: [] }])(
  "retains a fresh current-owner publication made by cancellation: %p",
  async ({ fresh }) => {
    const queryClient = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(queryClient);
    const key = ["reflections", "cancellation-publication"];
    queryClient.setQueryData(key, "old A data");
    const transport = deferred<string>();
    let published = false;
    const pending = queryClient
      .fetchQuery({
        queryKey: key,
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            if (useAuthStore.getState().user?.id === userB) {
              published = true;
              queryClient.setQueryData(key, fresh);
            }
          });
          return transport.promise;
        },
      })
      .catch((error: unknown) => error);
    try {
      setIdentity(sessionFor(userB));
      expect(published).toBe(true);
      await pending;
      expect(queryClient.getQueryData(key)).toBe(fresh);
      transport.resolve("obsolete A result");
      await Promise.resolve();
      expect(queryClient.getQueryData(key)).toBe(fresh);
    } finally {
      stop();
      transport.resolve("fixture cleanup");
      await pending;
      queryClient.clear();
    }
  },
);

it("does not let an obsolete bulk cancellation abort replacement work on its second captured query", async () => {
  const queryClient = client();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const first = ["reflectionFeed", "cancel-first"];
  const second = ["reflections", "cancel-second"];
  const a1 = deferred<string>();
  const a2 = deferred<string>();
  const fresh = deferred<string>();
  queryClient.setQueryData(first, "A first");
  queryClient.setQueryData(second, "A second");
  const firstPending = queryClient
    .fetchQuery({ queryKey: first, queryFn: () => a1.promise })
    .catch((error: unknown) => error);
  const secondPending = queryClient
    .fetchQuery({ queryKey: second, queryFn: () => a2.promise })
    .catch((error: unknown) => error);
  const c = sessionFor("00000000-0000-4000-8000-000000000003");
  let replaced = false;
  let started = false;
  let signal: AbortSignal | undefined;
  let currentPending: Promise<unknown> | undefined;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    if (!replaced && event.query.queryKey[1] === "cancel-first" && useAuthStore.getState().user?.id === userB) {
      replaced = true;
      useAuthStore.setState({ session: c, user: c.user });
    }
    if (
      !started &&
      event.query.queryKey[1] === "cancel-second" &&
      event.query.state.data === undefined &&
      useAuthStore.getState().user?.id === c.user.id
    ) {
      started = true;
      currentPending = queryClient
        .fetchQuery({
          queryKey: second,
          queryFn: (context) => {
            signal = context.signal;
            return fresh.promise;
          },
        })
        .catch((error: unknown) => error);
    }
  });
  try {
    setIdentity(sessionFor(userB));
    expect(replaced).toBe(true);
    expect(started).toBe(true);
    expect(signal?.aborted).toBe(false);
    fresh.resolve("fresh C result");
    expect(await currentPending).toBe("fresh C result");
    expect(queryClient.getQueryData(second)).toBe("fresh C result");
    a1.resolve("obsolete A first");
    a2.resolve("obsolete A second");
    await Promise.all([firstPending, secondPending]);
    expect(queryClient.getQueryData(second)).toBe("fresh C result");
  } finally {
    unsubscribe();
    stop();
    a1.resolve("cleanup");
    a2.resolve("cleanup");
    fresh.resolve("cleanup");
    await Promise.all([firstPending, secondPending, currentPending]);
    queryClient.clear();
  }
});

it.each([
  { outcome: "resolve", paused: false },
  { outcome: "reject", paused: false },
  { outcome: "cancel", paused: false },
  { outcome: "resolve", paused: true },
  { outcome: "reject", paused: true },
  { outcome: "cancel", paused: true },
])("isolates replacement work and rollback admitted by abort: %p", async ({ outcome, paused }) => {
  const queryClient = client();
  queryClient.mount();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflectionComments", "abort-admitted"];
  queryClient.setQueryData(key, "private A data");
  const a = deferred<string>();
  const b = deferred<string>();
  let started = false;
  let signal: AbortSignal | undefined;
  let current: Promise<unknown> | undefined;
  const original = queryClient.getQueryCache().find({ queryKey: key, exact: true });
  const old = queryClient
    .fetchQuery({
      queryKey: key,
      queryFn: ({ signal: oldSignal }) => {
        oldSignal.addEventListener("abort", () => {
          if (started) return;
          started = true;
          current = queryClient
            .fetchQuery({
              queryKey: key,
              queryFn: (context) => {
                signal = context.signal;
                return b.promise;
              },
            })
            .catch((error: unknown) => error);
        });
        return a.promise;
      },
    })
    .catch((error: unknown) => error);
  try {
    if (paused) onlineManager.setOnline(false);
    setIdentity(sessionFor(userB));
    expect(started).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: key, exact: true })).not.toBe(original);
    expect(queryClient.getQueryData(key)).toBeUndefined();
    expect(queryClient.getQueryState(key)?.fetchStatus).toBe(paused ? "paused" : "fetching");
    if (outcome === "cancel") {
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      expect(isCancelledError(await current)).toBe(true);
      expect(queryClient.getQueryData(key)).toBeUndefined();
      expect(queryClient.getQueryState(key)?.error).toBeNull();
    } else {
      onlineManager.setOnline(true);
      await waitFor(() => expect(signal).toBeDefined());
      expect(signal?.aborted).toBe(false);
      if (outcome === "resolve") {
        b.resolve("fresh B");
        expect(await current).toBe("fresh B");
        expect(queryClient.getQueryData(key)).toBe("fresh B");
      } else {
        const error = new Error("current B failure");
        b.reject(error);
        expect(await current).toBe(error);
        expect(queryClient.getQueryState(key)?.error).toBe(error);
      }
    }
    a.resolve("late A");
    await old;
    expect(queryClient.getQueryData(key)).not.toBe("private A data");
    expect(queryClient.getQueryData(key)).not.toBe("late A");
  } finally {
    stop();
    onlineManager.setOnline(true);
    await queryClient.cancelQueries({ queryKey: key, exact: true });
    a.resolve("cleanup");
    b.resolve("cleanup");
    await Promise.all([old, current]);
    queryClient.unmount();
    queryClient.clear();
  }
});

it("retains reset-time current data across a synchronous same-owner store notification", () => {
  const queryClient = client();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(queryClient);
  const key = ["reflections", "publication-and-metadata"];
  queryClient.setQueryData(key, "A data");
  let replaced = false;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (
      !replaced &&
      event.type === "updated" &&
      event.query.queryKey[1] === "publication-and-metadata" &&
      event.query.state.data === undefined &&
      useAuthStore.getState().user?.id === userB
    ) {
      replaced = true;
      queryClient.setQueryData(key, "fresh B data");
      useAuthStore.setState({ isLoading: true });
    }
  });
  try {
    setIdentity(sessionFor(userB));
    expect(replaced).toBe(true);
    expect(queryClient.getQueryData(key)).toBe("fresh B data");
  } finally {
    unsubscribe();
    stop();
    queryClient.clear();
  }
});

it.each([{ fresh: "fresh B" }, { fresh: null }, { fresh: [] }])(
  "preserves current-owner publication on another captured key during abort: %p",
  async ({ fresh }) => {
    const c = client();
    setIdentity(sessionFor(userA));
    const stop = bindAuthQueryCache(c);
    const first = ["reflectionFeed", "cross-key-first"];
    const second = ["reflections", "cross-key-second"];
    const a = deferred<string>();
    c.setQueryData(first, "A first");
    c.setQueryData(second, "A second");
    const previousSecond = c.getQueryCache().find({ queryKey: second, exact: true });
    let published = false;
    const pending = c
      .fetchQuery({
        queryKey: first,
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            published = true;
            c.setQueryData(second, fresh);
          });
          return a.promise;
        },
      })
      .catch((error: unknown) => error);
    try {
      setIdentity(sessionFor(userB));
      expect(published).toBe(true);
      expect(c.getQueryData(second)).toBe(fresh);
      expect(c.getQueryCache().find({ queryKey: second, exact: true })).not.toBe(previousSecond);
      a.resolve("late A");
      await pending;
      expect(c.getQueryData(second)).toBe(fresh);
    } finally {
      stop();
      a.resolve("cleanup");
      await pending;
      c.clear();
    }
  },
);

it.each([
  { outcome: "resolve", paused: false },
  { outcome: "reject", paused: false },
  { outcome: "cancel", paused: false },
  { outcome: "resolve", paused: true },
  { outcome: "reject", paused: true },
  { outcome: "cancel", paused: true },
])("isolates work on another captured key admitted by abort: %p", async ({ outcome, paused }) => {
  const c = client();
  c.mount();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(c);
  const first = ["reflectionFeed", "cross-work-first"];
  const second = ["reflectionComments", "cross-work-second"];
  c.setQueryData(first, "A first");
  c.setQueryData(second, "A second");
  const previousSecond = c.getQueryCache().find({ queryKey: second, exact: true });
  const a = deferred<string>(),
    b = deferred<string>();
  let current: Promise<unknown> | undefined;
  let signal: AbortSignal | undefined;
  const previous = c
    .fetchQuery({
      queryKey: first,
      queryFn: ({ signal: oldSignal }) => {
        oldSignal.addEventListener("abort", () => {
          current = c
            .fetchQuery({
              queryKey: second,
              queryFn: (context) => {
                signal = context.signal;
                return b.promise;
              },
            })
            .catch((error: unknown) => error);
        });
        return a.promise;
      },
    })
    .catch((error: unknown) => error);
  try {
    if (paused) onlineManager.setOnline(false);
    setIdentity(sessionFor(userB));
    expect(current).toBeDefined();
    expect(c.getQueryCache().find({ queryKey: second, exact: true })).not.toBe(previousSecond);
    expect(c.getQueryData(second)).toBeUndefined();
    expect(c.getQueryState(second)?.fetchStatus).toBe(paused ? "paused" : "fetching");
    if (outcome === "cancel") {
      await c.cancelQueries({ queryKey: second, exact: true });
      expect(isCancelledError(await current)).toBe(true);
      expect(c.getQueryData(second)).toBeUndefined();
      expect(c.getQueryState(second)?.error).toBeNull();
    } else {
      onlineManager.setOnline(true);
      await waitFor(() => expect(signal).toBeDefined());
      expect(signal?.aborted).toBe(false);
      if (outcome === "resolve") {
        b.resolve("fresh B");
        expect(await current).toBe("fresh B");
        expect(c.getQueryData(second)).toBe("fresh B");
      } else {
        const error = new Error("current B failure");
        b.reject(error);
        expect(await current).toBe(error);
        expect(c.getQueryState(second)?.error).toBe(error);
      }
    }
    a.resolve("late A");
    await previous;
    expect(c.getQueryData(second)).not.toBe("A second");
  } finally {
    stop();
    onlineManager.setOnline(true);
    await c.cancelQueries({ queryKey: second, exact: true });
    a.resolve("cleanup");
    b.resolve("cleanup");
    await Promise.all([previous, current]);
    c.unmount();
    c.clear();
  }
});

it("clears all detached results and propagates a listener error before a conservative retry", () => {
  const c = client(),
    cache = c.getQueryCache();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(c);
  const first = ["reflections", "listener-error-first"],
    second = ["reflectionComments", "listener-error-second"];
  c.setQueryData(first, "A1");
  c.setQueryData(second, "A2");
  const old = [cache.find({ queryKey: first, exact: true })!, cache.find({ queryKey: second, exact: true })!];
  const error = new Error("sentinel removed listener");
  let thrown = false;
  const unsubscribe = cache.subscribe((event) => {
    if (event.type === "removed" && event.query === old[0] && !thrown) {
      thrown = true;
      c.setQueryData(second, "fresh B");
      throw error;
    }
  });
  try {
    expect(() => setIdentity(sessionFor(userB))).toThrow(error);
    expect(old.map((query) => query.state.data)).toEqual([undefined, undefined]);
    expect(c.getQueryData(second)).toBe("fresh B");
    // A failed pass remains incomplete; a later store notification retries conservatively.
    useAuthStore.setState({ isLoading: true });
    expect(c.getQueryData(second)).toBeUndefined();
  } finally {
    unsubscribe();
    stop();
    c.clear();
  }
});

it("attempts later detached resets after an earlier reset throws", () => {
  const c = client(),
    cache = c.getQueryCache();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(c);
  c.setQueryData(["reflections", "reset-error-first"], "A1");
  c.setQueryData(["reflectionComments", "reset-error-second"], "A2");
  const queries = cache.getAll();
  const error = new Error("sentinel reset");
  const reset = jest.spyOn(queries[0], "reset").mockImplementation(() => {
    throw error;
  });
  try {
    expect(() => setIdentity(sessionFor(userB))).toThrow(error);
    expect(queries[1].state.data).toBeUndefined();
    expect(cache.getAll()).toEqual([]);
  } finally {
    reset.mockRestore();
    stop();
    c.clear();
  }
});

it("shares an in-progress boundary with a same-owner binding recreated inside a removal callback", () => {
  const c = client(),
    cache = c.getQueryCache();
  setIdentity(sessionFor(userA));
  const stop = bindAuthQueryCache(c);
  const first = ["reflections", "rebind-during-first"],
    second = ["reflectionComments", "rebind-during-second"];
  c.setQueryData(first, "A1");
  c.setQueryData(second, "A2");
  const old = cache.find({ queryKey: first, exact: true })!;
  let rebound: (() => void) | undefined;
  const unsubscribe = cache.subscribe((event) => {
    if (event.type === "removed" && event.query === old) {
      stop();
      c.setQueryData(second, "fresh B");
      rebound = bindAuthQueryCache(c);
      useAuthStore.setState({ isLoading: true });
    }
  });
  try {
    setIdentity(sessionFor(userB));
    expect(rebound).toBeDefined();
    expect(c.getQueryData(second)).toBe("fresh B");
    useAuthStore.setState({ isLoading: false });
    expect(c.getQueryData(second)).toBe("fresh B");
  } finally {
    unsubscribe();
    rebound?.();
    stop();
    c.clear();
  }
});
