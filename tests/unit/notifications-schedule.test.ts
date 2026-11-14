import { router } from "expo-router";
import { putUserSetting } from "@/lib/database/user-settings";
import { addDays, atLocalTime, localDateOf } from "@/lib/habit/dates";
import { putHabitDay } from "@/lib/habit/queries";
import type { HabitDayRow } from "@/lib/habit/types";
import { DEFAULT_HIFZ_PLAN, writeHifzPlan } from "@/lib/hifz/plan";
import { dismissReminderBanner, loadReminderBanner } from "@/lib/notifications/banner";
import { projectHabit } from "@/lib/notifications/habit-projection";
import type {
  PermissionState,
  PresentedReminder,
  ReminderData,
  ReminderRequest,
  ReminderResponse,
  ScheduledReminder,
} from "@/lib/notifications/platform-types";
import {
  declineNotificationPrompt,
  readOptInPrompts,
  requestNotificationPermission,
  shouldOfferNotificationPrompt,
} from "@/lib/notifications/permission";
import { reminderPlatform } from "@/lib/notifications/platform";
import { openReminderRoute, resolveReminderHref } from "@/lib/notifications/reminder-route";
import {
  configureReminderPlatform,
  diffReminders,
  loadReminderContext,
  notifyGroupEncouragement,
  reconcileReminders,
  requestRemindLater,
  rescheduleReminders,
  setReminderAccountSource,
  shouldPresentReminder,
} from "@/lib/notifications/schedule";
import { LOCAL_KEYS, writeReminderPref } from "@/lib/notifications/settings";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

type FakePlatform = {
  supportsScheduling: boolean;
  permission: PermissionState;
  requested: PermissionState;
  scheduled: (ScheduledReminder & { request: ReminderRequest })[];
  presented: PresentedReminder[];
  dismissed: string[];
  badge: number | null;
  nextId: number;
  /** Runs as a cancel request reaches the OS, before it takes effect: an alarm can still go off. */
  beforeCancel: () => void;
  /** The foreground handler's callbacks from the latest configure call. */
  foreground: { shouldPresent: (data: ReminderData) => boolean; onHidden: (data: ReminderData) => void } | null;
};

const fake: FakePlatform = {
  supportsScheduling: true,
  permission: { status: "granted", canAskAgain: true },
  requested: { status: "granted", canAskAgain: true },
  scheduled: [],
  presented: [],
  dismissed: [],
  badge: null,
  nextId: 1,
  beforeCancel: () => undefined,
  foreground: null,
};

jest.mock("@/lib/notifications/platform", () => ({
  reminderPlatform: {
    get supportsScheduling() {
      return fake.supportsScheduling;
    },
    getPermission: async () => fake.permission,
    requestPermission: async () => {
      fake.permission = fake.requested;
      return fake.requested;
    },
    configure: async (options: NonNullable<FakePlatform["foreground"]>) => {
      fake.foreground = { shouldPresent: options.shouldPresent, onHidden: options.onHidden };
    },
    listScheduled: async () => fake.scheduled.map(({ osId, data }) => ({ osId, data })),
    listPresented: async () => fake.presented,
    schedule: async (request: ReminderRequest) => {
      const osId = `os-${fake.nextId++}`;
      fake.scheduled.push({ osId, data: request.data, request });
      return osId;
    },
    cancel: async (ids: readonly string[]) => {
      fake.beforeCancel();
      fake.scheduled = fake.scheduled.filter((item) => !ids.includes(item.osId));
    },
    dismiss: async (ids: readonly string[]) => {
      fake.dismissed.push(...ids);
      fake.presented = fake.presented.filter((item) => !ids.includes(item.osId));
    },
    setBadge: async (count: number) => {
      fake.badge = count;
    },
    openSystemSettings: async () => {},
    subscribeResponses: () => () => {},
    takeLaunchResponse: async () => null,
  },
}));

let store: OutboxDatabase;
const TODAY = "2026-11-12";
const ACCOUNT_A = "00000000-0000-4000-8000-00000000000a";
const ACCOUNT_B = "00000000-0000-4000-8000-00000000000b";
let signedInAccount: string | null = ACCOUNT_A;
const accountOf = (userId: string) => ({ userId, isCurrent: () => signedInAccount === userId });
const at = (date: string, hours: number, minutes = 0) => atLocalTime(date, hours * 60 + minutes);

function day(date: string, status: "done" | "grace" = "done"): HabitDayRow {
  const stamp = at(date, 20).toISOString();
  return {
    local_date: date,
    status,
    earned_status: status,
    reason: null,
    excuse_updated_at: null,
    minimum_met: status === "done" ? 1 : 0,
    full_met: 0,
    manzil_cycle_completed: 0,
    source_session_id: null,
    credited_through: null,
    tz: "UTC",
    created_at: stamp,
    updated_at: stamp,
  };
}

async function seed(dates: string[]) {
  await store.db.withTransactionAsync(async (tx) => {
    for (const date of dates) await putHabitDay(tx, day(date));
  });
}

function lastDays(count: number, endOffset = -1): string[] {
  return Array.from({ length: count }, (_, index) => addDays(TODAY, endOffset - index));
}

/** The OS shows every reminder due by `until` and stops holding it, as a one-shot alarm does. */
function osFires(until: Date) {
  fake.scheduled = fake.scheduled.filter((item) => item.data.at > until.getTime());
}

/**
 * One alarm goes off while the app is open: the OS lets go of it and the foreground handler shows it
 * or hides it, as lib/notifications/platform.native.ts does.
 */
function firesWhileOpen(alarm: ScheduledReminder) {
  const handler = fake.foreground;
  if (!handler) throw new Error("The reminder platform was not configured");
  fake.scheduled = fake.scheduled.filter((item) => item.osId !== alarm.osId);
  if (handler.shouldPresent(alarm.data)) fake.presented = [...fake.presented, { osId: alarm.osId, data: alarm.data }];
  else handler.onHidden(alarm.data);
}

function logRow(id: string) {
  return store.sql.prepare("SELECT delivered_at, cancelled_at FROM notification_log WHERE id = ?").get(id);
}

function storedSetting(key: string): unknown {
  const row = store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(key);
  return row ? JSON.parse(String(row.value)) : null;
}

function scheduledTypes() {
  return fake.scheduled
    .map((item) => `${item.data.localDate} ${item.data.type}`)
    .sort();
}

