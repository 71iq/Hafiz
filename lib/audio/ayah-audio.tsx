import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  type AudioPlayer,
} from "expo-audio";
import type { DatabaseExecutor } from "@/lib/database/types";
import { useDatabase } from "@/lib/database/provider";
import { useAuthStore } from "@/lib/auth/store";
import { isDefinitelyOffline } from "@/lib/audio/connectivity";
import { formatAudioReference, type AudioFailure, type SurahNames } from "@/lib/audio/labels";
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
import { getReciterById } from "@/lib/quran-foundation/recitations";
import { useSettings } from "@/lib/settings/context";

export type AyahAudioTarget = {
  surah: number;
  ayah: number;
};

/** Why a recitation could not play: no connection, no file for this ayah/reciter, or the player failed. */
export type { AudioFailure } from "@/lib/audio/labels";

export type AudioSessionKind = "single" | "range" | "preview";
export type AudioSessionStatus = "loading" | "playing" | "paused" | "error";

/** The one playback the app has: a single ayah, a range or a reciter preview. */
export type AudioSessionState = {
  kind: AudioSessionKind;
  target: AyahAudioTarget;
  recitationId: number;
  status: AudioSessionStatus;
  failure: AudioFailure | null;
  surahNames: SurahNames | null;
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

export type ToggleResult = {
  ok: boolean;
  code?: QfContentErrorCode;
  /** "busy": a reciter preview was refused because a recitation is running. */
  failure?: AudioFailure | "busy";
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
  /** The reader paused the range; it resumes where it stopped. */
  paused: boolean;
  loading: boolean;
  currentAyah: AyahAudioTarget | null;
  currentIndex: number;
  totalAyahs: number;
  repeatRangeIndex: number;
  repeatRange: number;
  repeatEachAyahIndex: number;
  repeatEachAyah: number;
};

/** A source lookup or player load that takes longer than this fails with Retry instead of spinning. */
export const AUDIO_LOAD_TIMEOUT_MS = 15_000;
/** A reciter preview plays at most this long. */
export const RECITER_PREVIEW_LIMIT_MS = 10_000;
/** Reciter previews play Al-Fatihah 1. */
export const RECITER_PREVIEW_TARGET: AyahAudioTarget = { surah: 1, ayah: 1 };
/** How long a stop from outside the app must last before a range counts as paused. */
const EXTERNAL_PAUSE_SETTLE_MS = 800;

type LoadedAudio = QfAudioResponse & { isStale?: boolean };
type PlaybackMode = "single" | "range" | "preview";

type RangeSession = {
  ayahs: AyahAudioTarget[];
  recitationId: number;
  repeatRange: number;
  repeatEachAyah: number;
  delayMs: number;
  index: number;
  rangeRepeatIndex: number;
  ayahRepeatIndex: number;
  paused: boolean;
  /** Paused between ayahs or while loading: resuming loads the current ayah instead of playing on. */
  resumeLoadsAyah: boolean;
};

type SessionCore = {
  kind: AudioSessionKind;
  target: AyahAudioTarget;
  recitationId: number;
  loading: boolean;
  failure: AudioFailure | null;
  surahNames: SurahNames | null;
};

/** One in-flight load. Its generation must still be current for any of its results to apply. */
type PendingLoad = {
  gen: number;
  kind: AudioSessionKind;
  phase: "source" | "player";
  /** Native ranges hand off to the player immediately. Web starts wait for the media to play. */
  settleOnDispatch: boolean;
  settled: boolean;
  settle: (result: ToggleResult) => void;
};

type AyahAudioContextType = {
  getAyahState: (surah: number, ayah: number, recitationId?: number) => AyahAudioState;
  toggleAyah: (surah: number, ayah: number, recitationId?: number) => Promise<ToggleResult>;
  playRange: (options: PlayRangeOptions) => Promise<ToggleResult>;
  rangeState: RangeAudioState;
  /** The current single, range or preview playback, or null when nothing plays. */
  session: AudioSessionState | null;
  /** A single ayah or range is loaded, playing, paused or failed; reciter previews wait for it. */
  mainActive: boolean;
  stop: () => void;
  /** Pauses or resumes whatever is playing, keeping a range session where it is. */
  togglePause: () => void;
  /** Runs the failed request again: the same ayah, or the range from the ayah that failed. */
  retry: () => Promise<ToggleResult>;
  /** Plays Al-Fatihah 1 in this recitation for at most ten seconds, unless a recitation is running. */
  previewReciter: (recitationId: number) => Promise<ToggleResult>;
  /** Stops a reciter preview; leaves any other playback alone. */
  stopPreview: () => void;
};

const AyahAudioContext = createContext<AyahAudioContextType | null>(null);
const INACTIVE_RANGE_STATE: RangeAudioState = {
  active: false,
  playing: false,
  paused: false,
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
  const { uiLanguage } = useSettings();
  const accountId = useAuthStore((state) => state.user?.id ?? null);
  const player = useAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: false });
  const status = useAudioPlayerStatus(player);
  const releaseLockScreen = useCallback(() => {
    try {
      player.setActiveForLockScreen(false);
    } catch {
      // Lock screen controls were never active.
    }
  }, [player]);
  const [activeAyah, setActiveAyah] = useState<ActiveAyah | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [rangePlayback, setRangePlayback] = useState<RangeAudioState>(INACTIVE_RANGE_STATE);
  const [core, setCoreState] = useState<SessionCore | null>(null);
  const coreRef = useRef<SessionCore | null>(null);
  const playbackModeRef = useRef<PlaybackMode | null>(null);
  const rangeSessionRef = useRef<RangeSession | null>(null);
  const rangeDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const pendingRef = useRef<PendingLoad | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surahNamesRef = useRef(new Map<number, SurahNames>());
  const advanceCountRef = useRef(0);
  const statusPlayingRef = useRef(false);
  statusPlayingRef.current = status.playing;
  const languageRef = useRef(uiLanguage);
  languageRef.current = uiLanguage;

  const setCore = useCallback((next: SessionCore | null | ((prev: SessionCore | null) => SessionCore | null)) => {
    const value = typeof next === "function" ? next(coreRef.current) : next;
    coreRef.current = value;
    setCoreState(value);
  }, []);

  useEffect(() => {
    // Recitation keeps playing with the screen off or another app in front, as listeners expect; the
    // lock screen controls keep Android's foreground service alive past its 3 minute limit.
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    }).catch(console.warn);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") setIsAudioActiveAsync(true).catch(console.warn);
    });
    return () => subscription.remove();
  }, []);

  const clearRangeDelayTimer = useCallback(() => {
    if (!rangeDelayTimerRef.current) return;
    clearTimeout(rangeDelayTimerRef.current);
    rangeDelayTimerRef.current = null;
  }, []);

  const clearLoadTimer = useCallback(() => {
    if (!loadTimerRef.current) return;
    clearTimeout(loadTimerRef.current);
    loadTimerRef.current = null;
  }, []);

  const clearPreviewTimer = useCallback(() => {
    if (!previewTimerRef.current) return;
    clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
  }, []);

  /** Starts a new generation: an older load can no longer start, and its caller hears it was cancelled. */
  const beginGeneration = useCallback(() => {
    generationRef.current += 1;
    playbackModeRef.current = null;
    clearLoadTimer();
    clearPreviewTimer();
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending && !pending.settled) {
      pending.settled = true;
      pending.settle({ ok: true });
    }
    return generationRef.current;
  }, [clearLoadTimer, clearPreviewTimer]);

  const clearRangeSession = useCallback(() => {
    clearRangeDelayTimer();
    rangeSessionRef.current = null;
    if (playbackModeRef.current === "range") playbackModeRef.current = null;
    setRangePlayback(INACTIVE_RANGE_STATE);
  }, [clearRangeDelayTimer]);

  const readSurahNames = useCallback(
    async (surah: number): Promise<SurahNames | null> => {
      const cached = surahNamesRef.current.get(surah);
      if (cached) return cached;
      try {
        const row = await db.getFirstAsync<{ name_english: string; name_arabic: string }>(
          "SELECT name_english, name_arabic FROM surahs WHERE number = ?",
          [surah]
        );
        if (!row) return null;
        const names = { en: row.name_english, ar: row.name_arabic };
        surahNamesRef.current.set(surah, names);
        return names;
      } catch {
        return null;
      }
    },
    [db]
  );

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

  /**
   * Ends the current generation because its load failed. Returns the generation the failure belongs
   * to, or null when a newer request already replaced it. The range session stays, paused, for Retry.
   */
  const cancelForFailure = useCallback(
    (gen: number): number | null => {
      if (gen !== generationRef.current) return null;
      generationRef.current += 1;
      clearLoadTimer();
      clearPreviewTimer();
      playbackModeRef.current = null;
      player.pause();
      releaseLockScreen();
      setLoadingKey(null);
      setActiveAyah(null);
      const range = rangeSessionRef.current;
      if (range) {
        clearRangeDelayTimer();
        range.paused = true;
        range.resumeLoadsAyah = true;
        setRangePlayback((prev) => ({ ...prev, loading: false, paused: true }));
      }
      return generationRef.current;
    },
    [clearLoadTimer, clearPreviewTimer, clearRangeDelayTimer, player, releaseLockScreen]
  );

  const finishFailure = useCallback(
    (failedGen: number, failure: AudioFailure, code?: QfContentErrorCode) => {
      if (failedGen !== generationRef.current) return;
      setCore((prev) => (prev ? { ...prev, loading: false, failure } : prev));
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending && !pending.settled) {
        pending.settled = true;
        pending.settle({ ok: false, failure, code });
      }
    },
    [setCore]
  );

  const failRequest = useCallback(
    async (gen: number, failure: AudioFailure | "detect", code?: QfContentErrorCode) => {
      const failedGen = cancelForFailure(gen);
      if (failedGen === null) return;
      const resolved = failure === "detect" ? ((await isDefinitelyOffline()) ? "offline" : "playback") : failure;
      finishFailure(failedGen, resolved, code);
    },
    [cancelForFailure, finishFailure]
  );

  const showLockScreen = useCallback(
    (target: AyahAudioTarget, recitationId: number, names: SurahNames | null) => {
      const language = languageRef.current;
      const reciter = getReciterById(recitationId);
      try {
        player.setActiveForLockScreen(true, {
          title: formatAudioReference(language, names, target.surah, target.ayah),
          artist: language === "ar" ? reciter.nameAr : reciter.nameEn,
          albumTitle: "Hafiz",
        });
      } catch (error) {
        console.warn("[AyahAudio] Lock screen controls unavailable:", error);
      }
    },
    [player]
  );

  const runSource = useCallback(
    async (gen: number, kind: AudioSessionKind, target: AyahAudioTarget, recitationId: number) => {
      try {
        // Recitation streams from the network; the cached lookup is only the file's address.
        if (await isDefinitelyOffline()) {
          await failRequest(gen, "offline");
          return;
        }
        if (gen !== generationRef.current) return;
        const [response, names] = await Promise.all([
          loadAyahAudio(target.surah, target.ayah, recitationId),
          readSurahNames(target.surah),
        ]);
        if (gen !== generationRef.current) return;
        if (!response.ok) {
          const failure =
            response.code === "not_configured" || response.code === "bad_request" ? "unavailable" : "detect";
          await failRequest(gen, failure, response.code);
          return;
        }
        if (names) setCore((prev) => (prev ? { ...prev, surahNames: names } : prev));
        const pending = pendingRef.current;
        if (!pending || pending.gen !== gen) return;
        pending.phase = "player";
        playbackModeRef.current = kind;
        playUrl(player, response.audio.url);
        if (generationRef.current !== gen) return;
        if (kind !== "preview") showLockScreen(target, recitationId, names);
        if (pending.settleOnDispatch && !pending.settled) {
          pending.settled = true;
          pending.settle({ ok: true });
        }
      } catch (error) {
        console.warn("[AyahAudio] Playback failed:", error);
        await failRequest(gen, "detect");
      }
    },
    [failRequest, loadAyahAudio, player, readSurahNames, setCore, showLockScreen]
  );

  const startRequest = useCallback(
    (kind: AudioSessionKind, target: AyahAudioTarget, recitationId: number, settleOnDispatch: boolean) => {
      const gen = beginGeneration();
      player.pause();
      if (kind === "preview") {
        setActiveAyah(null);
        setLoadingKey(null);
      } else {
        setActiveAyah({ ...target, recitationId });
        setLoadingKey(makeKey(target.surah, target.ayah, recitationId));
      }
      setCore((prev) => ({
        kind,
        target,
        recitationId,
        loading: true,
        failure: null,
        surahNames:
          surahNamesRef.current.get(target.surah) ??
          (prev && prev.target.surah === target.surah ? prev.surahNames : null),
      }));
      const result = new Promise<ToggleResult>((settle) => {
        pendingRef.current = { gen, kind, phase: "source", settleOnDispatch, settled: false, settle };
      });
      loadTimerRef.current = setTimeout(() => {
        loadTimerRef.current = null;
        void failRequest(gen, "detect");
      }, AUDIO_LOAD_TIMEOUT_MS);
      void runSource(gen, kind, target, recitationId);
      return result;
    },
    [beginGeneration, failRequest, player, runSource, setCore]
  );

  const stop = useCallback(() => {
    beginGeneration();
    clearRangeSession();
    playbackModeRef.current = null;
    player.pause();
    releaseLockScreen();
    setActiveAyah(null);
    setLoadingKey(null);
    setCore(null);
  }, [beginGeneration, clearRangeSession, player, releaseLockScreen, setCore]);

  const finishLoad = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending || pending.phase !== "player" || pending.gen !== generationRef.current) return;
    clearLoadTimer();
    pendingRef.current = null;
    setLoadingKey(null);
    setCore((prev) => (prev ? { ...prev, loading: false } : prev));
    setRangePlayback((prev) => (prev.active ? { ...prev, loading: false } : prev));
    if (!pending.settled) {
      pending.settled = true;
      pending.settle({ ok: true });
    }
    if (pending.kind === "preview") {
      clearPreviewTimer();
      const gen = pending.gen;
      previewTimerRef.current = setTimeout(() => {
        previewTimerRef.current = null;
        if (gen === generationRef.current && coreRef.current?.kind === "preview") stop();
      }, RECITER_PREVIEW_LIMIT_MS);
    }
  }, [clearLoadTimer, clearPreviewTimer, setCore, stop]);

  useEffect(() => {
    if (Platform.OS !== "web" && (status.isLoaded || status.playing)) finishLoad();
  }, [finishLoad, status.isLoaded, status.playing]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    // Listen at delivery so a later pause or time update cannot mask a start or failure.
    const subscription = player.addListener("playbackStatusUpdate", (update) => {
      if (!playbackModeRef.current) return;
      if (update.playbackState === "playing") finishLoad();
      if (update.playbackState === "failed") void failRequest(generationRef.current, "detect");
    });
    return () => subscription.remove();
  }, [failRequest, finishLoad, player]);

  const playCurrentRangeAyah = useCallback((): Promise<ToggleResult> => {
    const session = rangeSessionRef.current;
    const target = session?.ayahs[session.index];
    if (!session || !target) return Promise.resolve({ ok: false, code: "bad_request" });

    setRangePlayback({
      active: true,
      playing: false,
      paused: false,
      loading: true,
      currentAyah: target,
      currentIndex: session.index,
      totalAyahs: session.ayahs.length,
      repeatRangeIndex: session.rangeRepeatIndex,
      repeatRange: session.repeatRange,
      repeatEachAyahIndex: session.ayahRepeatIndex,
      repeatEachAyah: session.repeatEachAyah,
    });

    return startRequest("range", target, session.recitationId, Platform.OS !== "web");
  }, [startRequest]);

  const advanceRange = useCallback(() => {
    const session = rangeSessionRef.current;
    if (!session) return;
    advanceCountRef.current += 1;

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
      stop();
      return;
    }

    clearRangeDelayTimer();
    if (session.paused) {
      session.resumeLoadsAyah = true;
      return;
    }
    rangeDelayTimerRef.current = setTimeout(() => {
      rangeDelayTimerRef.current = null;
      void playCurrentRangeAyah();
    }, session.delayMs);
  }, [clearRangeDelayTimer, playCurrentRangeAyah, stop]);

  // Each finished file is handled once, however often this effect re-runs while the flag is still set.
  const finishHandledRef = useRef(false);
  useEffect(() => {
    if (!status.didJustFinish) {
      finishHandledRef.current = false;
      return;
    }
    if (finishHandledRef.current) return;
    finishHandledRef.current = true;

    if (playbackModeRef.current === "range" && rangeSessionRef.current) {
      advanceRange();
      return;
    }
    if (playbackModeRef.current === null) return;
    stop();
  }, [advanceRange, status.didJustFinish, stop]);

  // Headphones unplugged, a call or the lock screen can pause or resume the player outside the app.
  // A range follows that state so its controls and resume stay truthful.
  const prevPlayingRef = useRef(false);
  useEffect(() => {
    const wasPlaying = prevPlayingRef.current;
    prevPlayingRef.current = status.playing;
    const session = rangeSessionRef.current;
    if (!session || pendingRef.current) return;
    if (!wasPlaying && status.playing && session.paused) {
      session.paused = false;
      session.resumeLoadsAyah = false;
      setRangePlayback((prev) => ({ ...prev, paused: false }));
      return;
    }
    if (!wasPlaying || status.playing || status.didJustFinish || session.paused) return;
    // An ayah that ends also stops playing first; only a stop with no advance after it is a pause.
    const advances = advanceCountRef.current;
    const timer = setTimeout(() => {
      if (
        rangeSessionRef.current !== session ||
        session.paused ||
        pendingRef.current ||
        rangeDelayTimerRef.current ||
        advanceCountRef.current !== advances ||
        statusPlayingRef.current
      ) {
        return;
      }
      session.paused = true;
      setRangePlayback((prev) => ({ ...prev, paused: true }));
    }, EXTERNAL_PAUSE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [status.didJustFinish, status.playing]);

  const pauseRange = useCallback(() => {
    const session = rangeSessionRef.current;
    if (!session || session.paused) return;
    session.paused = true;
    // A pending next ayah, or one still loading, starts on resume instead of after the gap.
    if (rangeDelayTimerRef.current || !status.playing || pendingRef.current) session.resumeLoadsAyah = true;
    if (pendingRef.current) {
      // The ayah still loading must not start once it arrives.
      beginGeneration();
      setLoadingKey(null);
      setCore((prev) => (prev ? { ...prev, loading: false } : prev));
    }
    clearRangeDelayTimer();
    player.pause();
    setRangePlayback((prev) => ({ ...prev, paused: true, loading: false }));
  }, [beginGeneration, clearRangeDelayTimer, player, setCore, status.playing]);

  const togglePause = useCallback(() => {
    const session = rangeSessionRef.current;
    if (!session) {
      if (pendingRef.current) {
        stop();
        return;
      }
      if (status.playing) player.pause();
      else if (status.isLoaded) player.play();
      return;
    }
    if (!session.paused) {
      pauseRange();
      return;
    }
    session.paused = false;
    setRangePlayback((prev) => ({ ...prev, paused: false }));
    if (session.resumeLoadsAyah) {
      session.resumeLoadsAyah = false;
      void playCurrentRangeAyah();
      return;
    }
    player.play();
  }, [pauseRange, playCurrentRangeAyah, player, status.isLoaded, status.playing, stop]);

  const retry = useCallback((): Promise<ToggleResult> => {
    const current = coreRef.current;
    if (!current?.failure) return Promise.resolve({ ok: true });
    const range = rangeSessionRef.current;
    if (current.kind === "range" && range) {
      range.paused = false;
      range.resumeLoadsAyah = false;
      return playCurrentRangeAyah();
    }
    return startRequest(current.kind, current.target, current.recitationId, false);
  }, [playCurrentRangeAyah, startRequest]);

  // An answer that arrives after the account changed never starts playing.
  const accountRef = useRef(accountId);
  useEffect(() => {
    if (accountRef.current === accountId) return;
    accountRef.current = accountId;
    if (pendingRef.current) stop();
  }, [accountId, stop]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      clearRangeDelayTimer();
      clearLoadTimer();
      clearPreviewTimer();
    },
    [clearLoadTimer, clearPreviewTimer, clearRangeDelayTimer]
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
      const isSameAyah =
        activeAyah?.surah === surah &&
        activeAyah.ayah === ayah &&
        activeAyah.recitationId === recitationId &&
        !pendingRef.current;

      if (isSameAyah && status.playing) {
        playbackModeRef.current = "single";
        setCore((prev) => (prev ? { ...prev, kind: "single" } : prev));
        player.pause();
        return { ok: true };
      }

      if (isSameAyah && status.isLoaded && !status.playing) {
        playbackModeRef.current = "single";
        setCore((prev) => (prev ? { ...prev, kind: "single" } : prev));
        if (status.didJustFinish) {
          await player.seekTo(0).catch(console.warn);
        }
        player.play();
        return { ok: true };
      }

      return startRequest("single", { surah, ayah }, recitationId, false);
    },
    [
      activeAyah,
      clearRangeSession,
      player,
      setCore,
      startRequest,
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
        paused: false,
        resumeLoadsAyah: false,
      };

      return playCurrentRangeAyah();
    },
    [clearRangeSession, playCurrentRangeAyah, player]
  );

  const mainActive = core !== null && core.kind !== "preview";

  const previewReciter = useCallback(
    (recitationId: number): Promise<ToggleResult> => {
      const current = coreRef.current;
      if (current && current.kind !== "preview") return Promise.resolve({ ok: false, failure: "busy" });
      return startRequest("preview", RECITER_PREVIEW_TARGET, recitationId, false);
    },
    [startRequest]
  );

  const stopPreview = useCallback(() => {
    if (coreRef.current?.kind === "preview") stop();
  }, [stop]);

  const rangeState = useMemo<RangeAudioState>(
    () => ({
      ...rangePlayback,
      playing: rangePlayback.active && status.playing,
    }),
    [rangePlayback, status.playing]
  );

  const session = useMemo<AudioSessionState | null>(() => {
    if (!core) return null;
    const sessionStatus: AudioSessionStatus = core.failure
      ? "error"
      : core.loading
        ? "loading"
        : core.kind === "range"
          ? rangePlayback.paused
            ? "paused"
            : "playing"
          : status.playing
            ? "playing"
            : "paused";
    return {
      kind: core.kind,
      target: core.target,
      recitationId: core.recitationId,
      status: sessionStatus,
      failure: core.failure,
      surahNames: core.surahNames,
    };
  }, [core, rangePlayback.paused, status.playing]);

  const value = useMemo(
    () => ({
      getAyahState,
      toggleAyah,
      playRange,
      rangeState,
      session,
      mainActive,
      stop,
      togglePause,
      retry,
      previewReciter,
      stopPreview,
    }),
    [getAyahState, mainActive, playRange, previewReciter, rangeState, retry, session, stop, stopPreview, toggleAyah, togglePause]
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

/** The audio owner, or null on a surface that can render before the database (and audio) exist. */
export function useOptionalAyahAudio() {
  return useContext(AyahAudioContext);
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

function refreshAudioCache(db: DatabaseExecutor, surah: number, ayah: number, recitationId: number) {
  fetchQfAyahAudio(surah, ayah, recitationId)
    .then((response) => {
      if (response.ok) {
        return writeCachedAyahAudio(db, response, surah, ayah);
      }
    })
    .catch(console.warn);
}
