import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  type QfAudioResponse,
  type QfContentErrorCode,
} from "@/lib/quran-foundation/content";

export type AyahAudioTarget = {
  surah: number;
  ayah: number;
};

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

export type PlayRangeOptions = {
  ayahs: AyahAudioTarget[];
  recitationId?: number;
  repeatRange?: number;
  repeatEachAyah?: number;
  delayMs?: number;
};

export type RangeAudioState = {
  active: boolean;
  playing: boolean;
  loading: boolean;
  currentAyah: AyahAudioTarget | null;
  currentIndex: number;
  totalAyahs: number;
  repeatRangeIndex: number;
  repeatRange: number;
  repeatEachAyahIndex: number;
  repeatEachAyah: number;
};

type LoadedAudio = QfAudioResponse & { isStale?: boolean };
type PlaybackMode = "single" | "range" | "word";

type RangeSession = {
  ayahs: AyahAudioTarget[];
  recitationId: number;
  repeatRange: number;
  repeatEachAyah: number;
  delayMs: number;
  index: number;
  rangeRepeatIndex: number;
  ayahRepeatIndex: number;
};

type AyahAudioContextType = {
  getAyahState: (surah: number, ayah: number, recitationId?: number) => AyahAudioState;
  toggleAyah: (surah: number, ayah: number, recitationId?: number) => Promise<ToggleResult>;
  playRange: (options: PlayRangeOptions) => Promise<ToggleResult>;
  playWord: (surah: number, ayah: number, wordPos: number, recitationId?: number) => Promise<ToggleResult>;
  rangeState: RangeAudioState;
  stop: () => void;
};

const AyahAudioContext = createContext<AyahAudioContextType | null>(null);
const INACTIVE_RANGE_STATE: RangeAudioState = {
  active: false,
  playing: false,
  loading: false,
  currentAyah: null,
  currentIndex: 0,
  totalAyahs: 0,
  repeatRangeIndex: 0,
  repeatRange: 1,
  repeatEachAyahIndex: 0,
  repeatEachAyah: 1,
};

