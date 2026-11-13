import { toArabicNumber } from "@/lib/arabic";
import { notificationsStrings, type NotificationStringKey } from "@/lib/i18n/features/notifications";
import { interpolate } from "@/lib/i18n/useStrings";
import type { PrayerName } from "@/lib/prayer/times";
import type { NotificationType, PlannedSlot } from "@/lib/notifications/types";

/**
 * Values a template can need. A template is eligible only when every value it needs is known, so
 * copy never mentions a surah, page count or prayer it cannot fill in.
 * - n: the streak length; next: the day the wird would complete; g: grace days left.
 * - onePage, fiveMinutes: the user's minimum wird is at most one page, or at most five minutes, so
 *   "one page is enough" stays true when the user raised their minimum.
 * - ramadan: only for the Ramadan invitation.
 */
export type TemplateVar =
  | "n"
  | "next"
  | "g"
  | "surah"
  | "prayer"
  | "cutoff"
  | "count"
  | "pages"
  | "minutes"
  | "range"
  | "manzil"
  | "onePage"
  | "fiveMinutes"
  | "ramadan";

export type NotificationTemplate = Readonly<{
  id: string;
  type: NotificationType;
  key: NotificationStringKey;
  needs: readonly TemplateVar[];
  /** Quotes a hadith or ayah from spec 9.3. At most one a week across all reminders (NOT-14). */
  citation: boolean;
}>;

