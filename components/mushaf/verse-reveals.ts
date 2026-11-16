export type VerseReveals = ReadonlyMap<string, number>;

export const NO_VERSE_REVEALS: VerseReveals = new Map();

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

export function keepPageReveals(reveals: VerseReveals, page: number): VerseReveals {
  if (reveals.size === 0) return reveals;
  const kept = new Map([...reveals].filter(([, revealPage]) => revealPage === page));
  return kept.size === reveals.size ? reveals : kept;
}
