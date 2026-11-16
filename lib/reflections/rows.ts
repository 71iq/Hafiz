import { z } from "zod";
import type { Reflection, ReflectionComment } from "./types";

const count = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? 0);
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? "");
const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? null);
const profile = z
  .object({
    username: z.string(),
    display_name: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    avatar_url: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
  })
  .nullish()
  .transform((value) => value ?? undefined);

const reflectionRow = z.object({
  id: z.string(),
  user_id: optionalText,
  surah: z.number().int(),
  ayah_start: z.number().int(),
  ayah_end: z.number().int(),
  juz_start: nullableInt,
  juz_end: nullableInt,
  content: z.string(),
  likes_count: count,
  comments_count: count,
  status: z
    .enum(["active", "hidden", "deleted"])
    .nullish()
    .transform((value) => value ?? "active"),
  created_at: optionalText,
  updated_at: optionalText,
  profiles: profile,
});

const commentRow = z.object({
  id: z.string(),
  reflection_id: optionalText,
  user_id: optionalText,
  content: z.string(),
  likes_count: count,
  created_at: optionalText,
  profiles: profile,
});

export class SavedRowUnreadableError extends Error {
  constructor(kind: "reflection" | "comment") {
    super(`Saved ${kind} could not be read back`);
    this.name = "SavedRowUnreadableError";
  }
}

export function parseSavedRow<T>(kind: "reflection" | "comment", parse: (input: unknown) => T, input: unknown): T {
  try {
    return parse(input);
  } catch {
    throw new SavedRowUnreadableError(kind);
  }
}

const list = <T extends z.ZodTypeAny>(row: T) =>
  z
    .array(row)
    .nullish()
    .transform((rows) => rows ?? []);

export const parseReflectionRow = (input: unknown): Reflection => reflectionRow.parse(input);
export const parseReflectionRows = (input: unknown): Reflection[] => list(reflectionRow).parse(input);
export const parseCommentRow = (input: unknown): ReflectionComment => commentRow.parse(input);
export const parseCommentRows = (input: unknown): ReflectionComment[] => list(commentRow).parse(input);
