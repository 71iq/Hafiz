import React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import { halaqaKeys } from "@/lib/halaqa/api";
import { profilePrivacyKeys } from "@/lib/profile/privacy";
import { OWN_PRIVACY_REVALIDATE_MS, cleanUpMinorPhotos, useMinorPhotoCleanup } from "@/lib/profile/use-minor-photo-cleanup";
import { createAppQueryClient } from "@/lib/query/native-lifecycle";
import { socialFailureOf } from "@/lib/social/remote";
import { bearerSubject, signedIn, type FakeAuthState } from "./social-test-auth";

// Third review, finding 1(d): a minor's photo files left by an interrupted save are removed once per
// app session and account, as that account.

const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, Record<string, unknown>]>();
const mockHeaders: Record<string, string> = {};
let mockAuth: FakeAuthState;
let mockClientSession: FakeAuthState["session"];
const mockAvatarFiles = new Set<string>();
const mockStorageCalls: { op: "list" | "remove"; auth: string | undefined }[] = [];
let mockBeforeList: () => void = () => undefined;

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabaseAnonKey: () => "synthetic-public-key",
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) =>
      require("./social-test-auth").rpcBuilder(mockRpc(fn, args), mockHeaders),
    auth: { getSession: async () => ({ data: { session: mockClientSession }, error: null }) },
    storage: {
      from: () => {
        const headers: Record<string, string> = {};
        const files = {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
            return files;
          },
          list: async (folder: string) => {
            mockStorageCalls.push({ op: "list", auth: headers.Authorization });
            mockBeforeList();
            const names = [...mockAvatarFiles].filter((path) => path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1));
            return { data: names.map((name) => ({ id: `id-${name}`, name })), error: null };
          },
          remove: async (paths: string[]) => {
            mockStorageCalls.push({ op: "remove", auth: headers.Authorization });
            for (const path of paths) mockAvatarFiles.delete(path);
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
        return files;
      },
    },
  },
}));
jest.mock("@/lib/auth/store", () => ({
  useAuthStore: Object.assign((selector: (state: FakeAuthState) => unknown) => selector(mockAuth), {
    getState: () => mockAuth,
  }),
}));

// Each test uses its own account, since cleanups are remembered for the app session.
const account = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const privacy = (isMinor: boolean) => ({
  data: { board_joined: false, board_nickname: null, show_streak: false, show_juz_completions: false, is_minor: isMinor },
  error: null,
});

function signIn(state: FakeAuthState) {
  mockAuth = state;
  mockClientSession = state.session;
}

function Probe() {
  useMinorPhotoCleanup();
  return null;
}

const queryClients: QueryClient[] = [];
function newClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClients.push(client);
  return client;
}

/** The app's own client, with its network mode and defaults. */
function appClient() {
  const client = createAppQueryClient();
  queryClients.push(client);
  return client;
}

// Query reads the clock for staleness; tests move it forward.
const realNow = Date.now.bind(Date);
let clockOffset = 0;

/** What lib/query/native-lifecycle.ts reports when AppState returns to "active", or NetInfo reconnects. */
async function foreground() {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
}
async function reconnect() {
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
}

function mount(client = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRpc.mockReset();
  mockAvatarFiles.clear();
  mockStorageCalls.length = 0;
  mockBeforeList = () => undefined;
  clockOffset = 0;
  jest.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);
});