export function AyahAudioProvider({ children }: { children: React.ReactNode }) {
  const db = useDatabase();
  const player = useAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: false });
  const status = useAudioPlayerStatus(player);
  const [activeAyah, setActiveAyah] = useState<ActiveAyah | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [rangePlayback, setRangePlayback] = useState<RangeAudioState>(INACTIVE_RANGE_STATE);
  const playbackModeRef = useRef<PlaybackMode | null>(null);
  const rangeSessionRef = useRef<RangeSession | null>(null);
  const rangeDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const clearRangeDelayTimer = useCallback(() => {
    if (!rangeDelayTimerRef.current) return;
    clearTimeout(rangeDelayTimerRef.current);
    rangeDelayTimerRef.current = null;
  }, []);

  const clearWordTimer = useCallback(() => {
    if (!wordTimerRef.current) return;
    clearTimeout(wordTimerRef.current);
    wordTimerRef.current = null;
  }, []);

  const clearRangeSession = useCallback(() => {
    clearRangeDelayTimer();
    rangeSessionRef.current = null;
    if (playbackModeRef.current === "range") playbackModeRef.current = null;
    setRangePlayback(INACTIVE_RANGE_STATE);
  }, [clearRangeDelayTimer]);

  const loadAyahAudio = useCallback(
    async (surah: number, ayah: number, recitationId: number): Promise<LoadedAudio | { ok: false; code: QfContentErrorCode }> => {
      const cached = await readCachedAyahAudio(db, surah, ayah, recitationId).catch((error) => {
        console.warn("[AyahAudio] Cache read failed:", error);
        return null;
      });

      if (cached) {
        if (cached.isStale) {
          refreshAudioCache(db, surah, ayah, recitationId);
        }
        return cached;
      }

      const response = await fetchQfAyahAudio(surah, ayah, recitationId);
      if (!response.ok) return response;

      await writeCachedAyahAudio(db, response, surah, ayah).catch((error) => {
        console.warn("[AyahAudio] Cache write failed:", error);
      });
      return response;
    },
    [db]
  );

  const playAyahFromSource = useCallback(
    async (
      surah: number,
      ayah: number,
      recitationId: number,
      mode: PlaybackMode,
      shouldPlay?: () => boolean
    ): Promise<ToggleResult> => {
      const key = makeKey(surah, ayah, recitationId);
      player.pause();
      setActiveAyah({ surah, ayah, recitationId });
      setLoadingKey(key);

      const response = await loadAyahAudio(surah, ayah, recitationId);
      if (!response.ok) {
        setLoadingKey(null);
        if (mode !== "range") setActiveAyah(null);
        return { ok: false, code: response.code };
      }

      if (shouldPlay && !shouldPlay()) {
        setLoadingKey(null);
        if (mode !== "range") setActiveAyah(null);
        return { ok: true };
      }

      playbackModeRef.current = mode;
      playUrl(player, response.audio.url);
      setLoadingKey(null);
      return { ok: true };
    },
    [loadAyahAudio, player]
  );

  const playCurrentRangeAyah = useCallback(async (): Promise<ToggleResult> => {
    const session = rangeSessionRef.current;
    const target = session?.ayahs[session.index];
    if (!session || !target) return { ok: false, code: "bad_request" };

    setRangePlayback({
      active: true,
      playing: false,
      loading: true,
      currentAyah: target,
      currentIndex: session.index,
      totalAyahs: session.ayahs.length,
      repeatRangeIndex: session.rangeRepeatIndex,
      repeatRange: session.repeatRange,
      repeatEachAyahIndex: session.ayahRepeatIndex,
      repeatEachAyah: session.repeatEachAyah,
    });

    const result = await playAyahFromSource(
      target.surah,
      target.ayah,
      session.recitationId,
      "range",
      () => rangeSessionRef.current === session
    );
    if (!rangeSessionRef.current) return result;
    if (!result.ok) {
      clearRangeSession();
      setActiveAyah(null);
      return result;
    }

    setRangePlayback((prev) => ({ ...prev, active: true, loading: false }));
    return { ok: true };
  }, [clearRangeSession, playAyahFromSource]);

  const advanceRange = useCallback(() => {
    const session = rangeSessionRef.current;
    if (!session) return;

    if (session.ayahRepeatIndex < session.repeatEachAyah) {
      session.ayahRepeatIndex += 1;
    } else if (session.index + 1 < session.ayahs.length) {
      session.index += 1;
      session.ayahRepeatIndex = 1;
    } else if (session.rangeRepeatIndex < session.repeatRange) {
      session.index = 0;
      session.ayahRepeatIndex = 1;
      session.rangeRepeatIndex += 1;
    } else {
      clearRangeSession();
      setActiveAyah(null);
      setLoadingKey(null);
      return;
    }

    clearRangeDelayTimer();
    rangeDelayTimerRef.current = setTimeout(() => {
      void playCurrentRangeAyah().catch((error) => {
        console.warn("[AyahAudio] Range playback failed:", error);
        clearRangeSession();
        setActiveAyah(null);
        setLoadingKey(null);
      });
    }, session.delayMs);
  }, [clearRangeDelayTimer, clearRangeSession, playCurrentRangeAyah]);

  useEffect(() => {
    if (!status.didJustFinish) return;

    if (playbackModeRef.current === "range" && rangeSessionRef.current) {
      advanceRange();
      return;
    }

    clearWordTimer();
    playbackModeRef.current = null;
    setActiveAyah(null);
    setLoadingKey(null);
  }, [advanceRange, clearWordTimer, status.didJustFinish]);

  const stop = useCallback(() => {
    clearRangeSession();
    clearWordTimer();
    playbackModeRef.current = null;
    player.pause();
    setActiveAyah(null);
    setLoadingKey(null);
  }, [clearRangeSession, clearWordTimer, player]);

  useEffect(
    () => () => {
      clearRangeDelayTimer();
      clearWordTimer();
    },
    [clearRangeDelayTimer, clearWordTimer]
  );

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
      clearRangeSession();
      clearWordTimer();
      const key = makeKey(surah, ayah, recitationId);
      const isSameAyah =
        activeAyah?.surah === surah &&
        activeAyah.ayah === ayah &&
        activeAyah.recitationId === recitationId;

      if (isSameAyah && status.playing) {
        playbackModeRef.current = "single";
        player.pause();
        return { ok: true };
      }

      if (isSameAyah && status.isLoaded && !status.playing) {
        playbackModeRef.current = "single";
        if (status.didJustFinish) {
          await player.seekTo(0).catch(console.warn);
        }
        player.play();
        return { ok: true };
      }

      playbackModeRef.current = "single";
      setLoadingKey(key);
      return playAyahFromSource(surah, ayah, recitationId, "single");
    },
    [
      activeAyah,
      clearRangeSession,
      clearWordTimer,
      playAyahFromSource,
      player,
      status.didJustFinish,
      status.isLoaded,
      status.playing,
    ]
  );

  const playRange = useCallback(
    async ({
      ayahs,
      recitationId = QF_DEFAULT_RECITATION_ID,
      repeatRange = 1,
      repeatEachAyah = 1,
      delayMs = 0,
    }: PlayRangeOptions): Promise<ToggleResult> => {
      if (ayahs.length === 0) return { ok: false, code: "bad_request" };
      clearRangeSession();
      clearWordTimer();
      player.pause();

      rangeSessionRef.current = {
        ayahs,
        recitationId,
        repeatRange: clampPositiveInt(repeatRange, 1, 99),
        repeatEachAyah: clampPositiveInt(repeatEachAyah, 1, 99),
        delayMs: clampPositiveInt(delayMs, 0, 30000),
        index: 0,
        rangeRepeatIndex: 1,
        ayahRepeatIndex: 1,
      };

      return playCurrentRangeAyah();
    },
    [clearRangeSession, clearWordTimer, playCurrentRangeAyah, player]
  );

  const playWord = useCallback(
    async (surah: number, ayah: number, wordPos: number, recitationId = QF_DEFAULT_RECITATION_ID): Promise<ToggleResult> => {
      clearRangeSession();
      clearWordTimer();

      const key = makeKey(surah, ayah, recitationId);
      player.pause();
      setActiveAyah({ surah, ayah, recitationId });
      setLoadingKey(key);

      const response = await loadAyahAudio(surah, ayah, recitationId);
      if (!response.ok) {
        setLoadingKey(null);
        setActiveAyah(null);
        return { ok: false, code: response.code };
      }

      const segment = findWordSegment(response.audio.segments, wordPos);
      if (!segment) {
        setLoadingKey(null);
        setActiveAyah(null);
        return { ok: false, code: "upstream" };
      }

      playbackModeRef.current = "word";
      player.replace({ uri: response.audio.url });
      await player.seekTo(segment.startMs / 1000).catch(console.warn);
      player.play();
      setLoadingKey(null);

      wordTimerRef.current = setTimeout(() => {
        player.pause();
        playbackModeRef.current = null;
        setActiveAyah(null);
        setLoadingKey(null);
      }, Math.max(250, segment.endMs - segment.startMs + 90));

      return { ok: true };
    },
    [clearRangeSession, clearWordTimer, loadAyahAudio, player]
  );

  const rangeState = useMemo<RangeAudioState>(
    () => ({
      ...rangePlayback,
      playing: rangePlayback.active && status.playing,
    }),
    [rangePlayback, status.playing]
  );

  const value = useMemo(
    () => ({
      getAyahState,
      toggleAyah,
      playRange,
      playWord,
      rangeState,
      stop,
    }),
    [getAyahState, playRange, playWord, rangeState, stop, toggleAyah]
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

function clampPositiveInt(value: number, min: number, max: number): number {
  const next = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, next));
}

