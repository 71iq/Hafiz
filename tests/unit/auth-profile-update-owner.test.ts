import { authCommands } from "@/lib/auth/commands";
import type { Session, User } from "@supabase/supabase-js";
import { useAuthStore } from "@/lib/auth/store";
import type { Profile } from "@/lib/auth/types";

type Response = { data: Profile | null; error: Error | null };
type ProfileChain = {
  select: () => ProfileChain;
  eq: (...args: unknown[]) => ProfileChain;
  insert: (value: unknown) => ProfileChain;
  update: (value: unknown) => ProfileChain;
  single: () => Promise<Response>;
  maybeSingle: () => Promise<Response>;
};
type Transition = "switch" | "signout" | "same-id-login" | "away-and-back";
const mockReads: Promise<Response>[] = [];
const mockInserts: Promise<Response>[] = [];
const mockUpdates: Promise<Response>[] = [];
const mockUpdate = jest.fn();
const mockInsert = jest.fn();
const mockEq = jest.fn();
const mockGetSession = jest.fn(
  async (): Promise<{ data: { session: Session | null }; error: null }> => ({ data: { session: null }, error: null }),
);
const mockSignOut = jest.fn(async () => ({ error: null }));
const mockFrom = jest.fn((table: string) => {
  if (table !== "profiles") throw new Error(`Unexpected table ${table}`);
  let inserted = false;
  let updating = false;
  const terminal = () => {
    const next = (updating ? mockUpdates : inserted ? mockInserts : mockReads).shift();
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
    update: (value) => {
      updating = true;
      mockUpdate(value);
      return chain;
    },
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
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: jest.fn() } } }),
    },
  },
}));
jest.mock("@/lib/auth/oauth", () => ({ startAppOAuth: jest.fn() }));
jest.mock("@/lib/quran-foundation/config", () => ({ isQfSyncEnabled: () => false, isQfLoginEnabled: () => false }));
jest.mock("@/lib/quran-foundation/user", () => ({ connectQfFromSession: jest.fn() }));

const userId = (id: string) =>
  id === "a" ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002";
