import React from "react";
import { act, render } from "@testing-library/react-native";
import {
  AUDIO_LOAD_TIMEOUT_MS,
  AyahAudioProvider,
  RECITER_PREVIEW_LIMIT_MS,
  useAyahAudio,
} from "@/lib/audio/ayah-audio";
import { fetchQfAyahAudio } from "@/lib/quran-foundation/content";
import { isDefinitelyOffline } from "@/lib/audio/connectivity";

type Status = { playing: boolean; isLoaded: boolean; didJustFinish: boolean };

const mockPlayer = {
  replace: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(async () => undefined),
  setActiveForLockScreen: jest.fn(),
};
let mockStatus: Status = { playing: false, isLoaded: false, didJustFinish: false };
let rerenderStatus: (() => void) | null = null;

jest.mock("expo-audio", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  return {
    setAudioModeAsync: jest.fn(async () => undefined),
    setIsAudioActiveAsync: jest.fn(async () => undefined),
    useAudioPlayer: () => mockPlayer,
    useAudioPlayerStatus: () => {
      const [, force] = ReactActual.useReducer((n: number) => n + 1, 0);
      rerenderStatus = force;
      return mockStatus;
    },
  };
});
jest.mock("@/lib/database/provider", () => {
  const db = {
    getFirstAsync: jest.fn(async () => ({ name_english: "Al-Baqarah", name_arabic: "البقرة" })),
  };
  return { useDatabase: () => db };
});
jest.mock("@/lib/quran-foundation/cache", () => ({
  readCachedAyahAudio: jest.fn(async () => null),
  writeCachedAyahAudio: jest.fn(async () => undefined),
}));
jest.mock("@/lib/audio/connectivity", () => ({ isDefinitelyOffline: jest.fn(async () => false) }));
jest.mock("@/lib/quran-foundation/content", () => ({
  QF_DEFAULT_RECITATION_ID: 7,
  fetchQfAyahAudio: jest.fn(),
}));

const fetchAudio = fetchQfAyahAudio as jest.Mock;
const offline = isDefinitelyOffline as jest.Mock;

function audioResponse(surah: number, ayah: number, recitationId: number) {
  return {
    ok: true,
    recitationId,
    verseKey: `${surah}:${ayah}`,
    audio: { url: `https://audio.test/${recitationId}/${surah}-${ayah}.mp3` },
    fetchedAt: "2026-11-12T00:00:00.000Z",
  };
}

let audio: ReturnType<typeof useAyahAudio>;
function capture(value: ReturnType<typeof useAyahAudio>) {
  audio = value;
}
function Probe() {
  capture(useAyahAudio());
  return null;
}

function setStatus(next: Partial<Status>) {
  mockStatus = { ...mockStatus, ...next };
  act(() => rerenderStatus?.());
}