function logCount(where = "1 = 1") {
  return Number(store.sql.prepare(`SELECT COUNT(*) AS count FROM notification_log WHERE ${where}`).get()?.count);
}

async function insertSession(id: string, started: Date) {
  const stamp = started.toISOString();
  await store.db.runAsync(
    `INSERT INTO review_sessions (id, kind, deck_id, started_at, ended_at, duration_ms, local_date, tz, cards_reviewed,
      pages_reviewed, new_lines, clean_pages, errors, minimum_met, full_met, source, created_at, updated_at, deleted_at)
     VALUES (?, 'cards', NULL, ?, ?, 60000, ?, 'UTC', 3, 0, 0, 0, 0, 0, 0, 'app', ?, ?, NULL)`,
    [id, stamp, stamp, localDateOf(started), stamp, stamp],
  );
}

/** A log row for a reminder the OS no longer holds; `delivered` is when this device saw it shown. */
async function addLogRow(id: string, type: string, scheduled: Date, delivered: Date | null = null) {
  await store.db.runAsync(
    `INSERT INTO notification_log (id, type, template_id, local_date, scheduled_for, os_id, delivered_at, opened_at, converted, cancelled_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0, NULL)`,
    [id, type, `${type}.1`, localDateOf(scheduled), scheduled.toISOString(), delivered?.toISOString() ?? null],
  );
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  signedInAccount = ACCOUNT_A;
  setReminderAccountSource(() => signedInAccount);
  Object.assign(fake, {
    supportsScheduling: true,
    permission: { status: "granted", canAskAgain: true },
    requested: { status: "granted", canAskAgain: true },
    scheduled: [],
    presented: [],
    dismissed: [],
    badge: null,
    nextId: 1,
    beforeCancel: () => undefined,
    foreground: null,
  });
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await store.db.getFirstAsync("SELECT 1");
  await store.close();
  jest.restoreAllMocks();
});