function findWordSegment(segments: unknown, wordPos: number): { startMs: number; endMs: number } | null {
  if (!Array.isArray(segments)) return null;
  for (const segment of segments) {
    const parsed = parseWordSegment(segment);
    if (parsed?.wordPos === wordPos) return parsed;
  }
  const fallback = parseWordSegment(segments[wordPos - 1]);
  return fallback ? { startMs: fallback.startMs, endMs: fallback.endMs } : null;
}

function parseWordSegment(segment: unknown): { wordPos: number; startMs: number; endMs: number } | null {
  if (Array.isArray(segment)) {
    const values = segment.map((value) => Number(value));
    if (values.length >= 4 && values.every(Number.isFinite)) {
      return normalizeSegment(values[1], values[2], values[3]);
    }
    if (values.length >= 3 && values.every(Number.isFinite)) {
      return normalizeSegment(values[0], values[1], values[2]);
    }
    return null;
  }

  if (!segment || typeof segment !== "object") return null;
  const row = segment as Record<string, unknown>;
  const wordPos =
    numberFromUnknown(row.word_position) ??
    numberFromUnknown(row.wordPosition) ??
    numberFromUnknown(row.word_number) ??
    numberFromUnknown(row.wordNumber) ??
    numberFromUnknown(row.position);
  const start =
    numberFromUnknown(row.timestamp_from) ??
    numberFromUnknown(row.timestampFrom) ??
    numberFromUnknown(row.start_ms) ??
    numberFromUnknown(row.startMs) ??
    numberFromUnknown(row.start);
  const end =
    numberFromUnknown(row.timestamp_to) ??
    numberFromUnknown(row.timestampTo) ??
    numberFromUnknown(row.end_ms) ??
    numberFromUnknown(row.endMs) ??
    numberFromUnknown(row.end);
  if (wordPos == null || start == null || end == null) return null;
  return normalizeSegment(wordPos, start, end);
}

function normalizeSegment(wordPos: number, startMs: number, endMs: number): { wordPos: number; startMs: number; endMs: number } | null {
  if (!Number.isFinite(wordPos) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (wordPos < 1 || endMs <= startMs) return null;
  return { wordPos: Math.round(wordPos), startMs: Math.max(0, startMs), endMs };
}

function numberFromUnknown(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
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
