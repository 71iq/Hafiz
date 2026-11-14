import * as fc from "fast-check";
import { notificationsStrings } from "@/lib/i18n/features/notifications";
import { advanceIgnoredTally, findConversions, isFired } from "@/lib/notifications/log";
import { canAskNotificationPermission } from "@/lib/notifications/permission";
import {
  chooseTemplate,
  NOTIFICATION_TEMPLATES,
  renderNotification,
  templateById,
  type TemplateUse,
} from "@/lib/notifications/templates";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";
import { parseReminderPrefs, typePrefKey } from "@/lib/notifications/settings";
import { isSyncableUserSetting } from "@/lib/database/user-settings";

jest.mock("@/lib/notifications/platform", () => ({
  reminderPlatform: { supportsScheduling: false },
}));

const DAY = 86_400_000;
const NOW = new Date("2026-11-12T09:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe("permission re-ask (8.10, ONB-03)", () => {
  it("asks first at once, then after 2, 7 and 14 days, and never after 4 prompts", () => {
    expect(canAskNotificationPermission(0, null, NOW)).toBe(true);
    expect(canAskNotificationPermission(1, daysAgo(1.9), NOW)).toBe(false);
    expect(canAskNotificationPermission(1, daysAgo(2), NOW)).toBe(true);
    expect(canAskNotificationPermission(2, daysAgo(6.9), NOW)).toBe(false);
    expect(canAskNotificationPermission(2, daysAgo(7), NOW)).toBe(true);
    expect(canAskNotificationPermission(3, daysAgo(13.9), NOW)).toBe(false);
    expect(canAskNotificationPermission(3, daysAgo(14), NOW)).toBe(true);
    expect(canAskNotificationPermission(4, daysAgo(400), NOW)).toBe(false);
  });

  it("allows at most 4 prompts however the user answers", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 20 }), (gaps) => {
        let count = 0;
        let last: Date | null = null;
        let now = NOW.getTime();
        for (const gap of gaps) {
          now += gap * DAY;
          if (canAskNotificationPermission(count, last, new Date(now))) {
            count += 1;
            last = new Date(now);
          }
        }
        expect(count).toBeLessThanOrEqual(4);
      }),
    );
  });
});