describe("rescheduleReminders", () => {
  it("schedules dated reminders for the next 7 days and logs each one", async () => {
    await seed(lastDays(5));
    const result = await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    expect(result.status).toBe("scheduled");
    expect(scheduledTypes().slice(0, 2)).toEqual([`${TODAY} streak_at_risk`, `${TODAY} wird_reminder`]);
    // Two counted reminders a day reach 7 unanswered by day 4, so from then on the batch sends every
    // other day (NOT-09). Every day without a reminder was left out by that back-off and nothing else.
    const dates = new Set(fake.scheduled.map((item) => item.data.localDate));
    for (let offset = 0; offset < 4; offset += 1) expect(dates.has(addDays(TODAY, offset))).toBe(true);
    const missing = Array.from({ length: 7 }, (_, offset) => addDays(TODAY, offset)).filter((date) => !dates.has(date));
    expect(missing.length).toBeGreaterThan(0);
    for (const date of missing) {
      expect(result.plan?.skipped.filter((item) => item.localDate === date).every((item) => item.reason === "backoff")).toBe(true);
    }
    expect(logCount()).toBe(fake.scheduled.length);
    const first = fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY)!;
    expect(first.data.at).toBe(at(TODAY, 5, 20).getTime());
    expect(first.request.remindLaterAction).toBe(true);
    expect(first.request.title).toBe("Today's wird");
  });

  it("is idempotent: a second run keeps every reminder", async () => {
    await seed(lastDays(5));
    const first = await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const ids = fake.scheduled.map((item) => item.osId).sort();
    const second = await rescheduleReminders(store.db, { now: at(TODAY, 3, 5), language: "en" });
    expect(second.created).toBe(0);
    expect(second.cancelled).toBe(0);
    expect(second.kept).toBe(first.created);
    expect(fake.scheduled.map((item) => item.osId).sort()).toEqual(ids);
  });

  it("keeps tonight's late reminder when it replans after 23:00 with the wird still open", async () => {
    await seed(lastDays(5));
    await writeReminderPref(store.db, { kind: "type", type: "late_reminder", value: true });
    await rescheduleReminders(store.db, { now: at(TODAY, 22), language: "en" });
    const lateId = fake.scheduled.find((item) => item.data.type === "late_reminder" && item.data.localDate === TODAY)?.osId;
    expect(lateId).toBeDefined();
    osFires(at(TODAY, 23, 1));
    await rescheduleReminders(store.db, { now: at(TODAY, 23, 1), language: "en" });
    expect(fake.scheduled.filter((item) => item.data.type === "late_reminder" && item.data.localDate === TODAY).map((item) => item.osId)).toEqual([lateId]);
  });

  it("cancels today's wird reminders once the day is done and tidies the tray (NOT-05)", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    fake.presented = [
      { osId: "shown-today", data: { ...fake.scheduled[0].data, localDate: TODAY, type: "wird_reminder" } },
      { osId: "shown-yesterday", data: { ...fake.scheduled[0].data, localDate: addDays(TODAY, -1), type: "wird_reminder" } },
    ];
    await seed([TODAY]);
    osFires(at(TODAY, 7));
    await rescheduleReminders(store.db, { now: at(TODAY, 7), language: "en" });
    expect(fake.scheduled.some((item) => item.data.localDate === TODAY)).toBe(false);
    expect(fake.dismissed.sort()).toEqual(["shown-today", "shown-yesterday"]);
    // The 05:20 reminder already fired, so its row stays for back-off; the evening one is gone.
    expect(logCount(`local_date = '${TODAY}' AND scheduled_for > '${at(TODAY, 7).toISOString()}'`)).toBe(0);
    expect(logCount(`local_date = '${TODAY}' AND type = 'wird_reminder'`)).toBe(1);
  });

  it("cancels everything when the master switch is off or permission is missing", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    await writeReminderPref(store.db, { kind: "enabled", value: false });
    expect((await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" })).status).toBe("disabled");
    expect(fake.scheduled).toEqual([]);
    expect(logCount()).toBe(0);

    await writeReminderPref(store.db, { kind: "enabled", value: true });
    fake.permission = { status: "denied", canAskAgain: false };
    expect((await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" })).status).toBe("no_permission");
    expect(fake.scheduled).toEqual([]);
  });

  it("renders Arabic when the app is in Arabic", async () => {
    await seed(lastDays(5));
    await store.db.runAsync("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES ('ui_language', 'ar', ?)", [
      new Date().toISOString(),
    ]);
    await rescheduleReminders(store.db, { now: at(TODAY, 3) });
    const wird = fake.scheduled.find((item) => item.data.type === "wird_reminder")!;
    expect(wird.request.title).toBe("وِرد اليوم");
  });

  it("sets the app-icon badge only when enabled and today is open (AMB-04)", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    expect(fake.badge).toBe(0);
    await writeReminderPref(store.db, { kind: "badge", value: true });
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    expect(fake.badge).toBe(1);
    await seed([TODAY]);
    await rescheduleReminders(store.db, { now: at(TODAY, 8), language: "en" });
    expect(fake.badge).toBe(0);
  });

  it("schedules a remind-later follow-up and drops it when the wird is done", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const original = fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY)!;
    // It showed, and stays in the tray after its action button is pressed, as on Android.
    osFires(at(TODAY, 5, 21));
    fake.presented = [...fake.presented, { osId: original.osId, data: original.data }];
    const response: ReminderResponse = { data: original.data, action: "remind_later", osId: original.osId };
    expect(await requestRemindLater(store.db, response, { now: at(TODAY, 5, 30) })).toBe(true);
    const followUp = fake.scheduled.find((item) => item.data.type === "remind_later");
    expect(followUp?.data.at).toBe(at(TODAY, 6, 30).getTime());
    // NOT-05b: the follow-up replaces the original, which leaves the tray.
    expect(fake.presented.some((item) => item.osId === original.osId)).toBe(false);

    await seed([TODAY]);
    await rescheduleReminders(store.db, { now: at(TODAY, 6), language: "en" });
    expect(fake.scheduled.some((item) => item.data.type === "remind_later")).toBe(false);
    const pending = store.sql.prepare("SELECT COUNT(*) AS count FROM user_settings WHERE key = ?").get(LOCAL_KEYS.remindLater);
    expect(Number(pending?.count)).toBe(0);
  });

  it.each(["done", "excused", "paused"] as const)(
    "cancels an overdue follow-up the OS still holds once today is %s (NOT-05b)",
    async (cover) => {
      await seed(lastDays(5));
      await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
      const original = fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY)!;
      osFires(at(TODAY, 5, 21));
      expect(await requestRemindLater(store.db, { data: original.data, action: "remind_later" }, { now: at(TODAY, 5, 30) })).toBe(true);
      const followUp = () => fake.scheduled.find((item) => item.data.type === "remind_later");
      expect(followUp()?.data.at).toBe(at(TODAY, 6, 30).getTime());

      // 06:45: the 06:30 alarm is late and the OS still holds it when the day becomes covered.
      if (cover === "done") await seed([TODAY]);
      else if (cover === "excused") await putHabitDay(store.db, { ...day(TODAY), status: "excused", earned_status: null, reason: "illness", minimum_met: 0 });
      else await putUserSetting(store.db, "habit_pause", JSON.stringify({ start: TODAY, end: addDays(TODAY, 3) }));
      await rescheduleReminders(store.db, { now: at(TODAY, 6, 45), language: "en" });
      expect(followUp()).toBeUndefined();
    },
  );

  it("keeps the original when the system refuses to schedule its follow-up (NOT-05b)", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const original = fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY)!;
    osFires(at(TODAY, 5, 21));
    fake.presented = [...fake.presented, { osId: original.osId, data: original.data }];
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const schedule = jest.spyOn(reminderPlatform, "schedule").mockRejectedValue(new Error("Synthetic scheduling failure"));
    const response: ReminderResponse = { data: original.data, action: "remind_later", osId: original.osId };
    expect(await requestRemindLater(store.db, response, { now: at(TODAY, 5, 30) })).toBe(false);
    schedule.mockRestore();
    expect(fake.scheduled.some((item) => item.data.type === "remind_later")).toBe(false);
    expect(fake.presented.some((item) => item.osId === original.osId)).toBe(true);
  });

  it("keeps an overdue follow-up the OS still holds while today is still open", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const original = fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY)!;
    osFires(at(TODAY, 5, 21));
    await requestRemindLater(store.db, { data: original.data, action: "remind_later" }, { now: at(TODAY, 5, 30) });
    const followUp = fake.scheduled.find((item) => item.data.type === "remind_later")!;
    await rescheduleReminders(store.db, { now: at(TODAY, 6, 45), language: "en" });
    expect(fake.scheduled.find((item) => item.data.type === "remind_later")?.osId).toBe(followUp.osId);
  });

  it("refuses a follow-up that would cross midnight or land in quiet hours", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const original = fake.scheduled[0];
    expect(await requestRemindLater(store.db, { data: original.data, action: "remind_later" }, { now: at(TODAY, 22, 30) })).toBe(false);
    expect(
      await requestRemindLater(store.db, { data: { ...original.data, localDate: addDays(TODAY, -1) }, action: "remind_later" }, { now: at(TODAY, 9) }),
    ).toBe(false);
  });

  it("batches halaqa encouragement into one notification", async () => {
    await seed([...lastDays(5), TODAY]);
    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10) });
    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10, 5) });
    const group = fake.scheduled.filter((item) => item.data.type === "group_encouragement");
    expect(group).toHaveLength(1);
    expect(group[0].data.at).toBe(at(TODAY, 10, 30).getTime());
    expect(group[0].request.body).not.toContain("{{");
  });

  it("marks a reminder converted when a session starts within 2 hours", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const started = at(TODAY, 6).toISOString();
    await store.db.runAsync(
      `INSERT INTO review_sessions (id, kind, deck_id, started_at, ended_at, duration_ms, local_date, tz, cards_reviewed,
        pages_reviewed, new_lines, clean_pages, errors, minimum_met, full_met, source, created_at, updated_at, deleted_at)
       VALUES ('s1', 'cards', NULL, ?, ?, 60000, ?, 'UTC', 3, 0, 0, 0, 0, 0, 0, 'app', ?, ?, NULL)`,
      [started, started, TODAY, started, started],
    );
    osFires(at(TODAY, 9));
    await rescheduleReminders(store.db, { now: at(TODAY, 9), language: "en" });
    expect(logCount("converted = 1 AND type = 'wird_reminder'")).toBe(1);
  });

  it.each([
    ["seen in the tray", true],
    ["swiped away before the app ran", false],
  ])("counts a delayed delivery %s from when it showed, not from its time (NOT-09)", async (_label, presented) => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const wird = fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY)!;
    // The OS holds the 05:20 alarm until 10:00, then shows it; the app runs at 10:01.
    await rescheduleReminders(store.db, { now: at(TODAY, 9), language: "en" });
    fake.scheduled = fake.scheduled.filter((item) => item.osId !== wird.osId);
    fake.presented = presented ? [{ osId: wird.osId, data: wird.data }] : [];
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 1), language: "en" });
    expect(storedSetting(LOCAL_KEYS.backoff)).toMatchObject({ consecutive_ignored: 0, cursor: null });

    // A session at 10:10 answers it.
    await insertSession("s-after-delivery", at(TODAY, 10, 10));
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 15), language: "en" });
    expect(logCount(`id = '${wird.data.logId}' AND converted = 1`)).toBe(1);
  });

  it("keeps a late alarm the OS still holds as pending, and counts it only once the OS lets go", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const wird = () => fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY);
    const original = wird()!;
    // 05:30: the 05:20 alarm is late and the OS still holds it.
    await rescheduleReminders(store.db, { now: at(TODAY, 5, 30), language: "en" });
    expect(wird()?.osId).toBe(original.osId);
    expect(logRow(original.data.logId)).toEqual({ delivered_at: null, cancelled_at: null });
    const late = await loadReminderContext(store.db, {
      now: at(TODAY, 5, 30),
      language: "en",
      stillScheduled: new Set([original.data.logId]),
    });
    expect(late.input.delivered.filter((item) => item.localDate === TODAY)).toEqual([]);
    expect(late.input.late?.map((item) => item.type)).toEqual(["wird_reminder"]);

    // The OS shows it at 05:31 and no longer holds it.
    osFires(at(TODAY, 5, 31));
    await rescheduleReminders(store.db, { now: at(TODAY, 5, 40), language: "en" });
    const after = await loadReminderContext(store.db, { now: at(TODAY, 5, 40), language: "en", stillScheduled: new Set() });
    expect(after.input.delivered.map((item) => `${item.localDate} ${item.type}`)).toContain(`${TODAY} wird_reminder`);
  });

  it("records a late alarm it cancels as cancelled, never as delivered", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const original = fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY)!;
    await seed([TODAY]);
    await rescheduleReminders(store.db, { now: at(TODAY, 5, 30), language: "en" });
    expect(fake.scheduled.some((item) => item.osId === original.osId)).toBe(false);
    expect(logRow(original.data.logId)).toEqual({ delivered_at: null, cancelled_at: at(TODAY, 5, 30).toISOString() });
    const later = await loadReminderContext(store.db, { now: at(TODAY, 9), language: "en" });
    expect(later.input.delivered.filter((item) => item.localDate === TODAY)).toEqual([]);
  });

  it("leaves a reminder about to fire alone, so it is logged once and the evening reminder stays", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const wirdToday = () => fake.scheduled.filter((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY);
    const original = wirdToday()[0].osId;
    for (const now of [at(TODAY, 5, 19), new Date(at(TODAY, 5, 19).getTime() + 30_000)]) {
      const result = await rescheduleReminders(store.db, { now, language: "en" });
      expect(result.created).toBe(0);
      expect(wirdToday().map((item) => item.osId)).toEqual([original]);
    }
    await rescheduleReminders(store.db, { now: at(TODAY, 5, 25), language: "en" });
    expect(logCount(`local_date = '${TODAY}' AND type = 'wird_reminder'`)).toBe(1);
    expect(scheduledTypes()).toContain(`${TODAY} streak_at_risk`);
  });

  it("records a reminder cancelled just before its time as cancelled, never as delivered", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    await seed([TODAY]);
    await rescheduleReminders(store.db, { now: at(TODAY, 5, 19), language: "en" });
    expect(fake.scheduled.some((item) => item.data.localDate === TODAY && item.data.type === "wird_reminder")).toBe(false);
    const row = store.sql
      .prepare("SELECT cancelled_at FROM notification_log WHERE local_date = ? AND type = 'wird_reminder'")
      .get(TODAY);
    expect(row?.cancelled_at).toBe(at(TODAY, 5, 19).toISOString());
    const later = await loadReminderContext(store.db, { now: at(TODAY, 9), language: "en" });
    expect(later.input.delivered.filter((item) => item.localDate === TODAY)).toEqual([]);
  });

  it("refuses a follow-up once two reminders fired that day (NOT-07)", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const original = fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY)!;
    await addLogRow("group-1", "group_encouragement", at(TODAY, 9));
    osFires(at(TODAY, 10));
    // It showed and is still in the tray.
    fake.presented = [...fake.presented, { osId: original.osId, data: original.data }];
    const response = { data: original.data, action: "remind_later" as const, osId: original.osId };
    expect(await requestRemindLater(store.db, response, { now: at(TODAY, 10) })).toBe(false);
    expect(fake.scheduled.some((item) => item.data.type === "remind_later")).toBe(false);
    // With no follow-up coming, the original stays where it is.
    expect(fake.presented.some((item) => item.osId === original.osId)).toBe(true);
  });

  it("keeps back-off until the next session, however old the ignored reminders are (NOT-09)", async () => {
    // 14 reminders ignored from 25 October to 7 November, then no session for months.
    for (let offset = 0; offset < 14; offset += 1) {
      const date = addDays("2026-10-25", offset);
      await addLogRow(`ignored-${offset}`, "wird_reminder", at(date, 5, 20));
    }
    const level = async (date: string) => (await loadReminderContext(store.db, { now: at(date, 3), language: "en" })).input.backoff;
    expect(await level("2026-11-08")).toBe(2);
    await rescheduleReminders(store.db, { now: at("2026-11-08", 3), language: "en" });
    expect(await level("2026-11-24")).toBe(2);

    // Past the log's 90-day retention the rows are gone, and the stored count still holds.
    await rescheduleReminders(store.db, { now: at("2027-02-10", 3), language: "en" });
    expect(logCount(`id LIKE 'ignored-%'`)).toBe(0);
    expect(await level("2027-02-11")).toBe(2);

    await insertSession("s-back", at("2027-02-11", 6));
    expect(await level("2027-02-11")).toBe(0);
  });

  it("adds new ignored reminders to the stored total after old rows are pruned (NOT-09)", async () => {
    // Runs only record outcomes here, so the log holds just these rows.
    await writeReminderPref(store.db, { kind: "enabled", value: false });
    const backoff = () => storedSetting(LOCAL_KEYS.backoff) as { consecutive_ignored: number; level: number };
    for (let offset = 0; offset < 7; offset += 1) {
      const shown = at(addDays("2026-08-01", offset), 5, 20);
      await addLogRow(`old-${offset}`, "wird_reminder", shown, shown);
    }
    await rescheduleReminders(store.db, { now: at("2026-08-10", 3), language: "en" });
    expect(backoff()).toMatchObject({ consecutive_ignored: 7, level: 1 });

    // 90 days on, the seven rows are pruned; seven new reminders are ignored after that.
    await rescheduleReminders(store.db, { now: at("2026-11-10", 3), language: "en" });
    expect(logCount("id LIKE 'old-%'")).toBe(0);
    for (let offset = 0; offset < 7; offset += 1) {
      const shown = at(addDays("2026-11-11", offset), 5, 20);
      await addLogRow(`new-${offset}`, "wird_reminder", shown, shown);
    }
    await rescheduleReminders(store.db, { now: at("2026-11-19", 3), language: "en" });
    expect(backoff()).toMatchObject({ consecutive_ignored: 14, level: 2 });
    await rescheduleReminders(store.db, { now: at("2026-11-20", 3), language: "en" });
    expect(backoff().consecutive_ignored).toBe(14);
  });
});

