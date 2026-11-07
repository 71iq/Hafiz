import type { AppDatabase } from "@/lib/database/types";
import { loadTranslation } from "./translation-requires";

/**
 * Import a translation into the translation_active table.
 * Loads the bundle before replacing the active rows in one owned transaction.
 */
export async function importTranslation(db: AppDatabase, langCode: string): Promise<void> {
  const data = await loadTranslation(langCode);
  if (!data) {
    throw new Error(`No bundled translation for language: ${langCode}`);
  }

  console.log(`[Translation] Importing ${langCode} (${data.length} rows)...`);
  const start = Date.now();

  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM translation_active");
    const stmt = await tx.prepareAsync("INSERT INTO translation_active (surah, ayah, text) VALUES (?, ?, ?)");
    try {
      for (const row of data) {
        await stmt.executeAsync([row.surah, row.ayah, row.text]);
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Translation] ${langCode} import done in ${elapsed}s`);
}
