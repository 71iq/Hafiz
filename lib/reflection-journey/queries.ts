import type { AppDatabase, DatabaseExecutor } from "@/lib/database/types";
import { enqueueSync } from "@/lib/database/sync-queue";
import {
  parseStoredReflectionJourneyBlocks,
  REFLECTION_JOURNEY_MAX_RESPONSE_CHARS,
  REFLECTION_JOURNEY_MIN_RESPONSE_CHARS,
} from "./schema";
import { checkJourneyCompletion, selectDefaultJourneyLevel } from "./selection";
import type {
  ReflectionJourneyEntry,
  ReflectionJourneyEntryStatus,
  ReflectionJourneyLevel,
  ReflectionJourneyLevelDetail,
  ReflectionJourneyLevelListItem,
  ReflectionJourneySummary,
} from "./types";

type LevelRow = {
  id: string;
  slug: string;
  order_index: number;
  title_en: string;
  title_ar: string;
  summary_en: string | null;
  summary_ar: string | null;
  response_prompt_en: string;
  response_prompt_ar: string;
  estimated_minutes: number | null;
  content_json: string;
};

type EntryRow = {
  level_id: string;
  status: ReflectionJourneyEntryStatus;
  response_text: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function listReflectionJourneyLevels(
  db: DatabaseExecutor
): Promise<ReflectionJourneyLevelListItem[]> {
  const [levelRows, entryRows] = await Promise.all([
    db.getAllAsync<LevelRow>(
      "SELECT * FROM reflection_journey_levels ORDER BY order_index ASC"
    ),
    db.getAllAsync<EntryRow>(
      "SELECT * FROM reflection_journey_entries ORDER BY updated_at DESC"
    ),
  ]);

  const entryMap = new Map(entryRows.map((row) => [row.level_id, rowToEntry(row)]));

  // Every level is open; the order is a suggestion. Each status comes from that level's own entry.
  return levelRows.map((row) => {
    const level = rowToLevel(row);
    const entry = entryMap.get(row.id) ?? null;
    const status =
      entry?.status === "completed" ? "completed" : entry?.status === "draft" ? "draft" : "available";
    return { ...level, status, entry };
  });
}

async function getReflectionJourneyLevel(
  db: DatabaseExecutor,
  levelId: string
): Promise<ReflectionJourneyLevelDetail | null> {
  const levels = await listReflectionJourneyLevels(db);
  return levels.find((level) => level.id === levelId) ?? null;
}

export async function getReflectionJourneySummary(
  db: DatabaseExecutor
): Promise<ReflectionJourneySummary> {
  const levels = await listReflectionJourneyLevels(db);
  const completedLevels = levels.filter((level) => level.status === "completed").length;
  const currentLevel = selectDefaultJourneyLevel(levels);

  return {
    totalLevels: levels.length,
    completedLevels,
    currentLevelId: currentLevel?.id ?? null,
    currentLevelTitle: currentLevel?.title ?? null,
  };
}

export async function saveReflectionJourneyDraft(
  db: AppDatabase,
  levelId: string,
  responseText: string
): Promise<ReflectionJourneyEntry> {
  const level = await getReflectionJourneyLevel(db, levelId);
  if (!level) {
    throw new Error(`Reflection Journey level "${levelId}" was not found.`);
  }

  const existing = level.entry;
  if (existing?.status === "completed") {
    // Editing a completed level keeps its completion and timestamp, under the completion limits.
    assertCompletable(responseText);
    return upsertReflectionJourneyEntry(db, levelId, responseText, "completed", existing.completedAt);
  }

  return upsertReflectionJourneyEntry(db, levelId, responseText, "draft", existing?.completedAt ?? null);
}

export async function completeReflectionJourneyLevel(
  db: AppDatabase,
  levelId: string,
  responseText: string
): Promise<ReflectionJourneyEntry> {
  const level = await getReflectionJourneyLevel(db, levelId);
  if (!level) {
    throw new Error(`Reflection Journey level "${levelId}" was not found.`);
  }

  const trimmed = responseText.trim();
  assertCompletable(trimmed);

  return upsertReflectionJourneyEntry(
    db,
    levelId,
    trimmed,
    "completed",
    level.entry?.completedAt ?? null
  );
}

function assertCompletable(responseText: string) {
  const check = checkJourneyCompletion(responseText);
  if (check.ok) return;
  throw new Error(
    check.reason === "short"
      ? `Reflection Journey responses must be at least ${REFLECTION_JOURNEY_MIN_RESPONSE_CHARS} characters.`
      : `Reflection Journey responses must be ${REFLECTION_JOURNEY_MAX_RESPONSE_CHARS} characters or fewer.`
  );
}

/** Save a journey entry. The row and its upload queue entry commit together or not at all. */
async function upsertReflectionJourneyEntry(
  database: AppDatabase,
  levelId: string,
  responseText: string,
  status: ReflectionJourneyEntryStatus,
  completedAt: string | null
): Promise<ReflectionJourneyEntry> {
  let entry: ReflectionJourneyEntry | null = null;
  await database.withTransactionAsync(async (db) => {
    entry = await upsertReflectionJourneyEntryRow(db, levelId, responseText, status, completedAt);
  });
  if (!entry) throw new Error("Reflection Journey entry was not saved.");
  return entry;
}

async function upsertReflectionJourneyEntryRow(
  db: DatabaseExecutor,
  levelId: string,
  responseText: string,
  status: ReflectionJourneyEntryStatus,
  completedAt: string | null
): Promise<ReflectionJourneyEntry> {
  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<EntryRow>(
    "SELECT * FROM reflection_journey_entries WHERE level_id = ?",
    [levelId]
  );

  const row: EntryRow = {
    level_id: levelId,
    status,
    response_text: responseText.trim(),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    completed_at: status === "completed" ? (completedAt ?? existing?.completed_at ?? now) : null,
  };

  await db.runAsync(
    `INSERT OR REPLACE INTO reflection_journey_entries
      (level_id, status, response_text, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      row.level_id,
      row.status,
      row.response_text,
      row.created_at,
      row.updated_at,
      row.completed_at,
    ]
  );

  await enqueueSync(db, "reflection_journey_entries", "INSERT", row.level_id, rowToSyncData(row));

  return rowToEntry(row);
}

function rowToLevel(row: LevelRow): ReflectionJourneyLevel {
  const parsedBlocks = parseStoredReflectionJourneyBlocks(JSON.parse(row.content_json));
  return {
    id: row.id,
    slug: row.slug,
    order: row.order_index,
    title: {
      en: row.title_en,
      ar: row.title_ar,
    },
    summary:
      row.summary_en || row.summary_ar
        ? {
            en: row.summary_en ?? "",
            ar: row.summary_ar ?? "",
          }
        : undefined,
    responsePrompt: {
      en: row.response_prompt_en,
      ar: row.response_prompt_ar,
    },
    estimatedMinutes: row.estimated_minutes ?? undefined,
    blocks: parsedBlocks,
  };
}

function rowToEntry(row: EntryRow): ReflectionJourneyEntry {
  return {
    levelId: row.level_id,
    status: row.status,
    responseText: row.response_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function rowToSyncData(row: EntryRow) {
  return {
    level_id: row.level_id,
    status: row.status,
    response_text: row.response_text,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}