describe("halaqa encouragement batches (5.8.2)", () => {
  const groupScheduled = () => fake.scheduled.filter((item) => item.data.type === "group_encouragement");
  type StoredBatch = { account_id: string; count: number; log_id: string | null };
  const batches = () => (storedSetting(LOCAL_KEYS.groupPending) as { batches: StoredBatch[] } | null)?.batches ?? [];
  const scheduledBatchOwner = () =>
    groupScheduled().map((item) => batches().find((batch) => batch.log_id === item.data.logId)?.account_id ?? null);

  it("schedules only the signed-in account's batch, and records nothing once its account changed", async () => {
    await seed([...lastDays(5), TODAY]);
    expect(await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10) })).toBe(true);
    expect(groupScheduled()).toHaveLength(1);

    // B signs in: A's notification leaves the OS, and A's later arrival is not recorded.
    signedInAccount = ACCOUNT_B;
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 5), language: "en" });
    expect(groupScheduled()).toHaveLength(0);
    expect(await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10, 6) })).toBe(false);
    expect(batches()).toEqual([expect.objectContaining({ account_id: ACCOUNT_A, count: 1 })]);

    // B signs in while A's arrival is being recorded: the check after the read stops it.
    signedInAccount = ACCOUNT_A;
    let checks = 0;
    const switching = { userId: ACCOUNT_A, isCurrent: () => checks++ === 0 };
    expect(await notifyGroupEncouragement(store.db, { account: switching, now: at(TODAY, 10, 7), count: 3 })).toBe(false);
    expect(batches()).toEqual([expect.objectContaining({ account_id: ACCOUNT_A, count: 1 })]);

    // B's own arrival is B's batch alone.
    signedInAccount = ACCOUNT_B;
    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_B), now: at(TODAY, 10, 8), count: 2 });
    expect(batches().map((batch) => [batch.account_id, batch.count])).toEqual([
      [ACCOUNT_A, 1],
      [ACCOUNT_B, 2],
    ]);
    expect(scheduledBatchOwner()).toEqual([ACCOUNT_B]);

    // Back to A: A's batch is scheduled again and B's leaves the OS.
    signedInAccount = ACCOUNT_A;
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 9), language: "en" });
    expect(scheduledBatchOwner()).toEqual([ACCOUNT_A]);
  });

  it.each([
    ["the account signs out", null],
    ["another account signs in", ACCOUNT_B],
  ])("removes a shown encouragement from the tray once %s", async (_label, next) => {
    await seed([...lastDays(5), TODAY]);
    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10) });
    const own = groupScheduled()[0];
    expect(own.data.accountId).toBe(ACCOUNT_A);
    // The OS shows it at 10:30, next to one from an older build that names no account.
    osFires(at(TODAY, 10, 30));
    const { accountId: _owner, ...unowned } = own.data;
    fake.presented = [
      { osId: own.osId, data: own.data },
      { osId: "unowned", data: { ...unowned, logId: "unowned-log" } },
    ];
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 35), language: "en" });
    expect(fake.dismissed).toEqual(["unowned"]);

    signedInAccount = next;
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 40), language: "en" });
    expect(fake.dismissed).toEqual(["unowned", own.osId]);
  });

  it("removes another account's shown encouragement even with reminders turned off", async () => {
    await seed([...lastDays(5), TODAY]);
    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10) });
    const own = groupScheduled()[0];
    osFires(at(TODAY, 10, 30));
    fake.presented = [{ osId: own.osId, data: own.data }];
    await writeReminderPref(store.db, { kind: "enabled", value: false });
    signedInAccount = ACCOUNT_B;
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 40), language: "en" });
    expect(fake.dismissed).toEqual([own.osId]);
  });

  // Fourth review, finding 3: the alarm goes off after the run read the tray and before it cancelled the
  // alarm. Cancelling leaves a notification already shown, so A's activity stayed in B's tray.
  it.each([
    ["on", true],
    ["off", false],
  ])("removes another account's encouragement that goes off during the run, with reminders %s", async (_label, enabled) => {
    await seed([...lastDays(5), TODAY]);
    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10) });
    const alarm = groupScheduled()[0];
    expect(alarm.data.accountId).toBe(ACCOUNT_A);
    if (!enabled) await writeReminderPref(store.db, { kind: "enabled", value: false });
    fake.beforeCancel = () => {
      if (!fake.scheduled.some((item) => item.osId === alarm.osId)) return;
      fake.scheduled = fake.scheduled.filter((item) => item.osId !== alarm.osId);
      fake.presented = [...fake.presented, { osId: alarm.osId, data: alarm.data }];
    };

    signedInAccount = ACCOUNT_B;
    const result = await rescheduleReminders(store.db, { now: at(TODAY, 10, 30), language: "en" });
    expect(result.status).toBe(enabled ? "scheduled" : "disabled");
    expect(groupScheduled()).toEqual([]);
    expect(fake.presented.filter((item) => item.data.type === "group_encouragement")).toEqual([]);
    expect(fake.dismissed).toEqual([alarm.osId]);
  });

  it("lets only the signed-in account's encouragement show while the app is open", async () => {
    await seed([...lastDays(5), TODAY]);
    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10) });
    const own = groupScheduled()[0].data;
    const { accountId: _owner, ...unowned } = own;
    const wird = fake.scheduled.find((item) => item.data.type !== "group_encouragement")?.data;
    expect(wird).toBeDefined();

    expect(shouldPresentReminder(own)).toBe(true);
    expect(shouldPresentReminder(unowned)).toBe(false);
    signedInAccount = ACCOUNT_B;
    expect(shouldPresentReminder(own)).toBe(false);
    signedInAccount = null;
    expect(shouldPresentReminder(own)).toBe(false);
    // Other reminders carry no account and show as before.
    expect(shouldPresentReminder(wird!)).toBe(true);
  });

  // Fifth review, finding N5: A's encouragement went off while B was signed in, before the run that
  // cancels it. The handler hid it and the OS let go of the alarm, so the run took it for delivered,
  // retired A's batch, and A never got the encouragement.
  it("gives an encouragement hidden from another account back to its owner, counted once", async () => {
    await seed([...lastDays(5), TODAY]);
    await configureReminderPlatform({ channelName: "Reminders", remindLaterAction: "Remind me in 1 hour" });
    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10) });
    const alarm = groupScheduled()[0];
    expect(batches()).toEqual([expect.objectContaining({ account_id: ACCOUNT_A, log_id: alarm.data.logId })]);

    signedInAccount = ACCOUNT_B;
    firesWhileOpen(alarm);
    expect(fake.presented).toEqual([]);
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 31), language: "en" });
    expect(logRow(alarm.data.logId)).toEqual({ delivered_at: null, cancelled_at: at(TODAY, 10, 31).toISOString() });
    expect(batches()).toEqual([expect.objectContaining({ account_id: ACCOUNT_A, count: 1, log_id: null })]);
    expect(groupScheduled()).toEqual([]);
    expect(fake.presented).toEqual([]);

    // A signs in again: the batch goes out to A, and only that notification counts as delivered.
    signedInAccount = ACCOUNT_A;
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 40), language: "en" });
    const again = groupScheduled();
    expect(again.map((item) => [item.data.accountId, item.data.at])).toEqual([
      [ACCOUNT_A, at(TODAY, 10, 41).getTime()],
    ]);
    firesWhileOpen(again[0]);
    expect(fake.presented.map((item) => item.osId)).toEqual([again[0].osId]);
    await rescheduleReminders(store.db, { now: at(TODAY, 10, 45), language: "en" });
    expect(logCount("type = 'group_encouragement' AND delivered_at IS NOT NULL")).toBe(1);
    expect(logRow(again[0].data.logId)).toEqual({ delivered_at: at(TODAY, 10, 45).toISOString(), cancelled_at: null });
    expect(batches()).toEqual([]);
  });

  it("gives an arrival after a delivered notification its own notification", async () => {
    await seed([...lastDays(5), TODAY]);
    // Leaves room under tomorrow's cap next to the morning wird reminder.
    await writeReminderPref(store.db, { kind: "type", type: "streak_at_risk", value: false });
    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 10) });
    expect(groupScheduled().map((item) => item.data.at)).toEqual([at(TODAY, 10, 30).getTime()]);
    osFires(at(TODAY, 10, 30));

    await notifyGroupEncouragement(store.db, { account: accountOf(ACCOUNT_A), now: at(TODAY, 11) });
    // One a day: the new batch goes out the next morning, and only the delivered batch is retired, so
    // later runs keep it.
    expect(groupScheduled().map((item) => item.data.localDate)).toEqual([addDays(TODAY, 1)]);
    await rescheduleReminders(store.db, { now: at(TODAY, 11, 5), language: "en" });
    expect(groupScheduled().map((item) => item.data.localDate)).toEqual([addDays(TODAY, 1)]);
    expect(batches()).toEqual([expect.objectContaining({ account_id: ACCOUNT_A, count: 1 })]);
  });
});

