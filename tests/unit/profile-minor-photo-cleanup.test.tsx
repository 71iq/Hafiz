import React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import { halaqaKeys } from "@/lib/halaqa/api";
import { cleanUpMinorPhotos, useMinorPhotoCleanup } from "@/lib/profile/use-minor-photo-cleanup";
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
});

afterEach(() => {
  cleanup();
  for (const client of queryClients.splice(0)) client.clear();
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
});
