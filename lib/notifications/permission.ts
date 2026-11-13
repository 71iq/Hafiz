import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { reminderPlatform } from "@/lib/notifications/platform";
import type { PermissionState } from "@/lib/notifications/platform-types";
import { rescheduleReminders } from "@/lib/notifications/schedule";
import { LOCAL_KEYS, optInPromptsSchema, readLocalSetting, writeLocalSetting, type OptInPrompts } from "@/lib/notifications/settings";

/** ONB-03: at most 4 prompts. */
const MAX_PERMISSION_PROMPTS = 4;
const DAY_MS = 86_400_000;

/**
 * Spec 8.10. Ask again only after growing gaps: 2 days after the first prompt, 7 after the second,
 * 14 after the third, and never after the fourth.
 */
export function canAskNotificationPermission(count: number, lastShown: Date | null, now: Date): boolean {
  if (count >= MAX_PERMISSION_PROMPTS) return false;
  if (!lastShown) return true;
  const gapDays = count <= 1 ? 2 : count === 2 ? 7 : 14;
  return now.getTime() - lastShown.getTime() >= gapDays * DAY_MS;
}

export async function readOptInPrompts(db: DatabaseExecutor): Promise<OptInPrompts> {
  return (await readLocalSetting(db, LOCAL_KEYS.optInPrompts, optInPromptsSchema)) ?? { count: 0, last_shown_at: null };
}

/** One prompt impression, whether the user allowed or declined. Stored on this device only. */
async function recordPrompt(db: DatabaseExecutor, now: Date): Promise<void> {
  const prompts = await readOptInPrompts(db);
  await writeLocalSetting(db, LOCAL_KEYS.optInPrompts, { count: prompts.count + 1, last_shown_at: now.toISOString() });
}

async function hasCompletedSession(db: DatabaseExecutor): Promise<boolean> {
  const row = await db.getFirstAsync<{ found: number }>(
    "SELECT 1 AS found FROM review_sessions WHERE deleted_at IS NULL AND cards_reviewed > 0 LIMIT 1",
  );
  return row !== null;
}

/**
 * Whether to show the contextual permission card now. ONB-02: only after the first session. ONB-03:
 * the re-ask gaps and cap. Never when the OS has already granted it or will not show its prompt.
 */
export async function shouldOfferNotificationPrompt(db: DatabaseExecutor, { now = new Date() } = {}): Promise<boolean> {
  if (!reminderPlatform.supportsScheduling) return false;
  const permission = await reminderPlatform.getPermission();
  if (permission.status === "granted" || !permission.canAskAgain) return false;
  if (!(await hasCompletedSession(db))) return false;
  const prompts = await readOptInPrompts(db);
  const lastShown = prompts.last_shown_at ? new Date(prompts.last_shown_at) : null;
  return canAskNotificationPermission(prompts.count, lastShown, now);
}

export function getNotificationPermission(): Promise<PermissionState> {
  return reminderPlatform.getPermission();
}

/**
 * The user tapped "Allow" on the contextual card: record the prompt, show the OS prompt, and
 * schedule reminders when granted. Call this or declineNotificationPrompt once per card shown.
 */
export async function requestNotificationPermission(db: AppDatabase, { now = new Date() } = {}): Promise<PermissionState> {
  if (!reminderPlatform.supportsScheduling) return reminderPlatform.getPermission();
  const current = await reminderPlatform.getPermission();
  if (current.status === "granted") {
    await rescheduleReminders(db, { now });
    return current;
  }
  await recordPrompt(db, now);
  const result = await reminderPlatform.requestPermission();
  if (result.status === "granted") await rescheduleReminders(db, { now });
  return result;
}

/** The user chose "Not now" on the contextual card. It still counts toward the 4 prompts. */
export async function declineNotificationPrompt(db: DatabaseExecutor, { now = new Date() } = {}): Promise<void> {
  await recordPrompt(db, now);
}

/** When the OS will not prompt again, the settings section links to system settings instead. */
export function openNotificationSystemSettings(): Promise<void> {
  return reminderPlatform.openSystemSettings();
}
