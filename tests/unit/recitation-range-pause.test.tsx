import React from "react";
import { act, render } from "@testing-library/react-native";
import { AyahAudioProvider, useAyahAudio } from "@/lib/audio/ayah-audio";

type Status = { playing: boolean; isLoaded: boolean; didJustFinish: boolean };

const mockPlayer = { replace: jest.fn(), play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => undefined), setActiveForLockScreen: jest.fn() };
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
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => ({}) }));
jest.mock("@/lib/quran-foundation/cache", () => ({
  readCachedAyahAudio: jest.fn(async () => null),
  writeCachedAyahAudio: jest.fn(async () => undefined),
}));
jest.mock("@/lib/quran-foundation/content", () => ({
  QF_DEFAULT_RECITATION_ID: 7,
  fetchQfAyahAudio: jest.fn(async (surah: number, ayah: number, recitationId: number) => ({
    ok: true,
    recitationId,
    verseKey: `${surah}:${ayah}`,
    audio: { url: `https://audio.test/${surah}-${ayah}.mp3` },
    fetchedAt: "2026-11-12T00:00:00.000Z",
  })),
}));

let audio: ReturnType<typeof useAyahAudio>;
function Probe() {
  audio = useAyahAudio();
  return null;
}

function setStatus(next: Partial<Status>) {
  mockStatus = { ...mockStatus, ...next };
  act(() => rerenderStatus?.());
}

describe("recitation range pause", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockStatus = { playing: false, isLoaded: false, didJustFinish: false };
  });
  afterEach(() => jest.useRealTimers());

  it("pausing in the gap between ayahs holds the next ayah until resume", async () => {
    render(
      <AyahAudioProvider>
        <Probe />
      </AyahAudioProvider>,
    );

    await act(async () => {
      await audio.playRange({ ayahs: [{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }], delayMs: 1000 });
    });
    expect(mockPlayer.replace).toHaveBeenLastCalledWith({ uri: "https://audio.test/1-1.mp3" });

    // Ayah 1 ends; the next one is due after the 1 s gap.
    setStatus({ playing: false, isLoaded: true, didJustFinish: true });
    setStatus({ didJustFinish: false });
    act(() => audio.togglePause());
    expect(audio.rangeState.paused).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPlayer.replace).toHaveBeenCalledTimes(1);

    await act(async () => {
      audio.togglePause();
    });
    expect(audio.rangeState.paused).toBe(false);
    expect(mockPlayer.replace).toHaveBeenLastCalledWith({ uri: "https://audio.test/1-2.mp3" });
  });

  it("pausing mid-ayah resumes the same ayah in place", async () => {
    render(
      <AyahAudioProvider>
        <Probe />
      </AyahAudioProvider>,
    );
    await act(async () => {
      await audio.playRange({ ayahs: [{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }] });
    });
    setStatus({ playing: true, isLoaded: true });

    act(() => audio.togglePause());
    expect(mockPlayer.pause).toHaveBeenCalled();
    setStatus({ playing: false });

    mockPlayer.play.mockClear();
    act(() => audio.togglePause());
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.replace).toHaveBeenCalledTimes(1);
  });
});