function t(
  type: NotificationType,
  index: number,
  key: NotificationStringKey,
  needs: readonly TemplateVar[] = [],
  citation = false,
): NotificationTemplate {
  return { id: `${type}.${index}`, type, key, needs, citation };
}

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplate[] = [
  t("wird_reminder", 1, "notifTWird1", ["pages", "minutes"]),
  t("wird_reminder", 2, "notifTWird2", ["surah"]),
  t("wird_reminder", 3, "notifTWird3", ["prayer"]),
  t("wird_reminder", 4, "notifTWird4", ["n", "onePage"]),
  t("wird_reminder", 5, "notifTWird5", ["range"]),
  t("wird_reminder", 6, "notifTWird6", [], true),
  t("wird_reminder", 7, "notifTWird7", ["manzil"]),
  t("wird_reminder", 8, "notifTWird8", [], true),
  t("wird_reminder", 9, "notifTWird9"),
  t("wird_reminder", 10, "notifTWird10", ["surah", "fiveMinutes"]),
  t("wird_reminder", 11, "notifTWird11", ["fiveMinutes"]),
  t("wird_reminder", 12, "notifTWird12"),
  t("wird_reminder", 13, "notifTWird13", [], true),

  t("streak_at_risk", 1, "notifTRisk1", ["n"]),
  t("streak_at_risk", 2, "notifTRisk2", ["onePage"]),
  t("streak_at_risk", 3, "notifTRisk3", ["fiveMinutes"]),
  t("streak_at_risk", 4, "notifTRisk4", ["surah"]),
  t("streak_at_risk", 5, "notifTRisk5", ["n", "onePage"]),
  t("streak_at_risk", 6, "notifTRisk6"),
  t("streak_at_risk", 7, "notifTRisk7", ["onePage"]),
  t("streak_at_risk", 8, "notifTRisk8", ["pages", "onePage"]),
  t("streak_at_risk", 9, "notifTRisk9", ["onePage"]),
  t("streak_at_risk", 10, "notifTRisk10", ["onePage"], true),
  t("streak_at_risk", 11, "notifTRisk11", ["next"]),
  t("streak_at_risk", 12, "notifTRisk12"),

  t("remind_later", 1, "notifTLater1"),
  t("remind_later", 2, "notifTLater2"),
  t("remind_later", 3, "notifTLater3", ["surah"]),
  t("remind_later", 4, "notifTLater4"),
  t("remind_later", 5, "notifTLater5"),
  t("remind_later", 6, "notifTLater6", ["next"]),
  t("remind_later", 7, "notifTLater7"),
  t("remind_later", 8, "notifTLater8"),

  t("late_reminder", 1, "notifTLate1", ["n", "onePage"]),
  t("late_reminder", 2, "notifTLate2", ["onePage"]),
  t("late_reminder", 3, "notifTLate3", ["onePage"]),
  t("late_reminder", 4, "notifTLate4"),
  t("late_reminder", 5, "notifTLate5", ["surah"]),
  t("late_reminder", 6, "notifTLate6"),
  t("late_reminder", 7, "notifTLate7", ["onePage"]),
  t("late_reminder", 8, "notifTLate8", ["cutoff"]),

  t("makeup_window", 1, "notifTMakeUp1", ["cutoff"]),
  t("makeup_window", 2, "notifTMakeUp2", ["cutoff"]),
  t("makeup_window", 3, "notifTMakeUp3", ["n", "cutoff", "onePage"]),
  t("makeup_window", 4, "notifTMakeUp4", ["cutoff"], true),
  t("makeup_window", 5, "notifTMakeUp5", ["surah", "cutoff"]),
  t("makeup_window", 6, "notifTMakeUp6", ["cutoff"]),
  t("makeup_window", 7, "notifTMakeUp7"),
  t("makeup_window", 8, "notifTMakeUp8", ["cutoff"]),
  t("makeup_window", 9, "notifTMakeUp9"),

  t("grace_used", 1, "notifTGrace1", ["n", "g"]),
  t("grace_used", 2, "notifTGrace2"),
  t("grace_used", 3, "notifTGrace3", ["g"]),
  t("grace_used", 4, "notifTGrace4", ["n"]),
  t("grace_used", 5, "notifTGrace5"),
  t("grace_used", 6, "notifTGrace6"),
  t("grace_used", 7, "notifTGrace7", ["surah"]),
  t("grace_used", 8, "notifTGrace8"),

  t("earnback_open", 1, "notifTEarn1", ["n"]),
  t("earnback_open", 2, "notifTEarn2"),
  t("earnback_open", 3, "notifTEarn3", ["n"]),
  t("earnback_open", 4, "notifTEarn4"),
  t("earnback_open", 5, "notifTEarn5"),
  t("earnback_open", 6, "notifTEarn6", ["surah"]),
  t("earnback_open", 7, "notifTEarn7"),
  t("earnback_open", 8, "notifTEarn8", [], true),

  t("friday_kahf", 1, "notifTKahf1"),
  t("friday_kahf", 2, "notifTKahf2"),
  t("friday_kahf", 3, "notifTKahf3"),
  t("friday_kahf", 4, "notifTKahf4"),
  t("friday_kahf", 5, "notifTKahf5"),
  t("friday_kahf", 6, "notifTKahf6"),
  t("friday_kahf", 7, "notifTKahf7"),
  t("friday_kahf", 8, "notifTKahf8"),

  t("group_encouragement", 1, "notifTGroup1"),
  t("group_encouragement", 2, "notifTGroup2", ["count"]),
  t("group_encouragement", 3, "notifTGroup3"),
  t("group_encouragement", 4, "notifTGroup4"),
  t("group_encouragement", 5, "notifTGroup5"),
  t("group_encouragement", 6, "notifTGroup6"),
  t("group_encouragement", 7, "notifTGroup7"),
  t("group_encouragement", 8, "notifTGroup8"),

  t("comeback", 1, "notifTBack1"),
  t("comeback", 2, "notifTBack2", ["surah"]),
  t("comeback", 3, "notifTBack3"),
  t("comeback", 4, "notifTBack4"),
  t("comeback", 5, "notifTBack5"),
  t("comeback", 6, "notifTBack6", [], true),
  t("comeback", 7, "notifTBack7"),
  t("comeback", 8, "notifTBack8"),
  t("comeback", 9, "notifTBack9", [], true),
  t("comeback", 10, "notifTBack10"),
  t("comeback", 11, "notifTBack11", ["ramadan"]),
];

const BY_ID = new Map(NOTIFICATION_TEMPLATES.map((template) => [template.id, template]));

export function templateById(id: string): NotificationTemplate | undefined {
  return BY_ID.get(id);
}

const TITLE_KEYS: Readonly<Record<NotificationType, NotificationStringKey>> = {
  wird_reminder: "notifTitleWird",
  streak_at_risk: "notifTitleStreak",
  remind_later: "notifTitleRemindLater",
  late_reminder: "notifTitleLate",
  makeup_window: "notifTitleMakeUp",
  grace_used: "notifTitleGrace",
  earnback_open: "notifTitleEarnBack",
  friday_kahf: "notifTitleKahf",
  group_encouragement: "notifTitleGroup",
  comeback: "notifTitleComeback",
};

/** NOT-12: a template is not repeated within 15 days for the same type. */
export const NO_REPEAT_DAYS = 15;
/** NOT-14: at most one hadith or ayah template a week. */
const CITATION_GAP_DAYS = 7;
const DAY_MS = 86_400_000;

