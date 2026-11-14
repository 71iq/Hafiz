import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { requireSocialOwner } from "@/lib/social/owner";
import {
  callSocialRpcRaw,
  parseSocialPayload,
  socialError,
  socialFailureOf,
  type SocialRead,
} from "@/lib/social/remote";

/**
 * SB-01: offline, halaqa and board show the last state this account saw, with its date. Entries are
 * keyed by the account id, so another account on the device never reads them. The raw server payload
 * is stored and goes through the same schema as a fresh response when read back. Wird, streak and
 * plan never depend on this cache; a teacher's next sabaq (SOC-03) reads it only to choose which lines
 * a lesson offers.
 */
const PREFIX = "hafiz_social_cache_v1";

export type SocialSnapshot<T> = Readonly<{ data: T; savedAt: string; source: "network" | "cache" }>;

const envelope = z.object({ savedAt: z.iso.datetime({ offset: true }), payload: z.unknown() });

function storageKey(userId: string, name: string): string {
  return `${PREFIX}:${userId}:${name}`;
}

async function readSocialCache<T>(
  userId: string,
  name: string,
  schema: z.ZodType<T>,
): Promise<SocialSnapshot<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId, name));
    if (!raw) return null;
    const stored = envelope.safeParse(JSON.parse(raw));
    if (!stored.success) return null;
    const data = schema.safeParse(stored.data.payload);
    return data.success ? { data: data.data, savedAt: stored.data.savedAt, source: "cache" } : null;
  } catch {
    return null;
  }
}

async function writeSocialCache(userId: string, name: string, payload: unknown, savedAt: string): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId, name), JSON.stringify({ savedAt, payload }));
  } catch {
    // A full or unavailable store only loses the offline copy; the fresh result is still shown.
  }
}

/** The saved copy of `name` for this signed-in account, or null; "account_changed" once it is not. */
export async function readOwnSocialCache<T>(userId: string, name: string, schema: z.ZodType<T>): Promise<SocialSnapshot<T> | null> {
  const owner = requireSocialOwner(userId);
  const cached = await readSocialCache(userId, name, schema);
  owner.requireCurrent();
  return cached;
}

/**
 * Loads fresh data and keeps a copy. When the device is offline or the request cannot reach the
 * server, returns the saved copy instead; with no copy, the offline failure is rethrown. Server
 * refusals and invalid responses are never hidden behind an old copy.
 *
 * The load belongs to `userId`: it runs only while that account is signed in, sends that account's
 * token, and checks the account again before it writes or returns anything, so another account's
 * data never lands under this key.
 */
export async function loadWithSocialCache<T>(options: {
  userId: string;
  name: string;
  read: SocialRead<T>;
  offline: boolean;
  now?: () => Date;
}): Promise<SocialSnapshot<T>> {
  const { userId, name, read, offline } = options;
  const owner = requireSocialOwner(userId);
  const readOwnCopy = async () => {
    const cached = await readSocialCache(userId, name, read.schema);
    owner.requireCurrent();
    return cached;
  };
  if (offline) {
    const cached = await readOwnCopy();
    if (cached) return cached;
    throw socialError({ kind: "offline" });
  }
  try {
    const payload = await callSocialRpcRaw(read.fn, read.args, owner);
    const data = parseSocialPayload(read.schema, payload);
    const savedAt = (options.now?.() ?? new Date()).toISOString();
    owner.requireCurrent();
    await writeSocialCache(userId, name, payload, savedAt);
    owner.requireCurrent();
    return { data, savedAt, source: "network" };
  } catch (error) {
    if (socialFailureOf(error).kind === "offline") {
      const cached = await readOwnCopy();
      if (cached) return cached;
    }
    throw error;
  }
}