describe("reconcileReminders", () => {
  const NOW = at(TODAY, 5, 19);
  const scheduledAt = (osId: string, type: "wird_reminder" | "streak_at_risk", time: Date) => ({
    osId,
    data: {
      source: "hafiz-reminder" as const,
      logId: osId,
      type,
      localDate: TODAY,
      route: "wird" as const,
      at: time.getTime(),
      contentKey: `${osId}-old`,
    },
  });
  const desiredAt = (type: "wird_reminder" | "streak_at_risk", time: Date) => ({
    slot: { type, localDate: TODAY, at: time, templateId: `${type}.2`, vars: {}, route: "wird" as const },
    title: "",
    body: "",
    remindLaterAction: false,
    contentKey: `${type}-new`,
  });

  it("keeps a reminder about to fire even when its text or time changed, and replaces later ones", () => {
    const scheduled = [scheduledAt("soon", "wird_reminder", at(TODAY, 5, 20)), scheduledAt("evening", "streak_at_risk", at(TODAY, 21))];
    const result = reconcileReminders(scheduled, [desiredAt("wird_reminder", at(TODAY, 8)), desiredAt("streak_at_risk", at(TODAY, 21))], NOW);
    expect(result.keep.map((item) => item.osId)).toEqual(["soon"]);
    expect(result.cancel.map((item) => item.osId)).toEqual(["evening"]);
    expect(result.create.map((item) => item.slot.type)).toEqual(["streak_at_risk"]);
  });

  it("keeps a late reminder already set when a replan after 23:00 keeps it, and creates none", () => {
    const late = { ...scheduledAt("late", "streak_at_risk", at(TODAY, 23, 15)), data: { ...scheduledAt("late", "streak_at_risk", at(TODAY, 23, 15)).data, type: "late_reminder" as const } };
    const keepOnly = { ...desiredAt("streak_at_risk", at(TODAY, 23, 15)), slot: { ...desiredAt("streak_at_risk", at(TODAY, 23, 15)).slot, type: "late_reminder" as const, existingOnly: true } };
    const kept = reconcileReminders([late], [keepOnly], at(TODAY, 23, 1));
    expect(kept.keep.map((item) => item.osId)).toEqual(["late"]);
    expect(kept.cancel).toEqual([]);
    expect(kept.create).toEqual([]);
    // With nothing set, a keep-only slot schedules nothing.
    expect(reconcileReminders([], [keepOnly], at(TODAY, 23, 1)).create).toEqual([]);
  });

  it("cancels a reminder about to fire that the plan no longer has, and clears one already due", () => {
    const scheduled = [scheduledAt("soon", "wird_reminder", at(TODAY, 5, 20)), scheduledAt("due", "wird_reminder", at(TODAY, 5, 18))];
    const result = reconcileReminders(scheduled, [], NOW);
    expect(result.keep).toEqual([]);
    expect(result.cancel.map((item) => item.osId).sort()).toEqual(["due", "soon"]);
  });
});

