import type { DatabaseExecutor } from "@/lib/database/types";

type VerseKey = Readonly<{ surah: number; ayah: number }>;
export type MeaningLanguage = "en" | "ar";

export function meaningKey({ surah, ayah }: VerseKey): string {
  return `${surah}:${ayah}`;
}

/**
 * MUT-05: each verse's meaning in the interface language, keyed 's:a': the Muyassar tafsir in Arabic,
 * the English translation in English, from the same bundled tables the sabaq meaning step reads. A
 * verse without one is left out. The repo has no tawjih data, so the classical explanation of why each
 * wording fits its place is not shown.
 */
export async function loadVerseMeanings(
  db: DatabaseExecutor,
  verses: readonly VerseKey[],
  language: MeaningLanguage,
): Promise<Map<string, string>> {
  const unique = [...new Map(verses.map((verse) => [meaningKey(verse), verse])).values()];
  if (unique.length === 0) return new Map();
  const where = unique.map(() => "(surah = ? AND ayah = ?)").join(" OR ");
  const params = unique.flatMap((verse) => [verse.surah, verse.ayah]);
  const rows = await db.getAllAsync<{ surah: number; ayah: number; text: string | null }>(
    language === "ar"
      ? `SELECT surah, ayah, text FROM tafseer WHERE source = 'muyassar' AND (${where})`
      : `SELECT surah, ayah, text_en AS text FROM translations WHERE ${where}`,
    params,
  );
  return new Map(rows.flatMap((row) => (row.text ? [[meaningKey(row), row.text] as const] : [])));
}