function renderProvider() {
  render(
    <AyahAudioProvider>
      <Probe />
    </AyahAudioProvider>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("audio session owner", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockStatus = { playing: false, isLoaded: false, didJustFinish: false };
    offline.mockResolvedValue(false);
    fetchAudio.mockImplementation(async (surah: number, ayah: number, recitationId: number) =>
      audioResponse(surah, ayah, recitationId),
    );
  });
  afterEach(() => jest.useRealTimers());

  it("times out a slow source after 15 seconds and never starts the late answer", async () => {
    let resolveLate: (value: unknown) => void = () => undefined;
    fetchAudio.mockImplementationOnce(() => new Promise((resolve) => (resolveLate = resolve)));
    renderProvider();

    let result: unknown;
    act(() => {
      void audio.toggleAyah(2, 255, 7).then((value) => (result = value));
    });
    await flush();
    expect(audio.session).toMatchObject({ kind: "single", status: "loading" });
    expect(audio.getAyahState(2, 255, 7).loading).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(AUDIO_LOAD_TIMEOUT_MS);
    });
    await flush();
    expect(result).toEqual({ ok: false, failure: "playback", code: undefined });
    expect(audio.session).toMatchObject({ status: "error", failure: "playback" });
    expect(audio.getAyahState(2, 255, 7).loading).toBe(false);

    await act(async () => {
      resolveLate(audioResponse(2, 255, 7));
    });
    await flush();
    expect(mockPlayer.replace).not.toHaveBeenCalled();
  });

  it("times out a player that never loads the file and offers Retry", async () => {
    renderProvider();
    act(() => {
      void audio.toggleAyah(2, 255, 7);
    });
    await flush();
    expect(mockPlayer.replace).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(AUDIO_LOAD_TIMEOUT_MS);
    });
    await flush();
    expect(audio.session?.status).toBe("error");

    // A late load of the abandoned file does not revive it.
    setStatus({ isLoaded: true, playing: true });
    expect(audio.session?.status).toBe("error");
    setStatus({ isLoaded: false, playing: false });

    act(() => {
      void audio.retry();
    });
    await flush();
    expect(mockPlayer.replace).toHaveBeenCalledTimes(2);
    expect(audio.session?.status).toBe("loading");
    setStatus({ isLoaded: true, playing: true });
    expect(audio.session?.status).toBe("playing");
  });

  it("tells offline, unavailable source and player failures apart", async () => {
    renderProvider();

    offline.mockResolvedValueOnce(true);
    let result: unknown;
    await act(async () => {
      result = await audio.toggleAyah(1, 1, 7);
    });
    expect(result).toMatchObject({ ok: false, failure: "offline" });
    expect(fetchAudio).not.toHaveBeenCalled();

    fetchAudio.mockResolvedValueOnce({ ok: false, code: "not_configured", message: "" });
    await act(async () => {
      result = await audio.toggleAyah(1, 2, 99);
    });
    expect(result).toMatchObject({ ok: false, failure: "unavailable" });

    fetchAudio.mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      result = await audio.toggleAyah(1, 3, 7);
    });
    expect(result).toMatchObject({ ok: false, failure: "playback" });
    expect(mockPlayer.replace).not.toHaveBeenCalled();
  });

  it("stopping while a file loads keeps it from starting", async () => {
    let resolveLate: (value: unknown) => void = () => undefined;
    fetchAudio.mockImplementationOnce(() => new Promise((resolve) => (resolveLate = resolve)));
    renderProvider();
    act(() => {
      void audio.toggleAyah(2, 255, 7);
    });
    await flush();
    act(() => audio.stop());
    expect(audio.session).toBeNull();
    await act(async () => {
      resolveLate(audioResponse(2, 255, 7));
    });
    await flush();
    expect(mockPlayer.replace).not.toHaveBeenCalled();
  });

  it("keeps one playback: a single ayah replaces a range and a range replaces a single ayah", async () => {
    renderProvider();
    await act(async () => {
      await audio.playRange({
        ayahs: [
          { surah: 1, ayah: 1 },
          { surah: 1, ayah: 2 },
        ],
        recitationId: 7,
      });
    });
    setStatus({ isLoaded: true, playing: true });
    expect(audio.session).toMatchObject({ kind: "range", status: "playing" });
    expect(audio.rangeState.active).toBe(true);
    expect(audio.mainActive).toBe(true);

    act(() => {
      void audio.toggleAyah(2, 255, 7);
    });
    await flush();
    expect(audio.rangeState.active).toBe(false);
    expect(audio.session).toMatchObject({ kind: "single", target: { surah: 2, ayah: 255 } });
    expect(mockPlayer.replace).toHaveBeenLastCalledWith({ uri: "https://audio.test/7/2-255.mp3" });

    await act(async () => {
      await audio.playRange({ ayahs: [{ surah: 3, ayah: 1 }], recitationId: 7 });
    });
    expect(audio.session).toMatchObject({ kind: "range", target: { surah: 3, ayah: 1 } });
    expect(audio.getAyahState(2, 255, 7).active).toBe(false);
    expect(mockPlayer.replace).toHaveBeenCalledTimes(3);
  });

  it("titles lock screen controls with the surah name, reciter and Hafiz", async () => {
    renderProvider();
    act(() => {
      void audio.toggleAyah(2, 255, 6);
    });
    await flush();
    expect(mockPlayer.setActiveForLockScreen).toHaveBeenCalledWith(true, {
      title: "Al-Baqarah 2:255",
      artist: "Mahmoud Khalil Al-Husary",
      albumTitle: "Hafiz",
    });
  });

  it("refuses a reciter preview while a recitation runs, and caps a preview at ten seconds", async () => {
    renderProvider();
    await act(async () => {
      await audio.playRange({ ayahs: [{ surah: 1, ayah: 1 }], recitationId: 7 });
    });
    let result: unknown;
    await act(async () => {
      result = await audio.previewReciter(3);
    });
    expect(result).toEqual({ ok: false, failure: "busy" });
    expect(mockPlayer.replace).toHaveBeenCalledTimes(1);

    act(() => audio.stop());
    act(() => {
      void audio.previewReciter(3);
    });
    await flush();
    expect(mockPlayer.replace).toHaveBeenLastCalledWith({ uri: "https://audio.test/3/1-1.mp3" });
    expect(audio.session).toMatchObject({ kind: "preview" });
    expect(audio.mainActive).toBe(false);
    // A preview never shows as the ayah's own playback or takes the lock screen.
    expect(audio.getAyahState(1, 1, 3).active).toBe(false);
    expect(mockPlayer.setActiveForLockScreen.mock.calls.filter(([active]) => active === true)).toHaveLength(1);

    setStatus({ isLoaded: true, playing: true });
    await act(async () => {
      jest.advanceTimersByTime(RECITER_PREVIEW_LIMIT_MS);
    });
    expect(audio.session).toBeNull();
    expect(mockPlayer.pause).toHaveBeenCalled();
  });

  it("marks a range paused when the player stops outside the app, and resumes in place", async () => {
    renderProvider();
    await act(async () => {
      await audio.playRange({
        ayahs: [
          { surah: 1, ayah: 1 },
          { surah: 1, ayah: 2 },
        ],
        recitationId: 7,
      });
    });
    setStatus({ isLoaded: true, playing: true });
    // Headphones unplugged: the platform pauses the player.
    setStatus({ playing: false });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(audio.rangeState.paused).toBe(true);
    expect(audio.session?.status).toBe("paused");

    mockPlayer.play.mockClear();
    act(() => audio.togglePause());
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.replace).toHaveBeenCalledTimes(1);
  });
});
