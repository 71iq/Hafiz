import { z } from "zod";
import { isSyncableUserSetting } from "@/lib/database/user-settings";
import { syncTimestampSchema } from "@/lib/database/sync-timestamps";

const timestamp = syncTimestampSchema;
const optionalTimestamp = timestamp.nullish();
const identity = z.string().min(1);
const integer = z.number().int();
const position = integer.positive();
const state = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const wireMetadata = { user_id: identity.optional(), synced_at: optionalTimestamp };
const dates = { created_at: optionalTimestamp, updated_at: optionalTimestamp, deleted_at: optionalTimestamp };
const coordinates = { surah: position, ayah: position };
// PostgreSQL int8 identities can exceed JS's safe-number range. Keep decimal strings exact.
const databaseIdString = z
  .string()
  .refine((value) => /^[1-9]\d{0,18}$/.test(value) && (value.length < 19 || value <= "9223372036854775807"));
const numericId = z.union([position, databaseIdString]);
const jsonText = z.string().refine((value) => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
});
const jsonContainer = z.union([jsonText, z.array(z.json()), z.record(z.string(), z.json())]);

const setting = z.object({
  ...wireMetadata,
  ...dates,
  key: identity,
  value: z.string(),
});
const meaning = z.object({
  ...wireMetadata,
  ...dates,
  ...coordinates,
  word_pos: position,
  word: z.string().nullish(),
  meaning: z.string(),
});
const card = z.object({
  ...wireMetadata,
  ...dates,
  id: identity,
  deck_id: identity,
  due: timestamp,
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: integer,
  scheduled_days: integer,
  learning_steps: integer,
  reps: integer,
  lapses: integer,
  state,
  last_review: optionalTimestamp,
  suspended_at: optionalTimestamp,
  buried_until: optionalTimestamp,
  marked_at: optionalTimestamp,
  created_at: timestamp,
});
const log = z.object({
  ...wireMetadata,
  id: numericId.optional(),
  card_id: identity,
  rating: integer,
  state,
  due: timestamp,
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: integer,
  scheduled_days: integer,
  reviewed_at: timestamp,
});
const bookmark = z.object({
  ...wireMetadata,
  ...dates,
  ...coordinates,
  created_at: timestamp,
  qf_bookmark_id: z.string().nullish(),
  qf_synced_at: optionalTimestamp,
  qf_sync_error: z.string().nullish(),
  // SQLite backfill uses 0/1; current write helpers and remote rows use booleans.
  qf_is_in_default_collection: z.union([z.boolean(), z.literal(0), z.literal(1)]).nullish(),
  qf_collections_count: integer.nullish(),
});
const highlight = z.object({
  ...wireMetadata,
  ...dates,
  ...coordinates,
  id: numericId.optional(),
  sync_id: identity.nullish(),
  word_start: position.nullish(),
  word_end: position.nullish(),
  color: identity,
  created_at: timestamp,
  // Empty updated_at is an established legacy deletion contract.
  updated_at: z.union([timestamp, z.literal("")]).nullish(),
});
const note = z.object({
  ...wireMetadata,
  ...dates,
  id: identity,
  surah: position,
  ayah_start: position,
  ayah_end: position,
  content: z.string(),
  created_at: timestamp,
  qf_note_id: z.string().nullish(),
  qf_synced_at: optionalTimestamp,
  qf_sync_error: z.string().nullish(),
  qf_ranges_json: jsonContainer.nullish(),
});
const journey = z.object({
  ...wireMetadata,
  level_id: identity,
  status: z.enum(["draft", "completed"]),
  response_text: z.string(),
  created_at: timestamp,
  updated_at: optionalTimestamp,
  completed_at: optionalTimestamp,
});
const achievement = z.object({
  ...wireMetadata,
  achievement_id: identity,
  unlocked_at: timestamp,
  public_payload: jsonContainer.optional(),
});

const schemas = {
  user_settings: setting,
  user_word_meanings: meaning,
  study_cards: card,
  study_log: log,
  bookmarks: bookmark,
  highlights: highlight,
  private_notes: note,
  reflection_journey_entries: journey,
  achievement_unlocks: achievement,
};
const tableName = z.enum([
  "user_settings",
  "user_word_meanings",
  "study_cards",
  "study_log",
  "bookmarks",
  "highlights",
  "private_notes",
  "reflection_journey_entries",
  "achievement_unlocks",
]);
export type SyncTable = z.infer<typeof tableName>;

function resolvedTimestamp(row: { updated_at?: string | null; created_at?: string | null; synced_at?: string | null }) {
  return Boolean(row.updated_at ?? row.created_at ?? row.synced_at);
}

const liveCard = card.extend({ deleted_at: z.null().optional() });
const deletedCard = card
  .partial()
  .extend({
    id: identity,
    deleted_at: timestamp,
    deck_id: identity.nullish(),
    due: optionalTimestamp,
    stability: z.number().nullish(),
    difficulty: z.number().nullish(),
    elapsed_days: integer.nullish(),
    scheduled_days: integer.nullish(),
    learning_steps: integer.nullish(),
    reps: integer.nullish(),
    lapses: integer.nullish(),
    state: state.nullish(),
    created_at: optionalTimestamp,
  })
  .refine(resolvedTimestamp);
