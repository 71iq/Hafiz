import retiredCardsFile from "../../assets/data/mutashabihat/nourquran_hafiz_retired_cards.json";
import { insertPreparedRows } from "@/lib/database/bulk-insert";
import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { deleteStudyCardRow } from "@/lib/fsrs/queries";
import { EXCLUDED_SIMILAR_CARD_IDS } from "@/lib/fsrs/similar-card-exclusions";

/**
 * The similar-verse rows the app ships besides quran.db: exactly the mutashabihat_groups and
 * mutashabihat_refs rows that scripts/build-quran-db.mjs writes there, with each similar passage
 * rebuilt from the Uthmani text. The raw NourQuran JSON is a build input only; the app never imports
 * it, since its passages are not aligned with the Quran text.
 */
export const MUTASHABIHAT_ROWS_FILE = "mutashabihat/nourquran_hafiz_rows.json";

/**
 * The version of those rows this build of the app ships: the file's own "version", a hash of its
 * rows. tests/unit/mutashabihat-data.test.ts checks that they match, so rebuilt rows come with a new
 * version and installed apps refresh to them.
 */
export const MUTASHABIHAT_DATA_VERSION = "a8243922afe594d4";

/** Device-only setting (lib/database/user-settings.ts): the version of the rows this database holds. */
export const MUTASHABIHAT_VERSION_SETTING = "device_mutashabihat_data_version";

/**
 * Retired slots never hold a ref again. Excluded cards still have a ref for reader comparisons,
 * but their answer is already asked by the Similar tails deck. Both use the same sync deletion.
 */
const CARDS_TO_RETIRE: ReadonlySet<string> = new Set([...retiredCardsFile.cards, ...EXCLUDED_SIMILAR_CARD_IDS]);

export function isRetiredSimilarCard(cardId: string): boolean {
  return CARDS_TO_RETIRE.has(cardId);
}

/**
 * Deletes live retired or excluded cards among `cardIds` in the caller's transaction, queuing
 * each deletion for upload (deleteStudyCardRow). With no ids supplied it checks the whole set.
 * A card made on the old rows can reach a device after its refresh, from the account restore or a
 * pull (lib/database/sync.ts), so this runs wherever cards arrive and at every launch. Review logs
 * stay, as for any deleted card. Returns the ids deleted.
 */