const user = (id: string): User => ({
  id: userId(id),
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01",
  email: `${id}@example.invalid`,
});
let sessionSequence = 0;
const session = (id: string): Session => ({
  access_token: [
    "e30",
    Buffer.from(
      JSON.stringify({
        sub: userId(id),
        session_id: `10000000-0000-4000-8000-${String(++sessionSequence).padStart(12, "0")}`,
      }),
    ).toString("base64url"),
    "c2ln",
  ].join("."),
  refresh_token: `synthetic-refresh-${id}`,
  token_type: "bearer",
  expires_in: 3600,
  user: user(id),
});
const profile = (id: string, name = id): Profile => ({
  id: userId(id),
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
    activate(null, null);
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

beforeEach(() => {
  activate(null, null);
  mockReads.length = 0;
  mockInserts.length = 0;
  mockUpdates.length = 0;
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  useAuthStore.setState({ isLoading: false, isInitialized: false, error: null });
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  activate(null, null);
  jest.restoreAllMocks();
});

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
it.each(transitions.flatMap((kind) => ["success", "error", "rejection"].map((outcome) => ({ kind, outcome }))))(
  "ignores issued profile $outcome after $kind",
  async ({ kind, outcome }) => {
    const original = session("a");
    activate(original, profile("a"));
    const pending = deferred();
    mockReads.push(Promise.resolve({ data: profile("a"), error: null }));
    mockUpdates.push(pending.promise);
    const work = useAuthStore.getState().updateProfile({ displayName: "changed-a" });
    await flush();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const expected = await transition(kind, original);
    useAuthStore.setState({ isLoading: true, error: "current-owner-status" });
    finish(pending, outcome);
    expect(await work).toEqual({ status: "superseded" });
    expect(useAuthStore.getState()).toMatchObject({
      profile: expected,
      isLoading: true,
      error: "current-owner-status",
    });
  },
);
it.each(transitions)("does not dispatch profile update after stale ensure via %s", async (kind) => {
  const original = session("a");
  activate(original, profile("a"));
  const pending = deferred();
  mockReads.push(pending.promise);
  const work = useAuthStore.getState().updateProfile({ displayName: "changed-a" });
  await flush();
  expect(mockFrom).toHaveBeenCalledTimes(1);
  await transition(kind, original);
  finish(pending, "success");
  expect(await work).toEqual({ status: "superseded" });
  expect(mockUpdate).not.toHaveBeenCalled();
});
it.each(["ensure", "update"])("cancelled current-session %s does not publish or leave auth loading", async (phase) => {
  activate(session("a"), profile("a", "initial"));
  const pending = deferred();
  if (phase === "ensure") mockReads.push(pending.promise);
  else {
    mockReads.push(Promise.resolve({ data: profile("a"), error: null }));
    mockUpdates.push(pending.promise);
  }
  const owner = authCommands.captureOwner();
  const work = useAuthStore.getState().updateProfile({ displayName: "changed" }, owner);
  await flush();
  const before = useAuthStore.getState().profile;
  owner.cancel();
  useAuthStore.setState({ error: "current-status" });
  finish(pending, "success");
  expect(await work).toEqual({ status: "superseded" });
  expect(useAuthStore.getState()).toMatchObject({ profile: before, isLoading: false, error: "current-status" });
  if (phase === "ensure") expect(mockUpdate).not.toHaveBeenCalled();
});
it("current save returns its completed value and exact patch including null versus undefined", async () => {
  activate(session("a"), profile("a"));
  const updated = profile("a", "updated");
  mockReads.push(Promise.resolve({ data: profile("a"), error: null }));
  mockUpdates.push(Promise.resolve({ data: updated, error: null }));
  const result = await useAuthStore
    .getState()
    .updateProfile({ displayName: null, avatarUrl: "synthetic-avatar", bio: undefined, country: null });
  expect(result.status).toBe("completed");
  if (result.status === "completed") {
    expect(result.value).toBe(updated);
    expect(result.owner.isCurrent()).toBe(true);
  }
  expect(mockUpdate).toHaveBeenCalledWith({ display_name: null, avatar_url: "synthetic-avatar", country: null });
  expect(mockEq).toHaveBeenLastCalledWith("id", userId("a"));
  expect(useAuthStore.getState().profile).toBe(updated);
});
it.each(["packet", "rejection"])("current profile %s preserves original error identity", async (outcome) => {
  activate(session("a"), profile("a"));
  const error = new Error("original-save-error");
  mockReads.push(Promise.resolve({ data: profile("a"), error: null }));
  mockUpdates.push(outcome === "packet" ? Promise.resolve({ data: null, error }) : Promise.reject(error));
  await expect(useAuthStore.getState().updateProfile({ bio: "value" })).rejects.toBe(error);
  expect(useAuthStore.getState()).toMatchObject({ error: error.message, isLoading: false });
});
it.each([false, true])("profile save does not change unrelated global loading %s", async (isLoading) => {
  activate(session("a"), profile("a"));
  useAuthStore.setState({ isLoading });
  mockReads.push(Promise.resolve({ data: profile("a"), error: null }));
  mockUpdates.push(Promise.resolve({ data: profile("a"), error: null }));
  await useAuthStore.getState().updateProfile({ bio: "value" });
  expect(useAuthStore.getState().isLoading).toBe(isLoading);
});
it.each(["metadata", "token-refresh"])("keeps current profile completion through same-session %s", async (kind) => {
  const original = session("a");
  activate(original, profile("a"));
  const pending = deferred();
  mockReads.push(Promise.resolve({ data: profile("a"), error: null }));
  mockUpdates.push(pending.promise);
  const work = useAuthStore.getState().updateProfile({ bio: "value" });
  await flush();
  if (kind === "metadata") useAuthStore.setState({ user: { ...original.user, user_metadata: { name: "changed" } } });
  else
    activate({ ...original, access_token: original.access_token.replace(/c2ln$/, "c2lnMg") }, profile("a", "interim"));
  const updated = profile("a", "updated");
  pending.resolve({ data: updated, error: null });
  expect((await work).status).toBe("completed");
  expect(useAuthStore.getState().profile).toBe(updated);
});
it("does not reuse a same-user different-session owner", async () => {
  const a = session("a");
  activate(a, profile("a"));
  const pending = deferred();
  mockReads.push(Promise.resolve({ data: profile("a"), error: null }));
  mockUpdates.push(pending.promise);
  const work = useAuthStore.getState().updateProfile({ bio: "value" });
  await flush();
  const current = profile("a", "new-session");
  activate(session("a"), current);
  finish(pending, "success");
  expect(await work).toEqual({ status: "superseded" });
  expect(useAuthStore.getState().profile).toBe(current);
});
it("serializes current-owner saves through the existing command queue", async () => {
  activate(session("a"), profile("a"));
  const pending = deferred();
  mockReads.push(
    Promise.resolve({ data: profile("a"), error: null }),
    Promise.resolve({ data: profile("a"), error: null }),
  );
  mockUpdates.push(pending.promise, Promise.resolve({ data: profile("a", "second"), error: null }));
  const first = useAuthStore.getState().updateProfile({ bio: "first" });
  const second = useAuthStore.getState().updateProfile({ bio: "second" });
  await flush();
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  finish(pending, "success");
  expect((await first).status).toBe("completed");
  expect((await second).status).toBe("completed");
  expect(mockUpdate.mock.calls).toEqual([[{ bio: "first" }], [{ bio: "second" }]]);
  expect(useAuthStore.getState().profile?.display_name).toBe("second");
});
it("does not submit a new user's profile using a previously captured owner", async () => {
  activate(session("a"), profile("a"));
  const owner = authCommands.captureOwner();
  activate(session("b"), profile("b"));
  expect(await useAuthStore.getState().updateProfile({ bio: "old-a" }, owner)).toEqual({ status: "superseded" });
  expect(mockFrom).not.toHaveBeenCalled();
});
it.each(["missing", "unidentified", "mismatched"])("fails closed with %s session ownership", async (kind) => {
  const a = session("a");
  activate(kind === "missing" ? null : kind === "unidentified" ? { ...a, access_token: "invalid" } : a, profile("a"));
  useAuthStore.setState({ user: user(kind === "mismatched" ? "b" : "a"), error: "existing", isLoading: true });
  expect(await useAuthStore.getState().updateProfile({ bio: "value" })).toEqual({ status: "superseded" });
  expect(mockFrom).not.toHaveBeenCalled();
  expect(useAuthStore.getState()).toMatchObject({ error: "existing", isLoading: true });
});
it("retains signed-out rejection without an SDK request", async () => {
  await expect(useAuthStore.getState().updateProfile({ bio: "value" })).rejects.toThrow("Not signed in");
  expect(mockFrom).not.toHaveBeenCalled();
});