const deletedMeaning = meaning.partial().extend({
  ...coordinates,
  word_pos: position,
  deleted_at: timestamp,
});
const deletedSetting = setting.partial().extend({ key: identity, deleted_at: timestamp });
const deletedHighlight = highlight.extend({ created_at: optionalTimestamp, deleted_at: timestamp });
const incomingSetting = z
  .object({ key: identity })
  .passthrough()
  .transform((row, ctx) => {
    if (!isSyncableUserSetting(row.key)) return { kind: "ignored" as const, key: row.key };
    const parsed = z.union([setting.passthrough(), deletedSetting.passthrough()]).safeParse(row);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: "Invalid setting" });
      return z.NEVER;
    }
    return { ...parsed.data, kind: "setting" as const };
  });
const incomingSchemas = {
  ...schemas,
  study_cards: z.union([liveCard.passthrough(), deletedCard.passthrough()]),
  user_word_meanings: z.union([meaning.passthrough(), deletedMeaning.passthrough()]),
  highlights: z.union([highlight.passthrough(), deletedHighlight.passthrough()]),
  // Keep ignored settings in page counts without pretending their values were validated.
  user_settings: incomingSetting,
  study_log: log.passthrough(),
  bookmarks: bookmark.passthrough(),
  private_notes: note.passthrough(),
  reflection_journey_entries: journey.passthrough(),
  achievement_unlocks: achievement.passthrough(),
};
export type SyncRows = { [K in SyncTable]: z.infer<(typeof incomingSchemas)[K]> };

