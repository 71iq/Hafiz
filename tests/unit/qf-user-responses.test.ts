import {
  beginQfOAuthConnection,
  completeQfOAuthConnection,
  getQfConnectionStatus,
  getQfLinkedIdentityState,
  invokeQfUser,
} from "@/lib/quran-foundation/user";

const mockInvoke = jest.fn();
const mockGetUserIdentities = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    auth: { getUserIdentities: () => mockGetUserIdentities() },
  },
}));

const UPSTREAM = { ok: false, code: "upstream", message: "Quran Foundation sync is unavailable." };
const reply = (data: unknown, error: unknown = null) => mockInvoke.mockResolvedValueOnce({ data, error });

beforeEach(() => {
  mockInvoke.mockReset();
  mockGetUserIdentities.mockReset();
});

describe("RF-193 Quran Foundation responses", () => {
  it("passes valid responses through unchanged", async () => {
    const status = { ok: true, status: "connected", env: "production", connectedAt: "2026-01-01T00:00:00Z" };
    reply(status);
    await expect(getQfConnectionStatus()).resolves.toEqual(status);

    const begin = { ok: true, authorizationUrl: "https://auth.example.invalid/x", expiresAt: "2026-01-01T00:10:00Z" };
    reply(begin);
    await expect(beginQfOAuthConnection("hafiz://auth/qf-callback")).resolves.toEqual(begin);

    const complete = { ok: true, status: "connected", connectedAt: "2026-01-01T00:00:00Z" };
    reply(complete);
    await expect(completeQfOAuthConnection("code", "state", "hafiz://auth/qf-callback")).resolves.toEqual(complete);

    const error = { ok: false, code: "needs_reauth", message: "Reconnect Quran Foundation." };
    reply(error);
    await expect(getQfConnectionStatus()).resolves.toEqual(error);
  });

  it.each([
    ["a bare disconnected reply", { ok: true, status: "disconnected" }],
    [
      "a reauthentication reply with null times",
      { ok: true, status: "needs_reauth", env: "prelive", connectedAt: null, updatedAt: null },
    ],
  ])("accepts %s as the server sends it", async (_label, data) => {
    reply(data);
    await expect(getQfConnectionStatus()).resolves.toEqual(data);
  });

  it("keeps a valid error body that arrives with a failed call", async () => {
    const body = { ok: false, code: "not_connected", message: "Connect Quran Foundation first." };
    mockInvoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => body } } });
    await expect(invokeQfUser({ action: "status" })).resolves.toEqual(body);
  });

  it.each([
    ["an unknown status", { ok: true, status: "paused" }],
    ["a success without a status", { ok: true }],
    ["a non-text connection time", { ok: true, status: "connected", connectedAt: 5 }],
  ])("reports %s as unavailable instead of a connection state", async (_label, data) => {
    reply(data);
    await expect(getQfConnectionStatus()).resolves.toEqual(UPSTREAM);
  });

  it("does not open a malformed authorization URL", async () => {
    reply({ ok: true, authorizationUrl: 5, expiresAt: "2026-01-01T00:10:00Z" });
    await expect(beginQfOAuthConnection("hafiz://auth/qf-callback")).resolves.toEqual(UPSTREAM);
  });

  it("does not report a connection without its time", async () => {
    reply({ ok: true, status: "connected" });
    await expect(completeQfOAuthConnection("code", "state", "hafiz://auth/qf-callback")).resolves.toEqual(UPSTREAM);
  });

  it.each([
    ["an unknown code", { ok: false, code: "teapot", message: "x" }],
    ["a missing message", { ok: false, code: "forbidden" }],
  ])("replaces an error body with %s by the unavailable error", async (_label, data) => {
    reply(data);
    await expect(invokeQfUser({ action: "status" })).resolves.toEqual(UPSTREAM);

    mockInvoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => data } } });
    await expect(invokeQfUser({ action: "status" })).resolves.toEqual(UPSTREAM);
  });

  it("reads linked identities through the typed SDK call", async () => {
    mockGetUserIdentities.mockResolvedValueOnce({
      data: { identities: [{ provider: "google" }, { provider: "custom:quran-foundation" }] },
      error: null,
    });
    await expect(getQfLinkedIdentityState()).resolves.toEqual({ linked: true });

    mockGetUserIdentities.mockResolvedValueOnce({ data: null, error: { message: "expired" } });
    await expect(getQfLinkedIdentityState()).resolves.toEqual({ linked: false });
  });
});
