import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { MAX_LEVEL, type MeaningLanguage } from "@/lib/meanings/lemma-index";
import { STUDY_DECK_SETTING_KEYS } from "@/lib/study/daily-decks";

/**
 * The word-meaning settings (SPEC 3.6). `habit_` keys sync on released builds. The meaning language
 * is the language of a word card's answer; the level is how many bands of the commonest words count
 * as known (0 to 5), so their lemmas get no card.
 *
 * Neither is written until the user chooses one, in setup, in Settings or by accepting a level offer.
 * Until then both are derived when read: the language from the interface language, the level from
 * the language. A written default would carry a fresh timestamp, so a device that had not synced yet
 * would replace a choice made on another device, and a fresh device would have settings of its own
 * for the account restore to ask about.
 */
export const MEANINGS_SETTING_KEYS = {
  language: "habit_meanings_language",
  level: "habit_meanings_level",
} as const;

export type MeaningsSettings = Readonly<{
  language: MeaningLanguage;
  level: number;
  /** Whether each value is stored, or derived because it never was. */
  stored: Readonly<{ language: boolean; level: boolean }>;
}>;

export function parseMeaningLanguage(value: string | null | undefined): MeaningLanguage | null {
  return value === "ar" || value === "en" ? value : null;
}

export function parseMeaningsLevel(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const level = Number(value);
  return Number.isInteger(level) && level >= 0 && level <= MAX_LEVEL ? level : null;
}

/** A user who never took the check: Arabic readers start past the commonest bands, others at the start. */
export function defaultLevelFor(language: MeaningLanguage): number {
  return language === "ar" ? 3 : 0;
}

/**
 * The interface language the app shows: the stored choice, else the startup language (the web cache,
 * the native mirror, then the device locale), as the settings provider resolves it.
 */
function interfaceLanguage(stored: string | undefined): MeaningLanguage {
  return parseMeaningLanguage(stored) ?? getStartupLanguage();
}

function meaningsFrom(values: ReadonlyMap<string, string>): MeaningsSettings {
  const storedLanguage = parseMeaningLanguage(values.get(MEANINGS_SETTING_KEYS.language));
  const language = storedLanguage ?? interfaceLanguage(values.get("ui_language"));
  const storedLevel = parseMeaningsLevel(values.get(MEANINGS_SETTING_KEYS.level));
  return {
    language,
    level: storedLevel ?? defaultLevelFor(language),
    stored: { language: storedLanguage !== null, level: storedLevel !== null },
  };
}

const READ_KEYS = [
  MEANINGS_SETTING_KEYS.language,
  MEANINGS_SETTING_KEYS.level,
  "ui_language",
  STUDY_DECK_SETTING_KEYS.meanings,
];

async function readValues(db: DatabaseExecutor): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM user_settings WHERE key IN (${READ_KEYS.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
    READ_KEYS,
  );
  return new Map(rows.map((row) => [row.key, row.value]));
}

export async function readMeaningsSettings(db: DatabaseExecutor): Promise<MeaningsSettings> {
  return meaningsFrom(await readValues(db));
}

export async function writeMeaningLanguage(db: AppDatabase, language: MeaningLanguage): Promise<void> {
  await db.withTransactionAsync((tx) => putUserSetting(tx, MEANINGS_SETTING_KEYS.language, language));
}

function clampLevel(level: number): number {
  return Math.max(0, Math.min(MAX_LEVEL, Math.round(level)));
}

export async function writeMeaningsLevel(db: AppDatabase, level: number): Promise<void> {
  await db.withTransactionAsync((tx) => putUserSetting(tx, MEANINGS_SETTING_KEYS.level, String(clampLevel(level))));
}

/** What the setup's "Word meanings" step chose (SPEC 3.6). */
export type MeaningsSetup = Readonly<{
  /** Word meanings in daily study. */
  inDailyStudy: boolean;
  language: MeaningLanguage;
  /** Whether the user tapped the language: a choice, stored even when it matches the derived one. */
  languagePicked: boolean;
  /** The level the step settled, or null to keep the stored one (or the language's default). */
  level: number | null;
}>;

/**
 * Saves the step inside the setup transaction. The switch and an untapped language are compared with
 * what the user sees now, stored or derived (a missing switch row is on), so a step passed without a
 * change adds no sync rows and cannot undo a choice another device has not synced yet. A tapped
 * language is a choice and is stored unless that row already holds it, so it no longer follows the
 * interface language. A level is written only when the step settled one.
 */
export async function putMeaningsSetup(db: DatabaseExecutor, setup: MeaningsSetup): Promise<void> {
  const values = await readValues(db);
  const current = meaningsFrom(values);
  const switchOn = values.get(STUDY_DECK_SETTING_KEYS.meanings) !== "false";
  if (setup.inDailyStudy !== switchOn) {
    await putUserSetting(db, STUDY_DECK_SETTING_KEYS.meanings, setup.inDailyStudy ? "true" : "false");
  }
  const languageChanged = setup.languagePicked
    ? values.get(MEANINGS_SETTING_KEYS.language) !== setup.language
    : setup.language !== current.language;
  if (languageChanged) await putUserSetting(db, MEANINGS_SETTING_KEYS.language, setup.language);
  if (setup.level !== null) {
    const level = String(clampLevel(setup.level));
    if (values.get(MEANINGS_SETTING_KEYS.level) !== level) await putUserSetting(db, MEANINGS_SETTING_KEYS.level, level);
  }
}