describe("back-off counting (8.11, NOT-09)", () => {
  let nextId = 0;
  const row = (type: string, at: Date, cancelled = false) => ({
    id: `row-${String(nextId++).padStart(3, "0")}`,
    type,
    scheduled_for: at.toISOString(),
    cancelled_at: cancelled ? at.toISOString() : null,
  });
  const tally = (rows: Parameters<typeof advanceIgnoredTally>[1], session: string | null = null) =>
    advanceIgnoredTally(null, rows, session, NOW).count;

  it("counts delivered reminders since the last session once their 2-hour window has passed", () => {
    const rows = [
      row("wird_reminder", daysAgo(3)),
      row("streak_at_risk", daysAgo(2.5)),
      row("wird_reminder", daysAgo(2)),
      row("wird_reminder", daysAgo(1)),
      row("friday_kahf", daysAgo(1)),
      row("streak_at_risk", daysAgo(0.5), true),
      row("wird_reminder", new Date(NOW.getTime() - 60 * 60 * 1000)),
    ];
    expect(tally(rows)).toBe(4);
    expect(tally(rows, daysAgo(2.2).toISOString())).toBe(2);
    expect(tally(rows, NOW.toISOString())).toBe(0);
  });

  it("never counts a cancelled reminder as delivered, unless the OS had already shown it", () => {
    const due = daysAgo(1).toISOString();
    expect(isFired({ scheduled_for: due, cancelled_at: null }, NOW)).toBe(true);
    expect(isFired({ scheduled_for: due, cancelled_at: due, delivered_at: null }, NOW)).toBe(false);
    expect(isFired({ scheduled_for: due, cancelled_at: due, delivered_at: due }, NOW)).toBe(true);
    expect(isFired({ scheduled_for: new Date(NOW.getTime() + 60_000).toISOString(), cancelled_at: null }, NOW)).toBe(false);
    const rows = [
      { id: "a", type: "wird_reminder", scheduled_for: due, cancelled_at: due, delivered_at: null },
      { id: "b", type: "wird_reminder", scheduled_for: daysAgo(2).toISOString(), cancelled_at: null, delivered_at: null },
    ];
    expect(tally(rows)).toBe(1);
  });

  it("treats a reminder the OS still holds after its time as late, not delivered", () => {
    const late = { id: "late", scheduled_for: daysAgo(0.2).toISOString(), cancelled_at: null, delivered_at: null };
    expect(isFired(late, NOW, new Set(["late"]))).toBe(false);
    expect(isFired(late, NOW, new Set())).toBe(true);
    expect(isFired({ ...late, delivered_at: NOW.toISOString() }, NOW, new Set(["late"]))).toBe(true);
    // The tally waits for it rather than skipping past it.
    const rows = [{ ...late, type: "wird_reminder" }, row("wird_reminder", daysAgo(0.15))];
    const waiting = advanceIgnoredTally(null, rows, null, NOW, new Set(["late"]));
    expect(waiting).toEqual({ count: 0, since: null, cursor: null });
    expect(advanceIgnoredTally(waiting, rows, null, NOW, new Set()).count).toBe(2);
  });

  it("keeps a running total, so pruning old rows never lowers it and no row counts twice", () => {
    const old = Array.from({ length: 7 }, (_, index) => row("wird_reminder", daysAgo(100 - index)));
    const first = advanceIgnoredTally(null, old, null, NOW);
    expect(first.count).toBe(7);
    expect(advanceIgnoredTally(first, old, null, NOW)).toEqual(first);
    // The seven old rows are pruned and seven new ones are ignored.
    const fresh = Array.from({ length: 7 }, (_, index) => row("wird_reminder", daysAgo(10 - index)));
    expect(advanceIgnoredTally(first, fresh, null, NOW).count).toBe(14);
    // A new session starts over.
    expect(advanceIgnoredTally(first, fresh, daysAgo(6.5).toISOString(), NOW).count).toBe(3);
  });

  it("opens the response window at a delayed delivery, and keeps later rows behind it", () => {
    const at = (time: string) => new Date(`2026-11-12T${time}:00.000Z`);
    // Scheduled for 05:20, shown at 10:00; the 06:00 reminder showed on time.
    const delayed = { id: "delayed", type: "wird_reminder", scheduled_for: at("05:20").toISOString(), cancelled_at: null, delivered_at: at("10:00").toISOString(), converted: 0 };
    const onTime = { id: "on-time", type: "wird_reminder", scheduled_for: at("06:00").toISOString(), cancelled_at: null, delivered_at: at("06:00").toISOString(), converted: 0 };
    const waiting = advanceIgnoredTally(null, [delayed, onTime], null, at("10:01"));
    expect(waiting).toEqual({ count: 0, since: null, cursor: null });
    expect(advanceIgnoredTally(waiting, [delayed, onTime], null, at("11:59")).count).toBe(0);
    expect(advanceIgnoredTally(waiting, [delayed, onTime], null, at("12:00")).count).toBe(2);
    // A session at 10:10 answers the delayed reminder; one at 12:05 is too late.
    expect(findConversions([delayed], [at("10:10").toISOString()], at("10:15"))).toEqual(["delayed"]);
    expect(findConversions([delayed], [at("12:05").toISOString()], at("12:10"))).toEqual([]);
  });

  it("marks a reminder converted when a session starts within 2 hours", () => {
    const rows = [
      { id: "a", scheduled_for: daysAgo(1).toISOString(), cancelled_at: null, converted: 0 },
      { id: "b", scheduled_for: daysAgo(2).toISOString(), cancelled_at: null, converted: 0 },
      { id: "c", scheduled_for: daysAgo(3).toISOString(), cancelled_at: null, converted: 1 },
    ];
    const sessions = [new Date(daysAgo(1).getTime() + 90 * 60 * 1000).toISOString(), new Date(daysAgo(2).getTime() + 3 * 60 * 60 * 1000).toISOString()];
    expect(findConversions(rows, sessions, NOW)).toEqual(["a"]);
  });
});