afterEach(() => {
  cleanup();
  for (const client of queryClients.splice(0)) client.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

describe("minor photo cleanup (ETH-07)", () => {
  it("removes a minor account's leftover photos as that account and reloads its halaqas", async () => {
    const user = account(1);
    signIn(signedIn(user));
    mockAvatarFiles.add(`${user}/left-behind.jpg`).add(`${account(99)}/someone-else.jpg`);
    mockRpc.mockResolvedValue(privacy(true));
    const client = newClient();
    client.setQueryData(halaqaKeys.mine(user), []);
    mount(client);
    await waitFor(() => expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(false));
    expect(mockAvatarFiles.has(`${account(99)}/someone-else.jpg`)).toBe(true);
    expect(mockStorageCalls.every((call) => bearerSubject(call.auth) === user)).toBe(true);
    expect(bearerSubject(mockHeaders.Authorization)).toBe(user);
    expect(client.getQueryState(halaqaKeys.mine(user))?.isInvalidated).toBe(true);
  });

  it("runs once per app session and account, with one list request when nothing is left", async () => {
    const user = account(2);
    signIn(signedIn(user));
    mockRpc.mockResolvedValue(privacy(true));
    const first = mount();
    await waitFor(() => expect(mockStorageCalls.map((call) => call.op)).toEqual(["list"]));
    first.unmount();
    // A fresh query cache, as after a reload of the screen tree: privacy is read again.
    mount();
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    expect(mockStorageCalls.map((call) => call.op)).toEqual(["list"]);
  });

  it("cleans up again in a later minority after it was withdrawn", async () => {
    const user = account(6);
    signIn(signedIn(user));
    let minor = true;
    mockRpc.mockImplementation(async () => privacy(minor));
    let onAppState: ((state: AppStateStatus) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      onAppState = listener as (state: AppStateStatus) => void;
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
    });
    const client = newClient();
    mount(client);
    await waitFor(() => expect(mockStorageCalls.map((call) => call.op)).toEqual(["list"]));

    // This device reads the withdrawal, then a minority recorded again on another device whose last
    // photo pass left a file behind, and comes back to the foreground.
    minor = false;
    await act(async () => {
      await client.invalidateQueries({ queryKey: profilePrivacyKeys.mine(user) });
    });
    minor = true;
    mockAvatarFiles.add(`${user}/uploaded-meanwhile.jpg`);
    await act(async () => {
      await client.invalidateQueries({ queryKey: profilePrivacyKeys.mine(user) });
    });
    await act(async () => onAppState?.("active"));
    await waitFor(() => expect(mockAvatarFiles.has(`${user}/uploaded-meanwhile.jpg`)).toBe(false));
  });

  it("leaves an adult's photos alone", async () => {
    const user = account(3);
    signIn(signedIn(user));
    mockAvatarFiles.add(`${user}/me.jpg`);
    mockRpc.mockResolvedValue(privacy(false));
    mount();
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith("get_profile_privacy", {}));
    await act(async () => undefined);
    expect(mockStorageCalls).toEqual([]);
    expect(mockAvatarFiles.has(`${user}/me.jpg`)).toBe(true);
  });

  it("stops when the account changes, and tries again for that account later", async () => {
    const user = account(4);
    signIn(signedIn(user));
    mockAvatarFiles.add(`${user}/left-behind.jpg`);
    mockBeforeList = () => signIn(signedIn(account(98)));
    const stopped = await cleanUpMinorPhotos(user).catch((error: unknown) => error);
    expect(socialFailureOf(stopped)).toEqual({ kind: "account_changed" });
    expect(mockStorageCalls.map((call) => call.op)).toEqual(["list"]);
    expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(true);

    mockBeforeList = () => undefined;
    await expect(cleanUpMinorPhotos(user)).resolves.toBe(false);
    signIn(signedIn(user));
    await expect(cleanUpMinorPhotos(user)).resolves.toBe(true);
    expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(false);
  });

  it("retries a failed cleanup when the app returns to the foreground", async () => {
    const user = account(5);
    signIn(signedIn(user));
    mockAvatarFiles.add(`${user}/left-behind.jpg`);
    mockRpc.mockResolvedValue(privacy(true));
    let onAppState: ((state: AppStateStatus) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      onAppState = listener as (state: AppStateStatus) => void;
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
    });
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    let failures = 1;
    mockBeforeList = () => {
      if (failures-- > 0) throw new TypeError("Network request failed");
    };
    mount();
    await waitFor(() => expect(mockStorageCalls.map((call) => call.op)).toEqual(["list"]));
    expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(true);
    await act(async () => onAppState?.("active"));
    await waitFor(() => expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(false));
  });

  // Fourth review, finding 1: this device read "adult" and kept it, while another device recorded
  // minority and its last photo pass was cut short. Nothing would read privacy again in this session.
  it.each([
    ["a return to the foreground", foreground, 6],
    ["a reconnect", reconnect, 7],
  ])("reads its own privacy again on %s once the copy is old, and removes the photos left", async (_label, trigger, n) => {
    const user = account(n);
    signIn(signedIn(user));
    mockAvatarFiles.add(`${user}/left-behind.jpg`);
    mockRpc.mockResolvedValue(privacy(false));
    mount(appClient());
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(mockStorageCalls).toEqual([]);

    mockRpc.mockResolvedValue(privacy(true));
    // A recent copy is kept, so the cost stays at a few reads an hour.
    await trigger();
    expect(mockRpc).toHaveBeenCalledTimes(1);

    clockOffset = OWN_PRIVACY_REVALIDATE_MS + 1;
    await trigger();
    await waitFor(() => expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(false));
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockStorageCalls.every((call) => bearerSubject(call.auth) === user)).toBe(true);
  });

  it("reads its own privacy again on reconnect after the read at startup failed", async () => {
    const user = account(8);
    signIn(signedIn(user));
    mockAvatarFiles.add(`${user}/left-behind.jpg`);
    mockRpc.mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValue(privacy(true));
    mount(appClient());
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(true);

    await reconnect();
    await waitFor(() => expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(false));
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it("finishes a cleanup cut short offline when the connection returns", async () => {
    const user = account(9);
    signIn(signedIn(user));
    mockAvatarFiles.add(`${user}/left-behind.jpg`);
    mockRpc.mockResolvedValue(privacy(true));
    let failures = 1;
    mockBeforeList = () => {
      if (failures-- > 0) throw new TypeError("Network request failed");
    };
    mount(appClient());
    await waitFor(() => expect(mockStorageCalls.map((call) => call.op)).toEqual(["list"]));
    await act(async () => undefined);
    expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(true);

    await reconnect();
    await waitFor(() => expect(mockAvatarFiles.has(`${user}/left-behind.jpg`)).toBe(false));
    // Privacy was fresh, so only the cleanup ran again.
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
