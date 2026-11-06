import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { useAuthStore } from "@/lib/auth/store";
import type { Profile } from "@/lib/auth/types";

type Response = { data: Profile | null; error: Error | null };
type ProfileChain = {
  select: () => ProfileChain;
  eq: (...args: unknown[]) => ProfileChain;
  insert: (value: unknown) => ProfileChain;
  single: () => Promise<Response>;
  maybeSingle: () => Promise<Response>;
};
type Action = "fetchProfile" | "ensureProfile";
type Transition = "switch" | "signout" | "same-id-login" | "away-and-back";
const mockReads: Promise<Response>[] = [];
const mockInserts: Promise<Response>[] = [];
const mockInsert = jest.fn();
const mockEq = jest.fn();
let mockListener: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
const mockGetSession = jest.fn(
  async (): Promise<{ data: { session: Session | null }; error: null }> => ({ data: { session: null }, error: null }),
);
const mockSignOut = jest.fn(async () => ({ error: null }));
const mockFrom = jest.fn((table: string) => {
  if (table !== "profiles") throw new Error(`Unexpected table ${table}`);
  let inserted = false;
  const terminal = () => {
    const next = (inserted ? mockInserts : mockReads).shift();
    if (!next) throw new Error("Unexpected profile request");
    return next;
  };
  const chain: ProfileChain = {
    select: jest.fn(() => chain),
    eq: jest.fn((...args: unknown[]) => {
      mockEq(...args);
      return chain;
    }),
    insert: jest.fn((value: unknown) => {
      inserted = true;
      mockInsert(value);
      return chain;
    }),
    single: terminal,
    maybeSingle: terminal,
  };
  return chain;
});
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from: (table: string) => mockFrom(table),
    auth: {
      getSession: () => mockGetSession(),
      signOut: () => mockSignOut(),
      onAuthStateChange: (listener: (event: AuthChangeEvent, session: Session | null) => void) => {
        mockListener = listener;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));

