import { useCallback, useEffect, useRef, useState } from "react";
import type { AyahAudioTarget } from "@/lib/audio/ayah-audio";

type Options = {
  followEnabled: boolean;
  rangeActive: boolean;
  recitingAyah: AyahAudioTarget | null;
  follow: (target: AyahAudioTarget) => void;
};

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

  useEffect(() => {
    if (!rangeActive) setSuspendedBoth(false);
  }, [rangeActive, setSuspendedBoth]);

  const recitingKey = recitingAyah ? `${recitingAyah.surah}:${recitingAyah.ayah}` : null;
  useEffect(() => {
    const { followEnabled: enabled, recitingAyah: target } = stateRef.current;
    if (!recitingKey || !target || !enabled || suspendedRef.current) return;
    followRef.current(target);
  }, [recitingKey]);

  const previousEnabledRef = useRef(followEnabled);
  useEffect(() => {
    const wasEnabled = previousEnabledRef.current;
    previousEnabledRef.current = followEnabled;
    if (!followEnabled || wasEnabled) return;
    setSuspendedBoth(false);
    const { rangeActive: active, recitingAyah: target } = stateRef.current;
    if (active && target) followRef.current(target);
  }, [followEnabled, setSuspendedBoth]);

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