describe("templates (9.2, NOT-12, NOT-14)", () => {
  const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
  const FLAGS = new Set(["onePage", "fiveMinutes", "ramadan"]);

  it("has at least 8 templates per type, in both languages, with matching placeholders", () => {
    for (const type of NOTIFICATION_TYPES) {
      const templates = NOTIFICATION_TEMPLATES.filter((template) => template.type === type);
      expect(templates.length).toBeGreaterThanOrEqual(8);
      for (const template of templates) {
        const en = notificationsStrings.en[template.key];
        const ar = notificationsStrings.ar[template.key];
        expect(en.trim().length).toBeGreaterThan(0);
        expect(ar.trim().length).toBeGreaterThan(0);
        expect(placeholders(ar)).toEqual(placeholders(en));
        expect(placeholders(en)).toEqual(template.needs.filter((name) => !FLAGS.has(name)).sort());
      }
    }
  });

  it("keeps template ids unique", () => {
    const ids = NOTIFICATION_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never cites the da'if narrations or claims rewards as counts", () => {
    for (const language of ["en", "ar"] as const) {
      for (const template of NOTIFICATION_TEMPLATES) {
        const text = notificationsStrings[language][template.key];
        expect(text).not.toMatch(/Abu Dawud 461|Tirmidhi 2916|Abu Dawud 1474|hasanat|حسنات/i);
      }
    }
  });

  it("picks among templates not used for 15 days, then the least recently used", () => {
    const at = NOW;
    const kahf = NOTIFICATION_TEMPLATES.filter((template) => template.type === "friday_kahf");
    const recent: TemplateUse[] = kahf.slice(1).map((template, index) => ({ templateId: template.id, at: daysAgo(index + 1) }));
    expect(chooseTemplate({ type: "friday_kahf", at, vars: {}, history: recent, random: () => 0.99 })?.id).toBe(kahf[0].id);

    const allRecent: TemplateUse[] = kahf.map((template, index) => ({ templateId: template.id, at: daysAgo(index + 1) }));
    expect(chooseTemplate({ type: "friday_kahf", at, vars: {}, history: allRecent, random: () => 0 })?.id).toBe(kahf[kahf.length - 1].id);
  });

  it("never repeats a template within 15 days while a fresh one is eligible", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 0.999999, noNaN: true }), { minLength: 1, maxLength: 30 }), (rolls) => {
        const history: TemplateUse[] = [];
        rolls.forEach((roll, index) => {
          const at = new Date(NOW.getTime() + index * DAY);
          const chosen = chooseTemplate({ type: "comeback", at, vars: {}, history, random: () => roll })!;
          const fresh = NOTIFICATION_TEMPLATES.filter(
            (template) =>
              template.type === "comeback" &&
              !template.needs.length &&
              !history.some((use) => use.templateId === template.id && at.getTime() - use.at.getTime() < 15 * DAY),
          );
          const freshAllowed = fresh.filter((template) => !template.citation || !history.some((use) => templateById(use.templateId)?.citation && at.getTime() - use.at.getTime() < 7 * DAY));
          if (freshAllowed.length > 0) expect(freshAllowed.map((template) => template.id)).toContain(chosen.id);
          history.push({ templateId: chosen.id, at });
        });
      }),
    );
  });

  it("uses at most one hadith or ayah template in any 7 days", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 0.999999, noNaN: true }), { minLength: 1, maxLength: 40 }), (rolls) => {
        const history: TemplateUse[] = [];
        rolls.forEach((roll, index) => {
          const at = new Date(NOW.getTime() + index * 12 * 60 * 60 * 1000);
          const type = index % 2 === 0 ? "wird_reminder" : "comeback";
          const chosen = chooseTemplate({ type, at, vars: { onePage: 1 }, history, random: () => roll })!;
          history.push({ templateId: chosen.id, at });
        });
        const citations = history.filter((use) => templateById(use.templateId)?.citation);
        for (let i = 1; i < citations.length; i += 1) {
          expect(citations[i].at.getTime() - citations[i - 1].at.getTime()).toBeGreaterThanOrEqual(7 * DAY);
        }
      }),
    );
  });

  it("only picks templates whose values are known, and the Ramadan one for the Ramadan invitation", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.999999, noNaN: true }), (roll) => {
        const chosen = chooseTemplate({ type: "wird_reminder", at: NOW, vars: {}, history: [], random: () => roll })!;
        expect(chosen.needs).toEqual([]);
      }),
    );
    expect(chooseTemplate({ type: "comeback", at: NOW, vars: { ramadan: 1 }, history: [], random: () => 0.5 })?.id).toBe("comeback.11");
    expect(chooseTemplate({ type: "wird_reminder", at: NOW, vars: { surah: 67 }, history: [], random: () => 0, preferredId: "wird_reminder.2" })?.id).toBe("wird_reminder.2");
  });

  it("renders Arabic with Arabic digits, prayer names and surah names", () => {
    const surahNames = (surah: number, language: "en" | "ar") => (surah === 67 ? (language === "ar" ? "سورة الملك" : "Surah Al-Mulk") : null);
    const slot = { type: "makeup_window" as const, templateId: "makeup_window.3", vars: { n: 12, cutoff: "dhuhr" } };
    expect(renderNotification(slot, "ar", surahNames)).toEqual({
      title: "وِرد الأمس",
      body: "صفحة واحدة قبل الظهر تحفظ سلسلتك. أيامها: ١٢.",
    });
    expect(renderNotification(slot, "en", surahNames).body).toBe("One page before Dhuhr keeps your 12-day streak.");
    expect(renderNotification({ type: "wird_reminder", templateId: "wird_reminder.2", vars: { surah: 67 } }, "en", surahNames).body).toBe(
      "Surah Al-Mulk is due for review today.",
    );
    expect(renderNotification({ type: "late_reminder", templateId: "late_reminder.8", vars: { cutoff: "12:30" } }, "ar", surahNames).body).toContain("١٢:٣٠");
  });
});

