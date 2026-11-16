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
  }
}

export async function writeOwnSocialCache(userId: string, name: string, payload: unknown, savedAt: string): Promise<void> {
  const owner = requireSocialOwner(userId);
  await writeSocialCache(userId, name, payload, savedAt);
  owner.requireCurrent();
}

export async function forgetSocialCache(userId: string, name: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId, name));
  } catch {
  }
}

export async function readOwnSocialCache<T>(userId: string, name: string, schema: z.ZodType<T>): Promise<SocialSnapshot<T> | null> {
  const owner = requireSocialOwner(userId);
  const cached = await readSocialCache(userId, name, schema);
  owner.requireCurrent();
  return cached;
}

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
