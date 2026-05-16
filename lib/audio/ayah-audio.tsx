import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import {
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  type AudioPlayer,
} from "expo-audio";
import type { SQLiteDatabase } from "expo-sqlite";
import { useDatabase } from "@/lib/database/provider";
import {
  readCachedAyahAudio,
  writeCachedAyahAudio,
} from "@/lib/quran-foundation/cache";
import {
  fetchQfAyahAudio,
  QF_DEFAULT_RECITATION_ID,
  type QfContentErrorCode,
} from "@/lib/quran-foundation/content";

type ActiveAyah = {
  surah: number;
  ayah: number;
  recitationId: number;
};

type AyahAudioState = {
  active: boolean;
  playing: boolean;
  loading: boolean;
};

type ToggleResult = {
  ok: boolean;
  code?: QfContentErrorCode;
};

type AyahAudioContextType = {
  getAyahState: (surah: number, ayah: number, recitationId?: number) => AyahAudioState;
  toggleAyah: (surah: number, ayah: number, recitationId?: number) => Promise<ToggleResult>;
  stop: () => void;
};

const AyahAudioContext = createContext<AyahAudioContextType | null>(null);

export function AyahAudioProvider({ children }: { children: React.ReactNode }) {
  const db = useDatabase();
  const player = useAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: false });
  const status = useAudioPlayerStatus(player);
  const [activeAyah, setActiveAyah] = useState<ActiveAyah | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    }).catch(console.warn);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setIsAudioActiveAsync(true).catch(console.warn);
        return;
      }
      player.pause();
      setIsAudioActiveAsync(false).catch(console.warn);
    });
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    if (!status.didJustFinish) return;
    setActiveAyah(null);
    setLoadingKey(null);
  }, [status.didJustFinish]);

  const stop = useCallback(() => {
    player.pause();
    setActiveAyah(null);
    setLoadingKey(null);
  }, [player]);

  const getAyahState = useCallback(
    (surah: number, ayah: number, recitationId = QF_DEFAULT_RECITATION_ID): AyahAudioState => {
      const key = makeKey(surah, ayah, recitationId);
      const active =
        activeAyah?.surah === surah &&
        activeAyah.ayah === ayah &&
        activeAyah.recitationId === recitationId;
      return {
        active,
        playing: active && status.playing,
        loading: loadingKey === key,
      };
    },
    [activeAyah, loadingKey, status.playing]
  );

  const toggleAyah = useCallback(
    async (surah: number, ayah: number, recitationId = QF_DEFAULT_RECITATION_ID): Promise<ToggleResult> => {
      const key = makeKey(surah, ayah, recitationId);
      const isSameAyah =
        activeAyah?.surah === surah &&
        activeAyah.ayah === ayah &&
        activeAyah.recitationId === recitationId;

      if (isSameAyah && status.playing) {
        player.pause();
        return { ok: true };
      }

      if (isSameAyah && status.isLoaded && !status.playing) {
        if (status.didJustFinish) {
          await player.seekTo(0).catch(console.warn);
        }
        player.play();
        return { ok: true };
      }

      player.pause();
      setActiveAyah({ surah, ayah, recitationId });
      setLoadingKey(key);

      const cached = await readCachedAyahAudio(db, surah, ayah, recitationId).catch((error) => {
        console.warn("[AyahAudio] Cache read failed:", error);
        return null;
      });

      if (cached) {
        playUrl(player, cached.audio.url);
        setLoadingKey(null);
        if (cached.isStale) {
          refreshAudioCache(db, surah, ayah, recitationId);
        }
        return { ok: true };
      }

      const response = await fetchQfAyahAudio(surah, ayah, recitationId);
      if (!response.ok) {
        setLoadingKey(null);
        setActiveAyah(null);
        return { ok: false, code: response.code };
      }

      await writeCachedAyahAudio(db, response, surah, ayah).catch((error) => {
        console.warn("[AyahAudio] Cache write failed:", error);
      });
      playUrl(player, response.audio.url);
      setLoadingKey(null);
      return { ok: true };
    },
    [activeAyah, db, player, status.didJustFinish, status.isLoaded, status.playing]
  );

  const value = useMemo(
    () => ({
      getAyahState,
      toggleAyah,
      stop,
    }),
    [getAyahState, toggleAyah, stop]
  );

  return <AyahAudioContext.Provider value={value}>{children}</AyahAudioContext.Provider>;
}

export function useAyahAudio() {
  const ctx = useContext(AyahAudioContext);
  if (!ctx) {
    throw new Error("useAyahAudio must be used within AyahAudioProvider");
  }
  return ctx;
}

function makeKey(surah: number, ayah: number, recitationId: number): string {
  return `${recitationId}:${surah}:${ayah}`;
}

function playUrl(player: AudioPlayer, url: string) {
  player.replace({ uri: url });
  player.play();
}

function refreshAudioCache(db: SQLiteDatabase, surah: number, ayah: number, recitationId: number) {
  fetchQfAyahAudio(surah, ayah, recitationId)
    .then((response) => {
      if (response.ok) {
        return writeCachedAyahAudio(db, response, surah, ayah);
      }
    })
    .catch(console.warn);
}
