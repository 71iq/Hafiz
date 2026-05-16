import { z } from "zod";
import type {
  ReflectionJourneyBlock,
  ReflectionJourneyLevelSeed,
  ReflectionJourneyLocalizedText,
  ReflectionJourneySeed,
} from "./types";

export const REFLECTION_JOURNEY_SCHEMA_VERSION = 1;
export const REFLECTION_JOURNEY_MIN_RESPONSE_CHARS = 10;
export const REFLECTION_JOURNEY_MAX_RESPONSE_CHARS = 5000;

const localizedTextSchema = z.object({
  en: z.string().trim().min(1),
  ar: z.string().trim().min(1),
});

const blockTitleSchema = z.object({
  title: localizedTextSchema.optional(),
});

const ayahRangeSchema = blockTitleSchema.extend({
  type: z.literal("ayah_range"),
  surah: z.number().int().positive(),
  ayahStart: z.number().int().positive(),
  ayahEnd: z.number().int().positive(),
});

const translationSchema = blockTitleSchema.extend({
  type: z.literal("translation"),
  surah: z.number().int().positive(),
  ayahStart: z.number().int().positive(),
  ayahEnd: z.number().int().positive(),
});

const tafseerSchema = blockTitleSchema.extend({
  type: z.literal("tafseer"),
  surah: z.number().int().positive(),
  ayahStart: z.number().int().positive(),
  ayahEnd: z.number().int().positive(),
  source: z.enum(["muyassar", "zilal", "settings"]),
});

const customTextSchema = blockTitleSchema.extend({
  type: z.literal("custom_text"),
  body: localizedTextSchema,
  tone: z.enum(["intro", "note", "prompt"]).optional(),
});

const recitationPlaceholderSchema = blockTitleSchema.extend({
  type: z.literal("recitation_placeholder"),
  surah: z.number().int().positive(),
  ayahStart: z.number().int().positive(),
  ayahEnd: z.number().int().positive(),
  body: localizedTextSchema.optional(),
});

export const reflectionJourneyBlockSchema = z.discriminatedUnion("type", [
  ayahRangeSchema,
  translationSchema,
  tafseerSchema,
  customTextSchema,
  recitationPlaceholderSchema,
]);

export const reflectionJourneyBlocksSchema = z.array(reflectionJourneyBlockSchema);

const reflectionJourneyLevelSchema = z.object({
  id: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  order: z.number().int().positive(),
  title: localizedTextSchema,
  summary: localizedTextSchema.optional(),
  responsePrompt: localizedTextSchema,
  estimatedMinutes: z.number().int().positive().optional(),
  blocks: reflectionJourneyBlocksSchema,
});

const reflectionJourneySeedSchema = z.object({
  schemaVersion: z.literal(REFLECTION_JOURNEY_SCHEMA_VERSION),
  levels: z.array(reflectionJourneyLevelSchema),
});

type AyahCountIndex = Record<number, number>;

export function buildAyahCountIndex(quranData: any): AyahCountIndex {
  const surahs = Array.isArray(quranData?.tables?.surahs)
    ? quranData.tables.surahs
    : Array.isArray(quranData?.surahs)
      ? quranData.surahs
      : [];

  const index: AyahCountIndex = {};
  for (const surah of surahs) {
    const number = Number(surah?.number ?? surah?.id);
    const ayahCount = Number(surah?.ayah_count ?? surah?.verses_count);
    if (Number.isFinite(number) && Number.isFinite(ayahCount)) {
      index[number] = ayahCount;
    }
  }
  return index;
}

export function loadAndValidateReflectionJourneySeed(
  input: unknown,
  ayahCountIndex: AyahCountIndex
): ReflectionJourneySeed {
  const parsed = reflectionJourneySeedSchema.parse(input);
  validateLevelOrdering(parsed.levels);
  validateUniqueness(parsed.levels);
  validateBlockRanges(parsed.levels, ayahCountIndex);
  return parsed;
}

export function parseStoredReflectionJourneyBlocks(input: unknown): ReflectionJourneyBlock[] {
  return reflectionJourneyBlocksSchema.parse(input);
}

export function localizeReflectionJourneyText(
  text: ReflectionJourneyLocalizedText | undefined,
  language: "en" | "ar"
): string {
  if (!text) return "";
  return language === "ar" ? text.ar : text.en;
}

export function computeReflectionJourneyFingerprint(seed: ReflectionJourneySeed): string {
  const serialized = stableStringify(seed);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `rj_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function validateLevelOrdering(levels: ReflectionJourneyLevelSeed[]) {
  for (let index = 0; index < levels.length; index += 1) {
    const expectedOrder = index + 1;
    if (levels[index].order !== expectedOrder) {
      throw new Error(
        `Reflection Journey levels must use contiguous order values starting at 1. Expected ${expectedOrder}, received ${levels[index].order} for level "${levels[index].id}".`
      );
    }
  }
}

function validateUniqueness(levels: ReflectionJourneyLevelSeed[]) {
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();

  for (const level of levels) {
    if (seenIds.has(level.id)) {
      throw new Error(`Duplicate Reflection Journey level id "${level.id}".`);
    }
    if (seenSlugs.has(level.slug)) {
      throw new Error(`Duplicate Reflection Journey level slug "${level.slug}".`);
    }
    seenIds.add(level.id);
    seenSlugs.add(level.slug);
  }
}

function validateBlockRanges(levels: ReflectionJourneyLevelSeed[], ayahCountIndex: AyahCountIndex) {
  for (const level of levels) {
    for (const block of level.blocks) {
      if (block.type === "custom_text") continue;
      validateAyahRange(level.id, block, ayahCountIndex);
    }
  }
}

function validateAyahRange(
  levelId: string,
  block: Exclude<ReflectionJourneyBlock, { type: "custom_text" }>,
  ayahCountIndex: AyahCountIndex
) {
  const maxAyahs = ayahCountIndex[block.surah];
  if (!maxAyahs) {
    throw new Error(
      `Reflection Journey level "${levelId}" references unknown surah ${block.surah}.`
    );
  }
  if (block.ayahStart > block.ayahEnd) {
    throw new Error(
      `Reflection Journey level "${levelId}" has an invalid ayah range ${block.surah}:${block.ayahStart}-${block.ayahEnd}.`
    );
  }
  if (block.ayahEnd > maxAyahs) {
    throw new Error(
      `Reflection Journey level "${levelId}" references ${block.surah}:${block.ayahEnd}, but surah ${block.surah} ends at ayah ${maxAyahs}.`
    );
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
