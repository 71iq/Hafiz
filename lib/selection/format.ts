export function formatForCopy(
  text: string,
  surahName: string,
  surah: number,
  ayahStart: number,
  ayahEnd: number,
): string {
  const ref = ayahStart === ayahEnd
    ? `[${surahName} : ${ayahStart}]`
    : `[${surahName} : ${ayahStart}-${ayahEnd}]`;

  return `"${text.trim()}"\n${ref}\nhafiz://open?surah=${surah}&ayah=${ayahStart}`;
}
