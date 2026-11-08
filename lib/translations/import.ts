import type { AppDatabase } from "@/lib/database/types";
import { insertPreparedRows } from "@/lib/database/bulk-insert";
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
    await insertPreparedRows(
      tx,
      "INSERT INTO translation_active (surah, ayah, text) VALUES (?, ?, ?)",
      data.map((row: { surah: number; ayah: number; text: string }) => [row.surah, row.ayah, row.text]),
    );
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Translation] ${langCode} import done in ${elapsed}s`);
}
