import type { DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting, removeUserSetting } from "@/lib/database/user-settings";

/**
 * Device-only widget settings. The device_ prefix is outside every syncable prefix, and these keys
 * are not account-derived (lib/database/sync.ts), so they stay on this device and survive a restore.
 */
export const WIDGET_DEVICE_KEYS = {
  /** "true" when numbers are hidden; absent means shown. */
  hideNumbers: "device_widget_hide_numbers",
  /** JSON { "shown_at": ISO string } once the session-end offer was shown. */
  offer: "device_widget_offer",
} as const;

async function readValue(db: DatabaseExecutor, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM user_settings WHERE key = ? AND deleted_at IS NULL",
    [key],
  );
  return row?.value ?? null;
}

/** "Show numbers on the widget", on unless turned off. A failed read shows them. */
export async function readWidgetShowNumbers(db: DatabaseExecutor): Promise<boolean> {
  try {
    return (await readValue(db, WIDGET_DEVICE_KEYS.hideNumbers)) !== "true";
  } catch (error) {
    console.warn("[Widget] Could not read Show numbers:", error);
    return true;
  }
}

export async function writeWidgetShowNumbers(db: DatabaseExecutor, show: boolean): Promise<void> {
  if (show) await removeUserSetting(db, WIDGET_DEVICE_KEYS.hideNumbers);
  else await putUserSetting(db, WIDGET_DEVICE_KEYS.hideNumbers, "true");
}

/** Whether the session-end offer was shown on this device. A failed read keeps the offer away. */
export async function readWidgetOfferShown(db: DatabaseExecutor): Promise<boolean> {
  try {
    // Any stored value was written by an offer, whatever its shape.
    return (await readValue(db, WIDGET_DEVICE_KEYS.offer)) !== null;
  } catch (error) {
    console.warn("[Widget] Could not read the widget offer:", error);
    return true;
  }
}

export async function markWidgetOfferShown(db: DatabaseExecutor, at: Date): Promise<void> {
  await putUserSetting(db, WIDGET_DEVICE_KEYS.offer, JSON.stringify({ shown_at: at.toISOString() }));
}
