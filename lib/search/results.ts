export type TextResult = {
  surah: number;
  ayah: number;
  text_uthmani: string;
  text_en: string | null;
  name_arabic: string;
  name_english: string;
};

export type RootOccurrence = {
  surah: number;
  ayah: number;
  word_pos: number;
  word_text: string;
  root: string;
  lemma: string;
  text_uthmani: string;
  name_arabic: string;
  name_english: string;
};

export type LemmaGroup = {
  lemma: string;
  occurrences: RootOccurrence[];
};

export function groupRootResults(rows: readonly RootOccurrence[]): LemmaGroup[] {
  const lemmaMap = new Map<string, RootOccurrence[]>();
  for (const row of rows) {
    const key = row.lemma || row.word_text;
    const occurrences = lemmaMap.get(key);
    if (occurrences) occurrences.push(row);
    else lemmaMap.set(key, [row]);
  }

  const groups: LemmaGroup[] = [];
  for (const [lemma, occurrences] of lemmaMap) {
    groups.push({ lemma, occurrences });
  }
  groups.sort((a, b) => b.occurrences.length - a.occurrences.length);
  return groups;
}

export function groupTextResults(textResults: readonly TextResult[]) {
  const groups: { surah: number; nameArabic: string; nameEnglish: string; results: TextResult[] }[] = [];
  let currentSurah = -1;

  for (const r of textResults) {
    if (r.surah !== currentSurah) {
      currentSurah = r.surah;
      groups.push({
        surah: r.surah,
        nameArabic: r.name_arabic,
        nameEnglish: r.name_english,
        results: [],
      });
    }
    groups[groups.length - 1].results.push(r);
  }

  return groups;
}