function fail(table: SyncTable): never {
  throw new Error(`Invalid synced ${table} payload`);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requireOwner(row: Record<string, unknown>, ownerId: string, table: SyncTable): void {
  if (
    row.user_id !== undefined &&
    (typeof row.user_id !== "string" || row.user_id.toLowerCase() !== ownerId.toLowerCase())
  )
    fail(table);
}

export function decodeSyncPage<K extends SyncTable>(table: K, input: unknown, ownerId: string): SyncRows[K][] {
  if (!Array.isArray(input)) fail(table);
  return input.map((row: unknown) => {
    if (table === "study_cards" && (!record(row) || (!row.deleted_at && !state.safeParse(row.state).success))) {
      throw new Error("Invalid synced study card state");
    }
    if (!record(row)) fail(table);
    requireOwner(row, ownerId, table);
    const result = incomingSchemas[table].safeParse(row);
    if (!result.success) fail(table);
    // The schema is selected by the same key as the mapped return type.
    return result.data as SyncRows[K];
  });
}

const envelope = z
  .object({
    id: position,
    table_name: tableName,
    operation: z.enum(["INSERT", "UPDATE", "DELETE"]),
    row_id: identity,
    data: z.string(),
    status: z.enum(["pending", "failed"]),
    created_at: timestamp,
    synced_at: optionalTimestamp,
  })
  .strict();
const outgoingSchemas = {
  ...schemas,
  study_cards: z.union([liveCard.strict(), deletedCard.strict()]),
  user_word_meanings: z.union([meaning.strict(), deletedMeaning.strict()]),
  user_settings: z.union([setting.strict(), deletedSetting.strict()]),
  study_log: log.strict(),
  bookmarks: bookmark.strict(),
  highlights: highlight.strict(),
  private_notes: note.strict(),
  reflection_journey_entries: journey.strict(),
  achievement_unlocks: achievement.strict(),
};
const deleteSchemas = {
  user_settings: setting.partial().strict(),
  user_word_meanings: meaning.partial().strict(),
  study_cards: card.partial().strict(),
  study_log: log.partial().strict(),
  bookmarks: bookmark.partial().strict(),
  highlights: highlight.partial().strict(),
  private_notes: note.partial().strict(),
  reflection_journey_entries: journey.partial().strict(),
  achievement_unlocks: achievement.partial().strict(),
};

function canonicalHighlight(row: Record<string, unknown>): string {
  return `highlight:${row.surah}:${row.ayah}:${row.word_start ?? "ayah"}:${row.word_end ?? "ayah"}:${row.color}`;
}
function coordinateId(rowId: string, fields: string[]): Record<string, number> | null {
  const parts = rowId.split(":");
  if (
    parts.length !== fields.length ||
    !parts.every((part) => /^[1-9]\d*$/.test(part) && Number.isSafeInteger(Number(part)))
  )
    return null;
  return Object.fromEntries(fields.map((field, i) => [field, Number(parts[i])]));
}

function requireIdentity(table: SyncTable, rowId: string, data: Record<string, unknown>, deletion: boolean): void {
  let expected: unknown;
  switch (table) {
    case "user_settings":
      expected = data.key;
      break;
    case "study_cards":
    case "private_notes":
      expected = data.id;
      break;
    case "reflection_journey_entries":
      expected = data.level_id;
      break;
    case "achievement_unlocks":
      expected = data.achievement_id;
      break;
    case "study_log":
      expected = deletion
        ? data.id === undefined
          ? undefined
          : String(data.id)
        : `${data.card_id}:${data.reviewed_at}`;
      if (deletion && !databaseIdString.safeParse(rowId).success) fail(table);
      break;
    case "bookmarks":
    case "user_word_meanings": {
      const fields = table === "bookmarks" ? ["surah", "ayah"] : ["surah", "ayah", "word_pos"];
      const coordinates = coordinateId(rowId, fields);
      if (!coordinates || fields.some((field) => data[field] !== undefined && data[field] !== coordinates[field]))
        fail(table);
      return;
    }
    case "highlights": {
      if (data.sync_id != null && !databaseIdString.safeParse(rowId).success && data.sync_id !== rowId) fail(table);
      if (
        deletion &&
        data.sync_id == null &&
        data.surah === undefined &&
        !databaseIdString.safeParse(rowId).success &&
        !/^highlight:[1-9]\d*:[1-9]\d*:(?:ayah|[1-9]\d*):(?:ayah|[1-9]\d*):.+$/.test(rowId)
      )
        fail(table);
      const identities = [data.sync_id, data.id === undefined ? undefined : String(data.id)];
      if (data.surah !== undefined && data.ayah !== undefined && data.color !== undefined)
        identities.push(canonicalHighlight(data));
      if (identities.some((value) => value === rowId)) return;
      if (!deletion || identities.some((value) => value !== undefined && value !== null)) fail(table);
      if (
        !databaseIdString.safeParse(rowId).success &&
        !/^highlight:[1-9]\d*:[1-9]\d*:(?:ayah|[1-9]\d*):(?:ayah|[1-9]\d*):.+$/.test(rowId)
      )
        fail(table);
      return;
    }
  }
  if (expected !== undefined ? expected !== rowId : !deletion) fail(table);
}

export type DecodedSyncEntry = {
  table: SyncTable;
  operation: "INSERT" | "UPDATE" | "DELETE";
  rowId: string;
  data: Record<string, unknown>;
  /** When the change was queued; the honest time for a legacy tombstone without deleted_at. */
  queuedAt: string;
};
export function decodeSyncQueueEntry(input: unknown, ownerId: string): DecodedSyncEntry {
  const result = envelope.safeParse(input);
  if (!result.success) throw new Error("Invalid queued sync envelope");
  const entry = result.data;
  const table = entry.table_name;
  let raw: unknown;
  try {
    raw = JSON.parse(entry.data);
  } catch {
    fail(table);
  }
  if (!record(raw)) fail(table);
  requireOwner(raw, ownerId, table);
  const deletion = entry.operation === "DELETE";
  const parsed = (deletion ? deleteSchemas[table] : outgoingSchemas[table]).safeParse(raw);
  if (!parsed.success) fail(table);
  const data: Record<string, unknown> = parsed.data;
  if (table === "user_settings" && !isSyncableUserSetting(String(data.key ?? entry.row_id))) fail(table);
  requireIdentity(table, entry.row_id, data, deletion);
  if (deletion) {
    // These existing DELETE branches dispatch tombstone upserts, so they need complete rows.
    const needsRow =
      (table === "user_word_meanings" && data.surah !== undefined) ||
      (table === "study_cards" && data.deck_id !== undefined) ||
      (table === "highlights" && (data.sync_id != null || data.surah !== undefined));
    if (
      needsRow &&
      !(table === "highlights" ? highlight.strict() : outgoingSchemas[table]).safeParse({
        ...data,
        deleted_at: data.deleted_at ?? new Date().toISOString(),
      }).success
    )
      fail(table);
  }
  return { table, operation: entry.operation, rowId: entry.row_id, data, queuedAt: entry.created_at };
}

const freshness = z.object({
  ...wireMetadata,
  created_at: optionalTimestamp,
  updated_at: optionalTimestamp,
  unlocked_at: optionalTimestamp,
});
const highlightFreshness = freshness.extend({ updated_at: z.union([timestamp, z.literal("")]).nullish() });

/** A freshness projection may suppress an upload, so malformed data must never mean ACK. */
export function decodeSyncFreshness(table: SyncTable, input: unknown, ownerId: string): string | null {
  if (!Array.isArray(input) || input.length > 1) fail(table);
  if (input.length === 0) return null;
  const row: unknown = input[0];
  if (!record(row)) fail(table);
  requireOwner(row, ownerId, table);
  const parsed = (table === "highlights" ? highlightFreshness : freshness).safeParse(row);
  if (!parsed.success) fail(table);
  const value =
    table === "achievement_unlocks"
      ? (parsed.data.unlocked_at ?? parsed.data.synced_at)
      : (parsed.data.updated_at ?? parsed.data.created_at ?? parsed.data.synced_at);
  if (value == null) fail(table);
  return value;
}

const existingLog = z.object({ id: numericId, user_id: identity.optional() });
export function decodeSyncedStudyLogExists(input: unknown, ownerId: string): boolean {
  if (input === null) return false;
  if (!record(input)) fail("study_log");
  requireOwner(input, ownerId, "study_log");
  if (!existingLog.safeParse(input).success) fail("study_log");
  return true;
}
