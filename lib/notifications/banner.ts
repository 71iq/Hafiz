import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import type { LocalDate } from "@/lib/habit/dates";
import { deviceClock, type DayClock } from "@/lib/notifications/clock";
import { planNotifications, projectHabit } from "@/lib/notifications/planner";
import { reminderPlatform } from "@/lib/notifications/platform";
import { hijriDateOf, RAMADAN_MONTH } from "@/lib/notifications/ramadan";
import { loadReminderContext, rescheduleReminders } from "@/lib/notifications/schedule";
import {
  bannerDismissedSchema,
  LOCAL_KEYS,
  ramadanOfferSchema,
  readLocalSetting,
  writeLocalSetting,
  writeReminderPref,
} from "@/lib/notifications/settings";
import { renderNotification, type Language } from "@/lib/notifications/templates";
import type { NotificationType, RamadanAnchor, ReminderRoute } from "@/lib/notifications/types";

export type ReminderBanner =
  | Readonly<{ kind: "ramadan_offer"; hijriYear: number; localDate: LocalDate }>
  | Readonly<{
      kind: "reminder";
      type: NotificationType;
      localDate: LocalDate;
      title: string;
      body: string;
      route: ReminderRoute;
    }>;

/** A small seeded generator, so the banner's template stays the same through the day. */
function seededRandom(seed: string): () => number {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const STATE_FOR_TYPE: Partial<Record<NotificationType, readonly string[]>> = {
  makeup_window: ["make_up_open"],
  streak_at_risk: ["at_risk"],
  late_reminder: ["at_risk"],
  grace_used: ["at_risk"],
  earnback_open: ["earn_back"],
};

/**
 * The in-app reminder for right now (NOT-03). Web always uses it because it cannot schedule; native
 * uses it only while notifications are not allowed. It is the latest reminder due today under the
 * same rules as the notifications, still true at `now`, and not dismissed today. During the first
 * days of Ramadan it offers the Ramadan reminder times once (NOT-10).
 */
export async function loadReminderBanner(
  db: DatabaseExecutor,
  { now = new Date(), language, clock = deviceClock }: { now?: Date; language?: Language; clock?: DayClock } = {},
): Promise<ReminderBanner | null> {
  const context = await loadReminderContext(db, { now, language, clock });
  const { prefs, input } = context;
  if (!prefs.enabled) return null;
  const today = clock.dateOf(now);

  const hijri = hijriDateOf(today);
  if (hijri?.month === RAMADAN_MONTH && prefs.ramadanAnchor === null) {
    const offered = await readLocalSetting(db, LOCAL_KEYS.ramadanOffer, ramadanOfferSchema);
    if (offered?.hijri_year !== hijri.year) return { kind: "ramadan_offer", hijriYear: hijri.year, localDate: today };
  }

  if (reminderPlatform.supportsScheduling && (await reminderPlatform.getPermission()).status === "granted") return null;

  const dayStart = clock.at(today, 0);
  const plan = planNotifications({
    ...input,
    // Plan from just before midnight so every slot of today counts as upcoming.
    now: new Date(dayStart.getTime() - 1),
    horizonDays: 2,
    backoff: 0,
    delivered: [],
    remindLater: null,
    random: seededRandom(today),
  });
  const due = plan.slots.filter((slot) => slot.at.getTime() <= now.getTime() && slot.localDate === today);
  const latest = due[due.length - 1];
  if (!latest) return null;

  const current = projectHabit(input, today, now).snapshot.headline.kind;
  if (["done_today", "excused_today", "paused"].includes(current) && latest.type !== "friday_kahf") return null;
  const needed = STATE_FOR_TYPE[latest.type];
  if (needed && !needed.includes(current)) return null;

  const dismissed = await readLocalSetting(db, LOCAL_KEYS.bannerDismissed, bannerDismissedSchema);
  if (dismissed?.local_date === today && dismissed.kind === latest.type) return null;

  const { title, body } = renderNotification(latest, context.language, context.surahNames);
  return { kind: "reminder", type: latest.type, localDate: today, title, body, route: latest.route };
}

/** Hide the banner for the rest of the day. A later reminder of another type can still show. */
export async function dismissReminderBanner(db: DatabaseExecutor, banner: ReminderBanner): Promise<void> {
  if (banner.kind === "ramadan_offer") {
    await writeLocalSetting(db, LOCAL_KEYS.ramadanOffer, { hijri_year: banner.hijriYear });
    return;
  }
  await writeLocalSetting(db, LOCAL_KEYS.bannerDismissed, { local_date: banner.localDate, kind: banner.type });
}

/** NOT-10: answer the Ramadan offer once. A choice moves the anchor for Ramadan only. */
export async function answerRamadanOffer(
  db: AppDatabase,
  { hijriYear, choice, now = new Date() }: { hijriYear: number; choice: RamadanAnchor | null; now?: Date },
): Promise<void> {
  if (choice) await writeReminderPref(db, { kind: "ramadanAnchor", value: choice });
  await writeLocalSetting(db, LOCAL_KEYS.ramadanOffer, { hijri_year: hijriYear });
  await rescheduleReminders(db, { now });
}
