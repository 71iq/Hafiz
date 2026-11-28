import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { putUserSetting } from "@/lib/database/user-settings";
import { MEANINGS_DECK_ID, putDeckReviewSettings, readDeckReviewSettings } from "@/lib/fsrs/queries";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { DEFAULT_DECK_NEW_CARD_LIMIT } from "@/lib/fsrs/types";
import { readMemorizedPageNumbers } from "@/lib/hifz/pages";

/**
 * Which decks make up daily study (SPEC 3.6 to 3.8). Mutashabihat and Similar tails always do,
 * Meanings unless turned off, and Qira'at and Reasons of revelation only when on. Retention is not a
 * daily deck: for a plan that reviews by ayah its due reviews are plan work, and otherwise it sits
 * under All decks.
 *
 * Keys use the `habit_` prefix, which released builds already sync (a new `hifz_` key would be
 * dropped by them and never fetched later), and none starts with `deck`, which an old migration
 * deletes.
 */
export const STUDY_DECK_SETTING_KEYS = {
  meanings: "habit_study_meanings",
  qiraat: "habit_study_qiraat",
  reasons: "habit_study_reasons",
} as const;

/** Set by plan setup when the declared portion is the whole Quran, for every recitation unit. */
export const DECLARED_WHOLE_QURAN_KEY = "habit_declared_whole_quran";

/** Automatic: on for a full hafiz, otherwise off. Nothing stored means automatic. */
export type DeckSwitch = "auto" | "on" | "off";

export type SwitchableDeck = "qiraat" | "reasons";

/** The deck id behind a switch, read at call time so the module loads in any import order. */
export function switchableDeckId(deck: SwitchableDeck): string {
  return deck === "qiraat" ? SMART_DECK_IDS.qiraat : SMART_DECK_IDS.reasonsOfRevelation;
}

export type StudyDeckSettings = Readonly<{
  meanings: boolean;
  qiraat: DeckSwitch;
  reasons: DeckSwitch;
  declaredWholeQuran: boolean;
}>;

function parseDeckSwitch(value: string | undefined): DeckSwitch {
  return value === "on" || value === "off" ? value : "auto";
}

export function parseStudyDeckSettings(values: ReadonlyMap<string, string>): StudyDeckSettings {
  return {
    meanings: values.get(STUDY_DECK_SETTING_KEYS.meanings) !== "false",
    qiraat: parseDeckSwitch(values.get(STUDY_DECK_SETTING_KEYS.qiraat)),
    reasons: parseDeckSwitch(values.get(STUDY_DECK_SETTING_KEYS.reasons)),
    declaredWholeQuran: values.get(DECLARED_WHOLE_QURAN_KEY) === "true",
  };
}

export async function readStudyDeckSettings(db: DatabaseExecutor): Promise<StudyDeckSettings> {
  const keys = [...Object.values(STUDY_DECK_SETTING_KEYS), DECLARED_WHOLE_QURAN_KEY];
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM user_settings WHERE key IN (${keys.map(() => "?").join(", ")}) AND deleted_at IS NULL`,
    keys,
  );
  return parseStudyDeckSettings(new Map(rows.map((row) => [row.key, row.value])));
}

const MUSHAF_PAGE_COUNT = 604;

/**
 * A full hafiz for the automatic deck switches: the whole Quran declared at setup, every page
 * memorized, or the whole-Quran badge. This is "declared", not verified, on purpose; the Board's
 * hafiz band and the badge keep their own definitions.
 */
export async function isFullHafiz(db: DatabaseExecutor, settings?: StudyDeckSettings): Promise<boolean> {
  if ((settings ?? (await readStudyDeckSettings(db))).declaredWholeQuran) return true;
  if ((await readMemorizedPageNumbers(db)).size >= MUSHAF_PAGE_COUNT) return true;
  const badge = await db.getFirstAsync<{ found: number }>(
    "SELECT 1 AS found FROM achievement_unlocks WHERE achievement_id = 'quran_complete' LIMIT 1",
  );
  return !!badge;
}

/** Whether a switchable deck is on, resolving automatic. */
export function deckSwitchOn(value: DeckSwitch, fullHafiz: boolean): boolean {
  return value === "on" || (value === "auto" && fullHafiz);
}

/** Today's daily decks, in the order the session and Home list them. */
export async function readDailyDeckIds(db: DatabaseExecutor): Promise<string[]> {
  const settings = await readStudyDeckSettings(db);
  const needsHafiz = settings.qiraat === "auto" || settings.reasons === "auto";
  const fullHafiz = needsHafiz ? await isFullHafiz(db, settings) : false;
  return [
    SMART_DECK_IDS.mutashabihat,
    SMART_DECK_IDS.similarTails,
    ...(settings.meanings ? [MEANINGS_DECK_ID] : []),
    ...(deckSwitchOn(settings.qiraat, fullHafiz) ? [SMART_DECK_IDS.qiraat] : []),
    ...(deckSwitchOn(settings.reasons, fullHafiz) ? [SMART_DECK_IDS.reasonsOfRevelation] : []),
  ];
}

/**
 * A deck that becomes a daily deck with a new-card limit of 0 would offer nothing, and the switch
 * would look broken: first setups used to write 0 for these two decks. Raise it to the default.
 */
async function raiseZeroNewCardLimit(db: DatabaseExecutor, deckId: string): Promise<void> {
  const settings = await readDeckReviewSettings(db, deckId);
  if (settings.newCardsLimit > 0) return;
  await putDeckReviewSettings(db, deckId, { ...settings, newCardsLimit: DEFAULT_DECK_NEW_CARD_LIMIT });
}

/** Save a switch from settings. Turning a deck on raises a zero new-card limit in the same transaction. */
export async function writeDeckSwitch(database: AppDatabase, deck: SwitchableDeck, value: DeckSwitch): Promise<void> {
  await database.withTransactionAsync(async (db) => {
    await putUserSetting(db, STUDY_DECK_SETTING_KEYS[deck], value);
    const fullHafiz = value === "auto" ? await isFullHafiz(db) : false;
    if (deckSwitchOn(value, fullHafiz)) await raiseZeroNewCardLimit(db, switchableDeckId(deck));
  });
}

/** Save the Meanings switch. Nothing stored means on. */
export async function writeMeaningsInDailyStudy(database: AppDatabase, on: boolean): Promise<void> {
  await database.withTransactionAsync((db) =>
    putUserSetting(db, STUDY_DECK_SETTING_KEYS.meanings, on ? "true" : "false"),
  );
}

/**
 * The first time an automatic deck resolves to on, store On and raise its zero new-card limit, as the
 * switch does. Idempotent; called after setup and when Home loads, so a user who becomes a full
 * hafiz later is covered too.
 */
export async function settleAutomaticDecks(database: AppDatabase): Promise<void> {
  const settings = await readStudyDeckSettings(database);
  const pending = (["qiraat", "reasons"] as const).filter((deck) => settings[deck] === "auto");
  if (pending.length === 0 || !(await isFullHafiz(database, settings))) return;
  await database.withTransactionAsync(async (db) => {
    for (const deck of pending) {
      await putUserSetting(db, STUDY_DECK_SETTING_KEYS[deck], "on");
      await raiseZeroNewCardLimit(db, switchableDeckId(deck));
    }
  });
}
