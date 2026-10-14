import { fetchQfAyahAudio, fetchQfAyahHadiths, fetchQfReciters } from "@/lib/quran-foundation/content";
import { isQfContentEnabled } from "@/lib/quran-foundation/config";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

jest.mock("@/lib/quran-foundation/config", () => ({
  isQfContentEnabled: jest.fn(),
}));

jest.mock("@/lib/quran-foundation/recitations", () => ({
  DEFAULT_RECITATION_ID: 42,
}));

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: jest.fn(),
  supabase: {
    functions: { invoke: jest.fn() },
  },
}));

const enabled = jest.mocked(isQfContentEnabled);
const configured = jest.mocked(isSupabaseConfigured);
const invoke = jest.mocked(supabase.functions.invoke);

describe("Quran Foundation content feature gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configured.mockReturnValue(true);
    enabled.mockReturnValue(false);
  });

  it.each([
    ["audio", () => fetchQfAyahAudio(2, 255)],
    ["hadiths", () => fetchQfAyahHadiths(2, 255, "en")],
    ["reciters", () => fetchQfReciters("ar")],
  ])("returns not_configured for disabled %s content without invoking Supabase", async (_name, request) => {
    await expect(request()).resolves.toMatchObject({ ok: false, code: "not_configured" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes qf-content with the normal audio request when enabled", async () => {
    enabled.mockReturnValue(true);
    invoke.mockResolvedValue({
      data: {
        ok: true,
        recitationId: 42,
        verseKey: "2:255",
        audio: { url: "https://cdn.example/audio.mp3" },
        fetchedAt: "2026-10-14T00:00:00.000Z",
      },
      error: null,
    });

    await expect(fetchQfAyahAudio(2, 255)).resolves.toMatchObject({ ok: true, recitationId: 42 });
    expect(invoke).toHaveBeenCalledWith("qf-content", {
      body: { action: "audio-ayah", surah: 2, ayah: 255, recitationId: 42 },
    });
  });
});
