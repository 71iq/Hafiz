/**
 * Per-ayah recitation files on the public Quran audio CDNs, which need no account or API key.
 * Paths match what the public quran.com v4 API reports for each recitation id (checked 2026-11-12);
 * three recitations are served from the quranicaudio EveryAyah mirror instead.
 */
const VERSES_CDN = "https://verses.quran.foundation";
const EVERYAYAH_MIRROR = "https://mirrors.quranicaudio.com/everyayah";

const RECITATION_FOLDERS: Record<number, string> = {
  1: `${VERSES_CDN}/AbdulBaset/Mujawwad/mp3`,
  2: `${VERSES_CDN}/AbdulBaset/Murattal/mp3`,
  3: `${VERSES_CDN}/Sudais/mp3`,
  4: `${VERSES_CDN}/Shatri/mp3`,
  5: `${VERSES_CDN}/Rifai/mp3`,
  6: `${EVERYAYAH_MIRROR}/Husary_64kbps`,
  7: `${VERSES_CDN}/Alafasy/mp3`,
  8: `${VERSES_CDN}/Minshawi/Mujawwad/mp3`,
  9: `${VERSES_CDN}/Minshawi/Murattal/mp3`,
  10: `${VERSES_CDN}/Shuraym/mp3`,
  11: `${EVERYAYAH_MIRROR}/Mohammad_al_Tablaway_128kbps`,
  12: `${EVERYAYAH_MIRROR}/Husary_Muallim_128kbps`,
};

/** The public file for an ayah, or null when the recitation has no known public folder. */
export function publicAyahAudioUrl(recitationId: number, surah: number, ayah: number): string | null {
  const folder = RECITATION_FOLDERS[recitationId];
  if (!folder) return null;
  if (!Number.isInteger(surah) || !Number.isInteger(ayah) || surah < 1 || surah > 114 || ayah < 1) return null;
  return `${folder}/${String(surah).padStart(3, "0")}${String(ayah).padStart(3, "0")}.mp3`;
}

export function hasPublicAyahAudio(recitationId: number): boolean {
  return recitationId in RECITATION_FOLDERS;
}