describe("reminder routes", () => {
  it("opens the page review for a page or half-page plan and the ayah review otherwise", async () => {
    expect(await resolveReminderHref(store.db, "wird")).toBe("/flashcards/session");
    await writeHifzPlan(store.db, { ...DEFAULT_HIFZ_PLAN, unit: "half" });
    expect(await resolveReminderHref(store.db, "wird")).toBe("/hifz/review");
    await writeHifzPlan(store.db, { ...DEFAULT_HIFZ_PLAN, unit: "ayah" });
    expect(await resolveReminderHref(store.db, "wird")).toBe("/flashcards/session");
    expect(await resolveReminderHref(store.db, "kahf")).toEqual({ pathname: "/open", params: { surah: "18", ayah: "1" } });
  });

  it("pushes the review or al-Kahf and navigates back to Home", async () => {
    await writeHifzPlan(store.db, DEFAULT_HIFZ_PLAN);
    await openReminderRoute(store.db, "wird");
    expect(router.push).toHaveBeenLastCalledWith("/hifz/review");
    await openReminderRoute(store.db, "home");
    expect(router.navigate).toHaveBeenLastCalledWith("/(tabs)/home");
  });
});

describe("permission prompts (ONB-02, ONB-03)", () => {
  async function addSession() {
    const started = at(TODAY, 6).toISOString();
    await store.db.runAsync(
      `INSERT INTO review_sessions (id, kind, deck_id, started_at, ended_at, duration_ms, local_date, tz, cards_reviewed,
        pages_reviewed, new_lines, clean_pages, errors, minimum_met, full_met, source, created_at, updated_at, deleted_at)
       VALUES ('s1', 'cards', NULL, ?, ?, 60000, ?, 'UTC', 3, 0, 0, 0, 0, 0, 0, 'app', ?, ?, NULL)`,
      [started, started, TODAY, started, started],
    );
  }

  it("offers the prompt only after the first session, then waits between prompts", async () => {
    fake.permission = { status: "undetermined", canAskAgain: true };
    fake.requested = { status: "denied", canAskAgain: true };
    expect(await shouldOfferNotificationPrompt(store.db, { now: at(TODAY, 9) })).toBe(false);
    await addSession();
    expect(await shouldOfferNotificationPrompt(store.db, { now: at(TODAY, 9) })).toBe(true);
    expect((await requestNotificationPermission(store.db, { now: at(TODAY, 9) })).status).toBe("denied");
    expect(await readOptInPrompts(store.db)).toEqual({ count: 1, last_shown_at: at(TODAY, 9).toISOString() });
    expect(await shouldOfferNotificationPrompt(store.db, { now: at(addDays(TODAY, 1), 9) })).toBe(false);
    expect(await shouldOfferNotificationPrompt(store.db, { now: at(addDays(TODAY, 2), 9) })).toBe(true);
    await declineNotificationPrompt(store.db, { now: at(addDays(TODAY, 2), 9) });
    expect((await readOptInPrompts(store.db)).count).toBe(2);
  });

  it("never offers when the OS will not ask again, and schedules once granted", async () => {
    await addSession();
    fake.permission = { status: "denied", canAskAgain: false };
    expect(await shouldOfferNotificationPrompt(store.db, { now: at(TODAY, 9) })).toBe(false);
    fake.permission = { status: "undetermined", canAskAgain: true };
    fake.requested = { status: "granted", canAskAgain: true };
    await seed(lastDays(5));
    await requestNotificationPermission(store.db, { now: at(TODAY, 3) });
    expect(fake.scheduled.length).toBeGreaterThan(0);
  });
});