describe("reminder settings keys (7.6)", () => {
  it("syncs notif_pref_ keys and keeps location, prompts and back-off on the device", () => {
    expect(isSyncableUserSetting(typePrefKey("wird_reminder"))).toBe(true);
    expect(isSyncableUserSetting("notif_pref_anchor")).toBe(true);
    for (const key of ["notif_prayer_location", "notif_optin_prompts", "notif_backoff", "notif_remind_later", "notif_group_pending"]) {
      expect(isSyncableUserSetting(key)).toBe(false);
    }
  });

  it("parses preferences with spec defaults and ignores invalid values", () => {
    const prefs = parseReminderPrefs(
      new Map([
        ["notif_pref_late_reminder", "on"],
        ["notif_pref_wird_reminder", "off"],
        ["notif_pref_anchor", JSON.stringify({ kind: "prayer", prayer: "isha", offsetMinutes: 500 })],
        ["notif_pref_ramadan_anchor", "before_suhoor"],
      ]),
    );
    expect(prefs.types.late_reminder).toBe(true);
    expect(prefs.types.wird_reminder).toBe(false);
    expect(prefs.types.streak_at_risk).toBe(true);
    expect(prefs.types.friday_kahf).toBe(false);
    expect(prefs.anchor).toEqual({ kind: "prayer", prayer: "fajr", offsetMinutes: 20 });
    expect(prefs.ramadanAnchor).toBe("before_suhoor");
    expect(prefs.enabled).toBe(true);
  });
});