export async function retireSimilarCards(
  db: DatabaseExecutor,
  cardIds: Iterable<string> = CARDS_TO_RETIRE,
): Promise<string[]> {
  const ids = [...new Set(cardIds)].filter(isRetiredSimilarCard);
  if (ids.length === 0) return [];
  const live = await db.getAllAsync<{ id: string; deck_id: string }>(
    `SELECT id, deck_id FROM study_cards WHERE deleted_at IS NULL AND id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
    ids,
  );
  for (const card of live) await deleteStudyCardRow(db, card.deck_id, card.id);
  return live.map((card) => card.id);
}

type GroupRow = readonly [id: string, kind: "similar" | "tail", cue: string, source: string, sortOrder: number];
type RefRow = readonly [
  groupId: string,
  sortOrder: number,
  surah: number,
  ayah: number,
  surahNameAr: string | null,
  tail5: string | null,
  preText: string | null,
  similarText: string | null,
  postText: string | null,
];

export type MutashabihatRows = Readonly<{ version: string; groups: readonly GroupRow[]; refs: readonly RefRow[] }>;

const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isWhole = (value: unknown): value is number => Number.isInteger(value);

function isGroupRow(row: unknown): row is GroupRow {
  return (
    Array.isArray(row) &&
    row.length === 5 &&
    isText(row[0]) &&
    (row[1] === "similar" || row[1] === "tail") &&
    isText(row[2]) &&
    isText(row[3]) &&
    isWhole(row[4])
  );
}

function isRefRow(row: unknown): row is RefRow {
  return (
    Array.isArray(row) &&
    row.length === 9 &&
    isText(row[0]) &&
    isWhole(row[1]) &&
    isWhole(row[2]) &&
    isWhole(row[3]) &&
    row.slice(4).every(isTextOrNull)
  );
}

/**
 * The rows file, checked whole: every row has the shape of its table, every ref belongs to a group,
 * and every similar-kind ref has similar words. Anything else throws, and nothing is written.
 */
export function parseMutashabihatRows(data: unknown): MutashabihatRows {
  const file = data as { schema_version?: unknown; version?: unknown; groups?: unknown; refs?: unknown } | null;
  if (!file || typeof file !== "object" || file.schema_version !== "1.0" || !isText(file.version)) {
    throw new Error("Unsupported similar-verse rows file");
  }
  const { groups, refs } = file;
  if (!Array.isArray(groups) || !Array.isArray(refs) || !groups.every(isGroupRow) || !refs.every(isRefRow)) {
    throw new Error("Malformed similar-verse rows file");
  }
  const kinds = new Map(groups.map((group) => [group[0], group[1]]));
  for (const ref of refs) {
    const kind = kinds.get(ref[0]);
    if (!kind || (kind === "similar" && (ref[7] ?? "").trim() === "")) {
      throw new Error(`Similar-verse ref ${ref[0]}:${ref[1]} has no group or no similar words`);
    }
  }
  return { version: file.version, groups, refs };
}

type InstalledRef = {
  group_id: string;
  sort_order: number;
  surah: number;
  ayah: number;
  surah_name_ar: string | null;
  tail_5: string | null;
  pre_text: string | null;
  similar_text: string | null;
  post_text: string | null;
};

const REF_COLUMNS = "group_id, sort_order, surah, ayah, surah_name_ar, tail_5, pre_text, similar_text, post_text";

/** Whether the database holds no similar-verse rows, or a similar ref without similar words. */
async function isIncomplete(db: DatabaseExecutor): Promise<boolean> {
  const row = await db.getFirstAsync<{ groups: number; refs: number; missing: number }>(
    `SELECT (SELECT COUNT(*) FROM mutashabihat_groups) AS groups,
            (SELECT COUNT(*) FROM mutashabihat_refs) AS refs,
            (SELECT COUNT(*) FROM mutashabihat_refs r JOIN mutashabihat_groups g ON g.id = r.group_id
              WHERE g.kind = 'similar' AND TRIM(COALESCE(r.similar_text, '')) = '') AS missing`,
  );
  return !row || row.groups === 0 || row.refs === 0 || row.missing > 0;
}

function sameRows(
  installedGroups: readonly { id: string; kind: string; cue: string; source: string; sort_order: number }[],
  installedRefs: readonly InstalledRef[],
  rows: MutashabihatRows,
): boolean {
  if (installedGroups.length !== rows.groups.length || installedRefs.length !== rows.refs.length) return false;
  const groups = new Map(installedGroups.map((group) => [group.id, group]));
  const refs = new Map(installedRefs.map((ref) => [`${ref.group_id}\u0000${ref.sort_order}`, ref]));
  return (
    rows.groups.every(([id, kind, cue, source, sortOrder]) => {
      const group = groups.get(id);
      return group?.kind === kind && group.cue === cue && group.source === source && group.sort_order === sortOrder;
    }) &&
    rows.refs.every((row) => {
      const ref = refs.get(`${row[0]}\u0000${row[1]}`);
      return (
        ref !== undefined &&
        ref.surah === row[2] &&
        ref.ayah === row[3] &&
        ref.surah_name_ar === row[4] &&
        ref.tail_5 === row[5] &&
        ref.pre_text === row[6] &&
        ref.similar_text === row[7] &&
        ref.post_text === row[8]
      );
    })
  );
}

export type MutashabihatRefresh = Readonly<{ replaced: boolean; retiredCards: readonly string[] }>;

/**
 * Brings the database's similar-verse rows to the version this app ships. importBundledDatabase keeps
 * an existing database on web and native, so an installed app holds the rows of the bundle it was
 * installed from, and an empty or incomplete table needs them too. Runs at every launch; once the
 * database is current it reads one setting and looks for live retired cards.
 *
 * The rows are replaced in one transaction, with the version setting. The live cards of retired
 * slots (retireSimilarCards) are deleted in the same transaction, with their uploads queued, so no
 * card shows another verse than the one it was reviewed as, and none is left behind with nothing to
 * show. Review logs stay, as for any deleted card. Recitation errors and drift siblings name verses,
 * not refs, and are left as they are: a drift's "Which one" pair is looked up in the current groups
 * (similarPair), so a pair the data no longer holds is not asked.
 *
 * Throws when the file is malformed or is not this version (a stale cached copy); nothing is written
 * then, and the next launch tries again.
 */
export async function refreshMutashabihatRows(
  db: AppDatabase,
  load: () => Promise<unknown>,
): Promise<MutashabihatRefresh> {
  const stored = await db.getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = ?", [
    MUTASHABIHAT_VERSION_SETTING,
  ]);
  if (stored?.value === MUTASHABIHAT_DATA_VERSION && !(await isIncomplete(db))) {
    return { replaced: false, retiredCards: await retireLiveCards(db) };
  }
  const rows = parseMutashabihatRows(await load());
  if (rows.version !== MUTASHABIHAT_DATA_VERSION) {
    throw new Error(`Similar-verse rows file is version ${rows.version}, expected ${MUTASHABIHAT_DATA_VERSION}`);
  }
  const writeVersion = (executor: DatabaseExecutor) =>
    executor.runAsync("INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)", [
      MUTASHABIHAT_VERSION_SETTING,
      MUTASHABIHAT_DATA_VERSION,
    ]);

  const [installedGroups, installedRefs] = await Promise.all([
    db.getAllAsync<{ id: string; kind: string; cue: string; source: string; sort_order: number }>(
      "SELECT id, kind, cue, source, sort_order FROM mutashabihat_groups",
    ),
    db.getAllAsync<InstalledRef>(`SELECT ${REF_COLUMNS} FROM mutashabihat_refs`),
  ]);
  let retiredCards: string[] = [];
  if (sameRows(installedGroups, installedRefs, rows)) {
    await db.withTransactionAsync(async (tx) => {
      retiredCards = await retireSimilarCards(tx);
      await writeVersion(tx);
    });
    return { replaced: false, retiredCards };
  }

  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM mutashabihat_refs");
    await tx.runAsync("DELETE FROM mutashabihat_groups");
    await insertPreparedRows(
      tx,
      "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES (?, ?, ?, ?, ?)",
      rows.groups.map((row) => [...row]),
    );
    await insertPreparedRows(
      tx,
      `INSERT INTO mutashabihat_refs (${REF_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rows.refs.map((row) => [...row]),
    );
    retiredCards = await retireSimilarCards(tx);
    await writeVersion(tx);
  });
  return { replaced: true, retiredCards };
}

/**
 * The launch check once the rows are current: a retired card that arrived by a path that missed it
 * is deleted in its own transaction. Usually there is none, and nothing is written.
 */
async function retireLiveCards(db: AppDatabase): Promise<string[]> {
  const ids = [...CARDS_TO_RETIRE];
  if (ids.length === 0) return [];
  const live = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM study_cards WHERE deleted_at IS NULL AND id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  if (!live?.count) return [];
  let retired: string[] = [];
  await db.withTransactionAsync(async (tx) => {
    retired = await retireSimilarCards(tx);
  });
  return retired;
}
