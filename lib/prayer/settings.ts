import type { DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting, removeUserSetting } from "@/lib/database/user-settings";
import type { DhuhrResolver } from "@/lib/habit/cutoff";
import { createDhuhrResolver, prayerLocationSchema, roundCoordinate, type PrayerLocation } from "@/lib/prayer/times";

const PRAYER_LOCATION_KEY = "notif_prayer_location";

export function parsePrayerLocation(value: string | null | undefined): PrayerLocation | null {
  if (!value) return null;
  try {
    const parsed = prayerLocationSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function readPrayerLocation(db: DatabaseExecutor): Promise<PrayerLocation | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ? AND deleted_at IS NULL",
    [PRAYER_LOCATION_KEY],
  );
  return parsePrayerLocation(row?.value);
}

export async function readDhuhrResolver(db: DatabaseExecutor): Promise<DhuhrResolver> {
  return createDhuhrResolver(await readPrayerLocation(db));
}

export async function writePrayerLocation(db: DatabaseExecutor, location: PrayerLocation | null): Promise<void> {
  if (location === null) {
    await removeUserSetting(db, PRAYER_LOCATION_KEY);
    return;
  }
  const stored = prayerLocationSchema.parse({
    ...location,
    latitude: roundCoordinate(location.latitude),
    longitude: roundCoordinate(location.longitude),
  });
  await putUserSetting(db, PRAYER_LOCATION_KEY, JSON.stringify(stored));
}
