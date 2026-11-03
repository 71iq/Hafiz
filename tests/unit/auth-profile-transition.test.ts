import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { useAuthStore } from "@/lib/auth/store";
import type { Profile } from "@/lib/auth/types";

type Route = "restore" | "notification" | "password" | "oauth" | "link" | "signup";
let mockSession: Session | null = null;
let mockAuthError: Error | null = null;
let mockListener: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
let mockProfileResult: Promise<{ data: Profile; error: null }>;
const mockProfileRead = jest.fn(() => mockProfileResult);
const mockGetSession = jest.fn(async () => ({ data: { session: mockSession }, error: mockAuthError }));
const mockSignIn = jest.fn(async () => ({
  data: { session: mockSession, user: mockSession?.user ?? user("a") },
  error: mockAuthError,
}));
const mockOAuth = jest.fn(async () => {
  if (mockAuthError) throw mockAuthError;
  return { session: mockSession };
});
const mockSignOut = jest.fn(async () => ({ error: null }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from: () => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: () => mockProfileRead(),
    }),
    auth: {
      getSession: () => mockGetSession(),
      signInWithPassword: () => mockSignIn(),
      signUp: () => mockSignIn(),
      signOut: () => mockSignOut(),
      onAuthStateChange: (listener: (event: AuthChangeEvent, session: Session | null) => void) => {
        mockListener = listener;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: () => mockOAuth() }));
jest.mock("@/lib/auth/config", () => ({ isEmailAuthFlowsEnabled: () => true }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => true }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));

const user = (id: string): User => ({
  id,
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01",
});
const session = (id: string): Session => ({
  user: user(id),
  access_token: `synthetic-${id}`,
  refresh_token: `synthetic-refresh-${id}`,
  token_type: "bearer",
  expires_in: 3600,
});
const profile = (id: string): Profile => ({
  id,
  username: id,
  display_name: id,
  avatar_url: null,
  bio: null,
  country: null,
  total_score: 0,
  current_streak: 0,
  longest_streak: 0,
  cards_reviewed: 0,
  last_review_date: null,
  created_at: "2026-01-01",
});
let finishProfile: (value: { data: Profile; error: null }) => void = () => {
  throw new Error("Uninitialized profile response");
};
const routes: Route[] = ["restore", "notification", "password", "oauth", "link", "signup"];
const cases = ["switch", "same-user", "mismatched-profile", "no-profile", "anonymous-stale"];
function activate(value: Session | null, current: Profile | null) {
  useAuthStore.setState({ user: value?.user ?? null, session: value, profile: current });
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
async function trigger(route: Route) {
  const store = useAuthStore.getState();
  if (route === "restore") return store.initialize();
  if (route === "notification") {
    if (!mockListener) throw new Error("No listener");
    mockListener("SIGNED_IN", mockSession);
    return;
  }
  if (route === "password") return store.signIn("qa@example.invalid", "synthetic-password");
  if (route === "oauth") return store.signInWithQuranFoundation();
  if (route === "link") return store.linkQuranFoundation();
  return store.signUp("qa@example.invalid", "synthetic-password", "qa", "QA");
}
beforeEach(() => {
  activate(null, null);
  useAuthStore.setState({ isLoading: false, isInitialized: false, error: null });
  mockSession = null;
  mockAuthError = null;
  mockListener = undefined;
  jest.clearAllMocks();
  mockProfileResult = new Promise((resolve) => {
    finishProfile = resolve;
  });
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  activate(null, null);
  finishProfile({ data: profile("cleanup"), error: null });
  await flush();
  jest.restoreAllMocks();
});

it.each(routes.flatMap((route) => cases.map((kind) => ({ route, kind }))))(
  "publishes atomic profile ownership through $route for $kind",
  async ({ route, kind }) => {
    if (route === "notification") await useAuthStore.getState().initialize();
    const oldSession = kind === "anonymous-stale" ? null : session("a");
    const previous = kind === "no-profile" ? null : Object.freeze(profile(kind === "mismatched-profile" ? "z" : "a"));
    activate(oldSession, previous);
    mockSession = session(kind === "switch" ? "b" : "a");
    const expected = kind === "same-user" ? previous : null;
    const snapshots: { user: string | null; profile: string | null }[] = [];
    const unsubscribe = useAuthStore.subscribe((state) =>
      snapshots.push({ user: state.user?.id ?? null, profile: state.profile?.id ?? null }),
    );
    try {
      const work = trigger(route);
      await flush();
      expect(mockProfileRead).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().user?.id).toBe(mockSession.user.id);
      expect(useAuthStore.getState().session).toBe(mockSession);
      expect(useAuthStore.getState().profile).toBe(expected);
      if (kind === "switch" || kind === "anonymous-stale") {
        const newOwner = snapshots.filter((snapshot) => snapshot.user === mockSession?.user.id);
        expect(newOwner.length).toBeGreaterThan(0);
        expect(newOwner.every((snapshot) => snapshot.profile === null)).toBe(true);
      }
      const loaded = profile(mockSession.user.id);
      finishProfile({ data: loaded, error: null });
      await work;
      await flush();
      expect(useAuthStore.getState().profile).toBe(loaded);
    } finally {
      unsubscribe();
    }
  },
);

