import type { SQLiteDatabase } from "expo-sqlite";
import { translationRequires } from "./translation-requires";

/**
 * Import a translation into the translation_active table.
 * Clears existing data and batch-inserts from the bundled JSON.
 */
export async function importTranslation(
  db: SQLiteDatabase,
  langCode: string
): Promise<void> {
  const data = translationRequires[langCode];
  if (!data) {
    throw new Error(`No bundled translation for language: ${langCode}`);
  }

  console.log(`[Translation] Importing ${langCode} (${data.length} rows)...`);
  const start = Date.now();

  // Clear existing active translation
  await db.runAsync("DELETE FROM translation_active");

  // Batch insert from JSON
  const BATCH_SIZE = 500;
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    await db.withTransactionAsync(async () => {
      const stmt = await db.prepareAsync(
        "INSERT INTO translation_active (surah, ayah, text) VALUES (?, ?, ?)"
      );
      try {
        for (const row of batch) {
          await stmt.executeAsync([row.surah, row.ayah, row.text]);
        }
      } finally {
        await stmt.finalizeAsync();
      }
    });
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Translation] ${langCode} import done in ${elapsed}s`);
}
