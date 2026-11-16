import type { AppDatabase } from "@/lib/database/types";
import { insertPreparedRows } from "@/lib/database/bulk-insert";
import { loadTranslation } from "./translation-requires";

export class TranslationImportCancelled extends Error {
  constructor() {
    super("Translation import cancelled before it replaced the active rows");
    this.name = "TranslationImportCancelled";
  }
}

export async function importTranslation(
  db: AppDatabase,
  langCode: string,
  options: { shouldContinue?: () => boolean } = {},
): Promise<void> {
  const data = await loadTranslation(langCode);
  if (!data) {
    throw new Error(`No bundled translation for language: ${langCode}`);
  }
  if (options.shouldContinue && !options.shouldContinue()) throw new TranslationImportCancelled();

  console.log(`[Translation] Importing ${langCode} (${data.length} rows)...`);
  const start = Date.now();

  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM translation_active");
    await insertPreparedRows(
      tx,
      "INSERT INTO translation_active (surah, ayah, text) VALUES (?, ?, ?)",
      data.map((row: { surah: number; ayah: number; text: string }) => [row.surah, row.ayah, row.text]),
    );
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Translation] ${langCode} import done in ${elapsed}s`);
}