const user = (id: string): User => ({
  id,
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01",
  email: `${id}@example.invalid`,
});
const session = (id: string): Session => ({
  access_token: `synthetic-${id}`,
  refresh_token: `synthetic-refresh-${id}`,
  token_type: "bearer",
  expires_in: 3600,
  user: user(id),
});
const profile = (id: string, name = id): Profile => ({
  id,
  username: name,
  display_name: name,
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
function deferred() {
  let resolve: (value: Response) => void = () => {
    throw new Error("Uninitialized response");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Uninitialized rejection");
  };
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function activate(value: Session | null, current: Profile | null) {
  useAuthStore.setState({ user: value?.user ?? null, session: value, profile: current });
}
async function transition(kind: Transition, original: Session): Promise<Profile | null> {
  if (kind === "signout") {
    await useAuthStore.getState().signOut();
    return null;
  }
  if (kind === "switch") {
    const current = profile("b", "current-b");
    activate(session("b"), current);
    return current;
  }
  activate(kind === "same-id-login" ? null : session("b"), null);
  const current = profile("a", "new-login-a");
  activate(original, current);
  return current;
}
function finish(pending: ReturnType<typeof deferred>, outcome: string) {
  if (outcome === "rejection") pending.reject(new Error("old rejection"));
  else
    pending.resolve({
      data: outcome === "success" ? profile("a", "old-a") : null,
      error: outcome === "error" ? new Error("old error") : null,
    });
}
const transitions: Transition[] = ["switch", "signout", "same-id-login", "away-and-back"];
const actions: Action[] = ["fetchProfile", "ensureProfile"];

beforeEach(() => {
  activate(null, null);
  mockReads.length = 0;
  mockInserts.length = 0;
  mockListener = undefined;
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  useAuthStore.setState({ isLoading: false, isInitialized: false, error: null });
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  activate(null, null);
  jest.restoreAllMocks();
});

it.each(actions)("does not request %s without a user", async (action) => {
  await useAuthStore.getState()[action]();
  expect(mockFrom).not.toHaveBeenCalled();
});

it.each(
  actions.flatMap((action) =>
    transitions.flatMap((kind) => ["success", "error", "rejection"].map((outcome) => ({ action, kind, outcome }))),
  ),
)("ignores late $action $outcome after $kind", async ({ action, kind, outcome }) => {
  const original = session("a");
  activate(original, profile("a"));
  const pending = deferred();
  mockReads.push(pending.promise);
  const work = useAuthStore.getState()[action]();
  const expected = await transition(kind, original);
  finish(pending, outcome);
  expect(await work).toBe(action === "ensureProfile" ? null : undefined);
  expect(useAuthStore.getState().profile).toBe(expected);
  expect(console.warn).not.toHaveBeenCalled();
  expect(mockInsert).not.toHaveBeenCalled();
});

it.each(transitions)("does not insert after a missing lookup becomes stale via %s", async (kind) => {
  const original = session("a");
  activate(original, profile("a"));
  const pending = deferred();
  mockReads.push(pending.promise);
  const work = useAuthStore.getState().ensureProfile();
  const expected = await transition(kind, original);
  pending.resolve({ data: null, error: null });
  expect(await work).toBeNull();
  expect(mockInsert).not.toHaveBeenCalled();
  expect(useAuthStore.getState().profile).toBe(expected);
});

it.each(transitions.flatMap((kind) => ["success", "error", "rejection"].map((outcome) => ({ kind, outcome }))))(
  "ignores an already-issued insert $outcome after $kind",
  async ({ kind, outcome }) => {
    const original = session("a");
    activate(original, profile("a"));
    const pending = deferred();
    mockReads.push(Promise.resolve({ data: null, error: null }));
    mockInserts.push(pending.promise);
    const work = useAuthStore.getState().ensureProfile();
    await Promise.resolve();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const expected = await transition(kind, original);
    finish(pending, outcome);
    expect(await work).toBeNull();
    expect(useAuthStore.getState().profile).toBe(expected);
    expect(console.warn).not.toHaveBeenCalled();
  },
);

it.each(actions)("publishes current-owner %s success and keeps request contract", async (action) => {
  activate(session("a"), null);
  const current = profile("a", "loaded-a");
  mockReads.push(Promise.resolve({ data: current, error: null }));
  expect(await useAuthStore.getState()[action]()).toBe(action === "ensureProfile" ? current : undefined);
  expect(useAuthStore.getState().profile).toBe(current);
  expect(mockEq).toHaveBeenCalledWith("id", "a");
  expect(mockInsert).not.toHaveBeenCalled();
});

it.each(actions.flatMap((action) => ["error", "rejection"].map((outcome) => ({ action, outcome }))))(
  "retains current-owner $action $outcome fallback and warning",
  async ({ action, outcome }) => {
    activate(session("a"), null);
    const pending = deferred();
    mockReads.push(pending.promise);
    const work = useAuthStore.getState()[action]();
    finish(pending, outcome);
    const result = await work;
    expect(useAuthStore.getState().profile).toEqual({ ...profile("a", "a"), display_name: null });
    expect(result).toBe(action === "ensureProfile" ? useAuthStore.getState().profile : undefined);
    expect(console.warn).toHaveBeenCalledTimes(1);
  },
);

it.each(["success", "empty", "error", "rejection"])(
  "retains current-owner ensure insert %s behavior",
  async (outcome) => {
    activate(session("a"), null);
    mockReads.push(Promise.resolve({ data: null, error: null }));
    const pending = deferred();
    mockInserts.push(pending.promise);
    const work = useAuthStore.getState().ensureProfile();
    await Promise.resolve();
    finish(pending, outcome);
    const result = await work;
    expect(result).toEqual(
      outcome === "success" ? profile("a", "old-a") : { ...profile("a", "a"), display_name: null },
    );
    expect(useAuthStore.getState().profile).toBe(result);
    expect(mockInsert).toHaveBeenCalledWith({ id: "a", username: "a", display_name: null });
  },
);

it("retains current-owner fetch empty data behavior", async () => {
  activate(session("a"), profile("a"));
  mockReads.push(Promise.resolve({ data: null, error: null }));
  await useAuthStore.getState().fetchProfile();
  expect(useAuthStore.getState().profile).toBeNull();
});

it.each(actions)("does not publish a wrong-owner %s read response", async (action) => {
  activate(session("a"), null);
  const wrong = profile("b", "wrong-b");
  const observed: Array<Profile | null> = [];
  const unsubscribe = useAuthStore.subscribe((state) => observed.push(state.profile));
  mockReads.push(Promise.resolve({ data: wrong, error: null }));

  const result = await useAuthStore.getState()[action]();

  unsubscribe();
  expect(result).toBe(action === "ensureProfile" ? useAuthStore.getState().profile : undefined);
  expect(useAuthStore.getState().profile?.id).toBe("a");
  expect(observed).not.toContain(wrong);
  expect(mockInsert).not.toHaveBeenCalled();
});

it("does not publish a wrong-owner ensure insert response or issue another insert", async () => {
  activate(session("a"), null);
  const wrong = profile("b", "wrong-b");
  const observed: Array<Profile | null> = [];
  const unsubscribe = useAuthStore.subscribe((state) => observed.push(state.profile));
  mockReads.push(Promise.resolve({ data: null, error: null }));
  mockInserts.push(Promise.resolve({ data: wrong, error: null }));

  const result = await useAuthStore.getState().ensureProfile();

  unsubscribe();
  expect(result).toBe(useAuthStore.getState().profile);
  expect(useAuthStore.getState().profile?.id).toBe("a");
  expect(observed).not.toContain(wrong);
  expect(mockInsert).toHaveBeenCalledTimes(1);
});

it.each(actions)("preserves a newer same-session profile during %s and same-ID metadata updates", async (action) => {
  const original = session("a");
  activate(original, null);
  const pending = deferred();
  mockReads.push(pending.promise);
  const work = useAuthStore.getState()[action]();
  const interim = profile("a", "interim");
  useAuthStore.setState({ user: { ...original.user, user_metadata: { display_name: "new" } }, profile: interim });
  pending.resolve({ data: profile("a", "loaded"), error: null });
  expect(await work).toBe(action === "ensureProfile" ? interim : undefined);
  expect(useAuthStore.getState().profile).toBe(interim);
});

it.each(actions)("allows %s through same-ID metadata changes when no profile changed", async (action) => {
  const original = session("a");
  activate(original, null);
  const pending = deferred();
  mockReads.push(pending.promise);
  const work = useAuthStore.getState()[action]();
  useAuthStore.setState({ user: { ...original.user, user_metadata: { display_name: "new" } } });
  const loaded = profile("a", "loaded");
  pending.resolve({ data: loaded, error: null });
  expect(await work).toBe(action === "ensureProfile" ? loaded : undefined);
  expect(useAuthStore.getState().profile).toBe(loaded);
});

it.each(actions)("invalidates %s on a replacement same-ID session", async (action) => {
  activate(session("a"), null);
  const pending = deferred();
  mockReads.push(pending.promise);
  const work = useAuthStore.getState()[action]();
  const current = profile("a", "refreshed");
  activate(session("a"), current);
  pending.resolve({ data: profile("a", "old"), error: null });
  expect(await work).toBe(action === "ensureProfile" ? null : undefined);
  expect(useAuthStore.getState().profile).toBe(current);
});

it("guards actual auth notifications with B finishing before A", async () => {
  await useAuthStore.getState().initialize();
  if (!mockListener) throw new Error("Missing auth listener");
  const a = deferred();
  const b = deferred();
  mockReads.push(a.promise, b.promise);
  mockListener("SIGNED_IN", session("a"));
  mockListener("SIGNED_IN", session("b"));
  const current = profile("b", "current-b");
  b.resolve({ data: current, error: null });
  await Promise.resolve();
  a.resolve({ data: profile("a", "old-a"), error: null });
  await Promise.resolve();
  expect(useAuthStore.getState().user?.id).toBe("b");
  expect(useAuthStore.getState().profile).toBe(current);
});

it("guards restored-session profile completion after an actual signed-out notification", async () => {
  const a = deferred();
  mockReads.push(a.promise);
  mockGetSession.mockResolvedValue({ data: { session: session("a") }, error: null });
  await useAuthStore.getState().initialize();
  if (!mockListener) throw new Error("Missing auth listener");
  mockListener("SIGNED_OUT", null);
  a.resolve({ data: profile("a", "old-a"), error: null });
  await Promise.resolve();
  expect(useAuthStore.getState().user).toBeNull();
  expect(useAuthStore.getState().profile).toBeNull();
});

it.each(
  actions.flatMap((action) => ["success", "empty", "error", "rejection"].map((outcome) => ({ action, outcome }))),
)("retains newer same-owner profile through $action $outcome", async ({ action, outcome }) => {
  activate(session("a"), profile("a"));
  const pending = deferred();
  mockReads.push(pending.promise);
  if (action === "ensureProfile" && outcome === "empty")
    mockInserts.push(Promise.resolve({ data: profile("a", "inserted"), error: null }));
  const work = useAuthStore.getState()[action]();
  const newer = { ...profile("a", "newer"), total_score: 900, bio: null };
  useAuthStore.setState({ profile: newer });
  finish(pending, outcome);
  const result = await work;
  expect(useAuthStore.getState().profile).toBe(newer);
  expect(result).toBe(action === "ensureProfile" ? newer : undefined);
  expect(console.warn).toHaveBeenCalledTimes(outcome === "error" || outcome === "rejection" ? 1 : 0);
  expect(mockInsert).toHaveBeenCalledTimes(action === "ensureProfile" && outcome === "empty" ? 1 : 0);
});
it.each(["success", "empty", "error", "rejection"])(
  "retains newer profile through already-issued insert %s",
  async (outcome) => {
    activate(session("a"), null);
    mockReads.push(Promise.resolve({ data: null, error: null }));
    const pending = deferred();
    mockInserts.push(pending.promise);
    const work = useAuthStore.getState().ensureProfile();
    await Promise.resolve();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const newer = { ...profile("a", "newer"), total_score: 900 };
    useAuthStore.setState({ profile: newer });
    finish(pending, outcome);
    expect(await work).toBe(newer);
    expect(useAuthStore.getState().profile).toBe(newer);
  },
);
