import type { QfBookmark, QfNote } from "./user-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonblankText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function incomplete(kind: string): never {
  throw new Error("Incomplete Quran Foundation " + kind + " response.");
}

export function readQfBookmarkAcknowledgement(
  response: unknown,
  expected: { surah: number; ayah: number },
): QfBookmark {
  if (!isRecord(response) || response.ok !== true || !isRecord(response.bookmark)) incomplete("bookmark");
  const row = response.bookmark;
  if (
    !isNonblankText(row.id) ||
    row.type !== "ayah" ||
    typeof row.surah !== "number" ||
    !Number.isInteger(row.surah) ||
    row.surah < 1 ||
    row.surah > 114 ||
    row.surah !== expected.surah ||
    typeof row.ayah !== "number" ||
    !Number.isInteger(row.ayah) ||
    row.ayah < 1 ||
    row.ayah !== expected.ayah ||
    !isNonblankText(row.createdAt) ||
    typeof row.isInDefaultCollection !== "boolean" ||
    typeof row.collectionsCount !== "number" ||
    !Number.isInteger(row.collectionsCount) ||
    row.collectionsCount < 0
  )
    incomplete("bookmark");
  return {
    id: row.id,
    type: row.type,
    surah: row.surah,
    ayah: row.ayah,
    createdAt: row.createdAt,
    isInDefaultCollection: row.isInDefaultCollection,
    collectionsCount: row.collectionsCount,
  };
}

export function readQfNoteAcknowledgement(response: unknown, expectedId?: string): QfNote {
  if (!isRecord(response) || response.ok !== true || !isRecord(response.note)) incomplete("note");
  const row = response.note;
  const ranges = Array.isArray(row.ranges) ? Array.from(row.ranges) : null;
  if (
    !isNonblankText(row.id) ||
    (expectedId !== undefined && row.id !== expectedId) ||
    !isNonblankText(row.body) ||
    !isNonblankText(row.createdAt) ||
    !isNonblankText(row.updatedAt) ||
    !ranges ||
    !ranges.every((range): range is string => typeof range === "string")
  )
    incomplete("note");
  return { id: row.id, body: row.body, ranges, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function requireQfDeleteAcknowledgement(response: unknown): void {
  if (!isRecord(response) || response.ok !== true || response.deleted !== true) incomplete("delete");
}