it("publishes a signed-out auth notification without an intermediate old profile", async () => {
  await useAuthStore.getState().initialize();
  activate(session("a"), profile("a"));
  const snapshots: { user: string | null; profile: string | null }[] = [];
  const unsubscribe = useAuthStore.subscribe((state) =>
    snapshots.push({ user: state.user?.id ?? null, profile: state.profile?.id ?? null }),
  );
  try {
    if (!mockListener) throw new Error("No listener");
    mockListener("SIGNED_OUT", null);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.every((snapshot) => snapshot.user === null && snapshot.profile === null)).toBe(true);
    expect(mockProfileRead).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});

it("preserves existing atomic local signout", async () => {
  activate(session("a"), profile("a"));
  await useAuthStore.getState().signOut();
  expect(useAuthStore.getState()).toMatchObject({ user: null, session: null, profile: null, isLoading: false });
});

it.each<Route>(["password", "restore"])("preserves current profile on failed $route", async (route) => {
  const current = profile("a");
  activate(session("a"), current);
  mockAuthError = new Error("remote failure");
  if (route === "restore") await trigger(route);
  else await expect(trigger(route)).rejects.toBe(mockAuthError);
  expect(useAuthStore.getState().profile).toBe(current);
  expect(useAuthStore.getState().user?.id).toBe("a");
  expect(mockProfileRead).not.toHaveBeenCalled();
});

it.each<Route>(["oauth", "link"])("preserves current profile when $route returns no session", async (route) => {
  const current = profile("a");
  activate(session("a"), current);
  await trigger(route);
  expect(useAuthStore.getState().profile).toBe(current);
  expect(useAuthStore.getState().user?.id).toBe("a");
  expect(mockProfileRead).not.toHaveBeenCalled();
});

it.each([false, true])("preserves signup without session, already registered=%s", async (registered) => {
  const current = profile("a");
  activate(session("a"), current);
  const existing = user("a");
  existing.identities = registered ? [] : undefined;
  mockSignIn.mockResolvedValueOnce({ data: { session: null, user: existing }, error: null });
  await expect(trigger("signup")).resolves.toEqual({
    status: registered ? "alreadyRegistered" : "needsEmailConfirmation",
  });
  expect(useAuthStore.getState().profile).toBe(current);
  expect(mockProfileRead).not.toHaveBeenCalled();
});

it("preserves the existing no-session restore behavior", async () => {
  const current = profile("a");
  activate(session("a"), current);
  await trigger("restore");
  expect(useAuthStore.getState().profile).toBe(current);
  expect(mockProfileRead).not.toHaveBeenCalled();
});
