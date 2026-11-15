import { formatAyahRef } from "@/lib/arabic";
import type { AudioFailure } from "@/lib/audio/ayah-audio";

export type SurahNames = { en: string; ar: string };

/** "Al-Baqarah 2:255" in English, "البقرة ٢:٢٥٥" in Arabic; just the reference while the name loads. */
export function formatAudioReference(
  language: "en" | "ar",
  names: SurahNames | null,
  surah: number,
  ayah: number,
): string {
  const ref = formatAyahRef(language === "ar", surah, ayah);
  const name = names ? (language === "ar" ? names.ar : names.en).trim() : "";
  return name ? `${name} ${ref}` : ref;
}

type FailureStrings = {
  audioNeedsInternet: string;
  audioSourceUnavailable: string;
  audioPlaybackFailed: string;
};

/** One message per failure kind, so offline, a missing source and a failed player read differently. */
export function audioFailureMessage(failure: AudioFailure, s: FailureStrings): string {
  if (failure === "offline") return s.audioNeedsInternet;
  if (failure === "unavailable") return s.audioSourceUnavailable;
  return s.audioPlaybackFailed;
}