describe("in-app banner (NOT-03)", () => {
  beforeEach(() => {
    fake.supportsScheduling = false;
  });

  it("shows the latest due reminder after the anchor time, until dismissed or done", async () => {
    await seed(lastDays(5));
    expect(await loadReminderBanner(store.db, { now: at(TODAY, 4), language: "en" })).toBeNull();
    const morning = await loadReminderBanner(store.db, { now: at(TODAY, 9), language: "en" });
    expect(morning).toEqual(expect.objectContaining({ kind: "reminder", type: "wird_reminder", route: "wird" }));
    const evening = await loadReminderBanner(store.db, { now: at(TODAY, 21, 30), language: "en" });
    expect(evening).toEqual(expect.objectContaining({ type: "streak_at_risk" }));
    await dismissReminderBanner(store.db, evening!);
    expect(await loadReminderBanner(store.db, { now: at(TODAY, 21, 40), language: "en" })).toBeNull();
    await seed([addDays(TODAY, 0)]);
    expect(await loadReminderBanner(store.db, { now: at(addDays(TODAY, 0), 22), language: "en" })).toBeNull();
  });

  it("does not schedule anything on web", async () => {
    await seed(lastDays(5));
    expect((await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" })).status).toBe("unsupported");
    expect(fake.scheduled).toEqual([]);
    expect(localDateOf(at(TODAY, 3))).toBe(TODAY);
  });
});

describe("diffReminders", () => {
  it("keeps matching reminders, cancels the rest and creates what is missing", () => {
    const data = (key: string) => ({
      source: "hafiz-reminder" as const,
      logId: key,
      type: "wird_reminder" as const,
      localDate: TODAY,
      route: "wird" as const,
      at: 0,
      contentKey: key,
    });
    const scheduled = [{ osId: "1", data: data("a") }, { osId: "2", data: data("b") }];
    const desired = ["a", "c"].map((key) => ({
      slot: { type: "wird_reminder" as const, localDate: TODAY, at: new Date(0), templateId: "wird_reminder.9", vars: {}, route: "wird" as const },
      title: "",
      body: "",
      remindLaterAction: false,
      contentKey: key,
    }));
    const result = diffReminders(scheduled, desired);
    expect(result.keep.map((item) => item.osId)).toEqual(["1"]);
    expect(result.cancel.map((item) => item.osId)).toEqual(["2"]);
    expect(result.create.map((item) => item.contentKey)).toEqual(["c"]);
  });
});

describe("a day already done under another headline (NOT-04, STR-07)", () => {
  it("clears today's tray and badge after today's wird is done during an earn-back", async () => {
    // Ten excused days three days back leave a broken streak to earn back.
    for (let offset = -3; offset > -13; offset--) {
      await putHabitDay(store.db, {
        ...day(addDays(TODAY, offset)),
        status: "excused",
        earned_status: null,
        reason: "illness",
        minimum_met: 0,
      });
    }
    await writeReminderPref(store.db, { kind: "badge", value: true });
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const alarm = fake.scheduled.find((item) => item.data.type === "earnback_open" && item.data.localDate === TODAY)!;
    expect(alarm).toBeTruthy();
    osFires(at(TODAY, 7));
    fake.presented = [{ osId: alarm.osId, data: alarm.data }];
    await seed([TODAY]);
    const context = await loadReminderContext(store.db, { now: at(TODAY, 7), language: "en" });
    const snapshot = projectHabit(context.input, TODAY, at(TODAY, 7)).snapshot;
    expect(snapshot.streak.todayStatus).toBe("done");
    expect(snapshot.headline.kind).toBe("earn_back");

    await rescheduleReminders(store.db, { now: at(TODAY, 7), language: "en" });

    expect({ presented: fake.presented.length, badge: fake.badge }).toEqual({ presented: 0, badge: 0 });
  });

  it("clears the badge and today's reminder but keeps yesterday's open make-up reminder", async () => {
    await seed(lastDays(5, -2));
    await writeReminderPref(store.db, { kind: "badge", value: true });
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const makeUp = fake.scheduled.find((item) => item.data.type === "makeup_window" && item.data.localDate === TODAY)!;
    expect(makeUp).toBeTruthy();
    const wird: PresentedReminder = {
      osId: "synthetic-wird",
      data: { ...makeUp.data, logId: "synthetic-wird-log", type: "wird_reminder", route: "wird" },
    };
    fake.scheduled = fake.scheduled.filter((item) => item.osId !== makeUp.osId);
    fake.presented = [{ osId: makeUp.osId, data: makeUp.data }, wird];
    await seed([TODAY]);
    const context = await loadReminderContext(store.db, { now: at(TODAY, 9), language: "en" });
    const snapshot = projectHabit(context.input, TODAY, at(TODAY, 9)).snapshot;
    expect(snapshot.streak.todayStatus).toBe("done");
    expect(snapshot.headline.kind).toBe("make_up_open");

    await rescheduleReminders(store.db, { now: at(TODAY, 9), language: "en" });

    expect(fake.badge).toBe(0);
    expect(fake.presented.map((item) => item.data.type)).toEqual(["makeup_window"]);
  });
});

describe("hifz cards in the surah named by reminder copy (NOT-14)", () => {
  it("names the overdue ayah card's surah even when hundreds of old chunk and page cards are due first", async () => {
    store.sql
      .prepare("INSERT OR REPLACE INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES (2, 'سورة البقرة', 'The Cow', 286, 'Medinan')")
      .run();
    const insert = store.sql.prepare(
      `INSERT INTO study_cards (id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
        last_review, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 1, 5, 0, 0, 0, 1, 0, 1, NULL, ?, ?, NULL)`,
    );
    const old = "2026-01-01T00:00:00.000Z";
    for (let line = 1; line <= 320; line++) insert.run(`chunk:madani15:${line}:1-4`, "hifz-sabaq", old, old, old);
    insert.run("2:255", "smart-retention", at(addDays(TODAY, -1), 8).toISOString(), old, old);

    const context = await loadReminderContext(store.db, { now: at(TODAY, 3), language: "en" });

    expect(context.input.facts(TODAY)).toEqual({ surah: 2 });
  });
});

describe("a remind-later request during a reschedule (NOT-05b)", () => {
  it("keeps today's follow-up when a run that read yesterday's spent one finishes after the request", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    const original = fake.scheduled.find((item) => item.data.type === "wird_reminder" && item.data.localDate === TODAY)!;
    const yesterday = addDays(TODAY, -1);
    await putUserSetting(
      store.db,
      LOCAL_KEYS.remindLater,
      JSON.stringify({ at: at(yesterday, 20).toISOString(), local_date: yesterday, fingerprint: "synthetic-old" }),
    );
    // A foreground run reads that spent follow-up, then waits on the OS.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => (reached = resolve));
    jest.spyOn(reminderPlatform, "getPermission").mockImplementationOnce(async () => {
      reached();
      await gate;
      return fake.permission;
    });
    const run = rescheduleReminders(store.db, { now: at(TODAY, 5, 30), language: "en" });
    await paused;

    const request = requestRemindLater(store.db, { data: original.data, action: "remind_later" }, { now: at(TODAY, 5, 30) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await run;

    expect(await request).toBe(true);
    expect(fake.scheduled.find((item) => item.data.type === "remind_later")?.data.at).toBe(at(TODAY, 6, 30).getTime());
  });
});

describe("yesterday's notification with reminders off (NOT-06)", () => {
  it.each(["disabled", "denied"] as const)("leaves the tray when reminders are %s", async (state) => {
    await seed(lastDays(5, -2));
    const yesterday = addDays(TODAY, -1);
    fake.presented = [
      {
        osId: "synthetic-yesterday",
        data: {
          source: "hafiz-reminder",
          logId: "synthetic-yesterday-log",
          type: "wird_reminder",
          localDate: yesterday,
          route: "wird",
          at: at(yesterday, 9).getTime(),
          contentKey: "synthetic",
        },
      },
    ];
    if (state === "disabled") await writeReminderPref(store.db, { kind: "enabled", value: false });
    else fake.permission = { status: "denied", canAskAgain: false };

    await rescheduleReminders(store.db, { now: at(TODAY, 7), language: "en" });

    expect(fake.presented).toEqual([]);
  });
});
