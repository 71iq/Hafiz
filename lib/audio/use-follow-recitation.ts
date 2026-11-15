import { useCallback, useEffect, useRef, useState } from "react";
import type { AyahAudioTarget } from "@/lib/audio/ayah-audio";

type Options = {
  /** The saved Follow recitation preference. */
  followEnabled: boolean;
  /** A range recitation is running. Single ayahs are never followed. */
  rangeActive: boolean;
  /** The range ayah being recited, or null. */
  recitingAyah: AyahAudioTarget | null;
  /** Brings an ayah into view. */
  follow: (target: AyahAudioTarget) => void;
};

/**
 * Keeps the reader on the recited range ayah. A manual scroll, page turn or explicit jump suspends
 * following for the rest of that recitation without stopping it; Back to ayah recenters and resumes.
 * The suspension lives in memory only and is separate from the saved preference.
 */
export function useFollowRecitation({ followEnabled, rangeActive, recitingAyah, follow }: Options) {
  const [suspended, setSuspended] = useState(false);
  const suspendedRef = useRef(false);
  const followRef = useRef(follow);
  followRef.current = follow;
  const stateRef = useRef({ followEnabled, rangeActive, recitingAyah });
  stateRef.current = { followEnabled, rangeActive, recitingAyah };

  const setSuspendedBoth = useCallback((next: boolean) => {
    suspendedRef.current = next;
    setSuspended(next);
  }, []);

  // A new recitation starts unsuspended.
  useEffect(() => {
    if (!rangeActive) setSuspendedBoth(false);
  }, [rangeActive, setSuspendedBoth]);

  // Only an actual change of recited ayah moves the reader.
  const recitingKey = recitingAyah ? `${recitingAyah.surah}:${recitingAyah.ayah}` : null;
  useEffect(() => {
    const { followEnabled: enabled, recitingAyah: target } = stateRef.current;
    if (!recitingKey || !target || !enabled || suspendedRef.current) return;
    followRef.current(target);
  }, [recitingKey]);

  // Turning the preference on recenters deliberately; turning it off simply stops following.
  const previousEnabledRef = useRef(followEnabled);
  useEffect(() => {
    const wasEnabled = previousEnabledRef.current;
    previousEnabledRef.current = followEnabled;
    if (!followEnabled || wasEnabled) return;
    setSuspendedBoth(false);
    const { rangeActive: active, recitingAyah: target } = stateRef.current;
    if (active && target) followRef.current(target);
  }, [followEnabled, setSuspendedBoth]);

  /** The reader scrolled, paged or jumped on purpose while a followed range recites. */
  const suspend = useCallback(() => {
    const { followEnabled: enabled, rangeActive: active } = stateRef.current;
    if (!enabled || !active || suspendedRef.current) return;
    setSuspendedBoth(true);
  }, [setSuspendedBoth]);

  const backToAyah = useCallback(() => {
    setSuspendedBoth(false);
    const target = stateRef.current.recitingAyah;
    if (target) followRef.current(target);
  }, [setSuspendedBoth]);

  return { suspended: suspended && rangeActive, suspend, backToAyah };
}
