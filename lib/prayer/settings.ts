import type { DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting, removeUserSetting } from "@/lib/database/user-settings";
import type { DhuhrResolver } from "@/lib/habit/cutoff";
import { createDhuhrResolver, prayerLocationSchema, roundCoordinate, type PrayerLocation } from "@/lib/prayer/times";

/**
 * Local only (spec 7.6, ETH-11): this key is outside the sync allowlist, so the location never
 * leaves the device and is not part of account restore.
 */
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

/**
 * STR-07: the make-up cutoff follows Dhuhr from this device's saved prayer location, or 12:30 when
 * none is saved. The habit layer reads it here so streaks and reminders always use the same Dhuhr.
 */
export async function readDhuhrResolver(db: DatabaseExecutor): Promise<DhuhrResolver> {
  return createDhuhrResolver(await readPrayerLocation(db));
}

/** Save or clear the location. Coordinates are rounded before they are stored. */
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
