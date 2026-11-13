import { addDays, atLocalTime, localDateOf } from "@/lib/habit/dates";
import { putHabitDay } from "@/lib/habit/queries";
import type { HabitDayRow } from "@/lib/habit/types";
import { dismissReminderBanner, loadReminderBanner } from "@/lib/notifications/banner";
import type {
  PermissionState,
  PresentedReminder,
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
import {
  diffReminders,
  notifyGroupEncouragement,
  requestRemindLater,
  rescheduleReminders,
} from "@/lib/notifications/schedule";
import { LOCAL_KEYS, writeReminderPref } from "@/lib/notifications/settings";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

type FakePlatform = {
  supportsScheduling: boolean;
  permission: PermissionState;
  requested: PermissionState;
  scheduled: (ScheduledReminder & { request: ReminderRequest })[];
  presented: PresentedReminder[];
  dismissed: string[];
  badge: number | null;
  nextId: number;
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
    configure: async () => {},
    listScheduled: async () => fake.scheduled.map(({ osId, data }) => ({ osId, data })),
    listPresented: async () => fake.presented,
    schedule: async (request: ReminderRequest) => {
      const osId = `os-${fake.nextId++}`;
      fake.scheduled.push({ osId, data: request.data, request });
      return osId;
    },
    cancel: async (ids: readonly string[]) => {
      fake.scheduled = fake.scheduled.filter((item) => !ids.includes(item.osId));
    },
    dismiss: async (ids: readonly string[]) => {
      fake.dismissed.push(...ids);
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

function scheduledTypes() {
  return fake.scheduled
    .map((item) => `${item.data.localDate} ${item.data.type}`)
    .sort();
}

function logCount(where = "1 = 1") {
  return Number(store.sql.prepare(`SELECT COUNT(*) AS count FROM notification_log WHERE ${where}`).get()?.count);
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  Object.assign(fake, {
    supportsScheduling: true,
    permission: { status: "granted", canAskAgain: true },
    requested: { status: "granted", canAskAgain: true },
    scheduled: [],
    presented: [],
    dismissed: [],
    badge: null,
    nextId: 1,
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
    expect(new Set(fake.scheduled.map((item) => item.data.localDate)).size).toBe(7);
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

  it("cancels today's wird reminders once the day is done and tidies the tray (NOT-05)", async () => {
    await seed(lastDays(5));
    await rescheduleReminders(store.db, { now: at(TODAY, 3), language: "en" });
    fake.presented = [
      { osId: "shown-today", data: { ...fake.scheduled[0].data, localDate: TODAY, type: "wird_reminder" } },
      { osId: "shown-yesterday", data: { ...fake.scheduled[0].data, localDate: addDays(TODAY, -1), type: "wird_reminder" } },
    ];
    await seed([TODAY]);
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
    const response: ReminderResponse = { data: original.data, action: "remind_later" };
    expect(await requestRemindLater(store.db, response, { now: at(TODAY, 5, 30) })).toBe(true);
    const followUp = fake.scheduled.find((item) => item.data.type === "remind_later");
    expect(followUp?.data.at).toBe(at(TODAY, 6, 30).getTime());

    await seed([TODAY]);
    await rescheduleReminders(store.db, { now: at(TODAY, 6), language: "en" });
    expect(fake.scheduled.some((item) => item.data.type === "remind_later")).toBe(false);
    const pending = store.sql.prepare("SELECT COUNT(*) AS count FROM user_settings WHERE key = ?").get(LOCAL_KEYS.remindLater);
    expect(Number(pending?.count)).toBe(0);
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
    await notifyGroupEncouragement(store.db, { now: at(TODAY, 10) });
    await notifyGroupEncouragement(store.db, { now: at(TODAY, 10, 5) });
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
    await rescheduleReminders(store.db, { now: at(TODAY, 9), language: "en" });
    expect(logCount("converted = 1 AND type = 'wird_reminder'")).toBe(1);
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
