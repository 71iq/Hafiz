/**
 * Verse hide mode keeps revealed ayahs in reader memory, keyed "surah:ayah" with the ayah's page.
 * Nothing here is persisted or touches Hifz records.
 */
export type VerseReveals = ReadonlyMap<string, number>;

export const NO_VERSE_REVEALS: VerseReveals = new Map();

/** Reveals or re-hides one ayah; returns the same map when nothing changes. */
export function setVerseReveal(
  reveals: VerseReveals,
  surah: number,
  ayah: number,
  page: number,
  revealed: boolean,
): VerseReveals {
  const key = `${surah}:${ayah}`;
  if (revealed === reveals.has(key)) return reveals;
  const next = new Map(reveals);
  if (revealed) next.set(key, page);
  else next.delete(key);
  return next;
}

/**
 * When a deliberate scroll or jump makes another page current, only that page's reveals stay.
 * A same-page jump or view switch keeps the map unchanged.
 */
export function keepPageReveals(reveals: VerseReveals, page: number): VerseReveals {
  if (reveals.size === 0) return reveals;
  const kept = new Map([...reveals].filter(([, revealPage]) => revealPage === page));
  return kept.size === reveals.size ? reveals : kept;
}