export type TemplateUse = Readonly<{ templateId: string; at: Date }>;
export type TemplateVars = Readonly<Partial<Record<TemplateVar, string | number>>>;

function hasVars(template: NotificationTemplate, vars: TemplateVars): boolean {
  return template.needs.every((name) => vars[name] !== undefined && vars[name] !== null && vars[name] !== "");
}

function citationAllowed(at: Date, history: readonly TemplateUse[]): boolean {
  return !history.some((use) => {
    if (!templateById(use.templateId)?.citation) return false;
    return Math.abs(at.getTime() - use.at.getTime()) < CITATION_GAP_DAYS * DAY_MS;
  });
}

/**
 * NOT-12: pick at random among eligible templates that were not used for this type in the last 15
 * days, falling back to the least recently used eligible template. A Ramadan slot uses the Ramadan
 * templates only. Returns null only when no template of the type has the values it needs.
 */
export function chooseTemplate(input: {
  type: NotificationType;
  at: Date;
  vars: TemplateVars;
  history: readonly TemplateUse[];
  random: () => number;
  preferredId?: string | null;
}): NotificationTemplate | null {
  const { type, at, vars, history, random } = input;
  const ofType = NOTIFICATION_TEMPLATES.filter((template) => template.type === type);
  const ramadan = vars.ramadan !== undefined;
  let eligible = ofType.filter((template) => hasVars(template, vars) && (!ramadan || template.needs.includes("ramadan")));
  if (eligible.length === 0) eligible = ofType.filter((template) => hasVars(template, vars));
  if (!citationAllowed(at, history)) eligible = eligible.filter((template) => !template.citation);
  if (eligible.length === 0) return null;

  const preferred = input.preferredId ? eligible.find((template) => template.id === input.preferredId) : undefined;
  if (preferred) return preferred;

  const lastUse = new Map<string, number>();
  for (const use of history) {
    const time = use.at.getTime();
    if (time > at.getTime()) continue;
    lastUse.set(use.templateId, Math.max(lastUse.get(use.templateId) ?? -Infinity, time));
  }
  const fresh = eligible.filter((template) => {
    const last = lastUse.get(template.id);
    return last === undefined || at.getTime() - last >= NO_REPEAT_DAYS * DAY_MS;
  });
  if (fresh.length > 0) {
    const index = Math.min(fresh.length - 1, Math.floor(random() * fresh.length));
    return fresh[index];
  }
  return [...eligible].sort((a, b) => (lastUse.get(a.id) ?? -Infinity) - (lastUse.get(b.id) ?? -Infinity))[0];
}

const PRAYER_KEYS: Readonly<Record<PrayerName, NotificationStringKey>> = {
  fajr: "notifPrayerFajr",
  dhuhr: "notifPrayerDhuhr",
  asr: "notifPrayerAsr",
  maghrib: "notifPrayerMaghrib",
  isha: "notifPrayerIsha",
};

export type Language = "en" | "ar";

export function prayerLabel(prayer: PrayerName, language: Language): string {
  return notificationsStrings[language][PRAYER_KEYS[prayer]];
}

/** Digits for display: Arabic-Indic in Arabic. */
export function localizeDigits(value: string | number, language: Language): string {
  const text = String(value);
  return language === "ar" ? text.replace(/\d/g, (digit) => toArabicNumber(Number(digit))) : text;
}

export type SurahNames = (surah: number, language: Language) => string | null;

/**
 * The title and body for a planned slot in `language`. `cutoff` is a prayer key ("dhuhr") or a
 * clock time ("12:30"); `prayer` is a prayer key; `surah` is a surah number.
 */
export function renderNotification(
  slot: Pick<PlannedSlot, "type" | "templateId" | "vars">,
  language: Language,
  surahNames: SurahNames,
): { title: string; body: string } {
  const strings = notificationsStrings[language];
  const template = templateById(slot.templateId);
  const title = strings[TITLE_KEYS[slot.type]];
  if (!template) return { title, body: strings.notifTWird9 };
  const values: Record<string, string> = {};
  for (const [name, raw] of Object.entries(slot.vars)) {
    if (raw === undefined || raw === null) continue;
    if (name === "prayer" || (name === "cutoff" && typeof raw === "string" && raw in PRAYER_KEYS)) {
      values[name] = prayerLabel(raw as PrayerName, language);
    } else if (name === "surah") {
      const surahName = surahNames(Number(raw), language);
      if (surahName) values[name] = surahName;
    } else {
      values[name] = localizeDigits(raw, language);
    }
  }
  return { title, body: interpolate(strings[template.key], values) };
}
