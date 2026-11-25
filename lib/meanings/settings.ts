import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { MEANINGS_DECK_ID, writeDeckReviewSettings } from "@/lib/fsrs/queries";
import { DEFAULT_DECK_DAILY_REVIEW_LIMIT } from "@/lib/fsrs/types";
import { MAX_LEVEL, type MeaningLanguage } from "@/lib/meanings/lemma-index";

/**
 * The word-meaning settings (SPEC 3.6). `habit_` keys sync on released builds. The meaning language
 * is the language of a generated card's answer; the level is how many bands of the commonest words
 * count as known (0 to 5), so their lemmas get no card.
 */
export const MEANINGS_SETTING_KEYS = {
  language: "habit_meanings_language",
  level: "habit_meanings_level",
} as const;

/** The rate a user with no stored meanings settings starts on: five new words a day. */
export const DEFAULT_MEANINGS_NEW_CARDS = 5;

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

export async function readMeaningsSettings(db: DatabaseExecutor): Promise<MeaningsSettings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM user_settings WHERE key IN (?, ?, ?) AND deleted_at IS NULL",
    [MEANINGS_SETTING_KEYS.language, MEANINGS_SETTING_KEYS.level, "ui_language"],
  );
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const storedLanguage = parseMeaningLanguage(values.get(MEANINGS_SETTING_KEYS.language));
  // Derived from the interface language when never chosen; the setup step derives it from the
  // Arabic self-rating instead, and writes it.
  const language =
    storedLanguage ?? (values.get("ui_language") === "en" ? "en" : values.get("ui_language") === "ar" ? "ar" : "en");
  const storedLevel = parseMeaningsLevel(values.get(MEANINGS_SETTING_KEYS.level));
  return {
    language,
    level: storedLevel ?? defaultLevelFor(language),
    stored: { language: storedLanguage !== null, level: storedLevel !== null },
  };
}

export async function writeMeaningLanguage(db: AppDatabase, language: MeaningLanguage): Promise<void> {
  await db.withTransactionAsync((tx) => putUserSetting(tx, MEANINGS_SETTING_KEYS.language, language));
}

export async function writeMeaningsLevel(db: AppDatabase, level: number): Promise<void> {
  const clamped = Math.max(0, Math.min(MAX_LEVEL, Math.round(level)));
  await db.withTransactionAsync((tx) => putUserSetting(tx, MEANINGS_SETTING_KEYS.level, String(clamped)));
}

/**
 * Writes the derived defaults once, so two devices agree after a sync: the meaning language, the
 * level, and the meanings deck's rate for a user who never stored meanings review settings. Home
 * runs it on load, beside the automatic deck switches. Values already stored are never changed.
 */
export async function settleMeaningsDefaults(db: AppDatabase): Promise<void> {
  const settings = await readMeaningsSettings(db);
  const reviewSettings = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [
    `review_settings_${MEANINGS_DECK_ID}`,
  ]);
  if (settings.stored.language && settings.stored.level && reviewSettings) return;
  await db.withTransactionAsync(async (tx) => {
    if (!settings.stored.language) await putUserSetting(tx, MEANINGS_SETTING_KEYS.language, settings.language);
    if (!settings.stored.level) await putUserSetting(tx, MEANINGS_SETTING_KEYS.level, String(settings.level));
  });
  if (!reviewSettings) {
    await writeDeckReviewSettings(db, MEANINGS_DECK_ID, {
      newCardsLimit: DEFAULT_MEANINGS_NEW_CARDS,
      dailyReviewLimit: DEFAULT_DECK_DAILY_REVIEW_LIMIT,
    });
  }
}
