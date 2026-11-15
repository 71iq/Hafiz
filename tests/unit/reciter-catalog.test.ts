import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildReciterList,
  filterReciters,
  isReciterCatalogStale,
  parseReciterCatalog,
  readReciterCatalog,
  RECITER_CATALOG_REFRESH_MS,
  reciterCatalogKey,
  refreshReciterCatalog,
} from "@/lib/audio/reciter-catalog";
import { fetchQfReciters } from "@/lib/quran-foundation/content";
import { RECITERS } from "@/lib/quran-foundation/recitations";

jest.mock("@/lib/quran-foundation/content", () => ({ fetchQfReciters: jest.fn() }));

const fetchReciters = fetchQfReciters as jest.Mock;
const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const entry = { id: 6, nameEn: "Husary", nameAr: "الحصري", styleEn: "Murattal", styleAr: "مرتل" };

describe("reciter catalog cache", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it("caches per UI language under a versioned key", () => {
    expect(reciterCatalogKey("en")).toBe("hafiz_reciters_v1_en");
    expect(reciterCatalogKey("ar")).toBe("hafiz_reciters_v1_ar");
  });

  it("rejects malformed, future, duplicate and invalid-ID catalogs", () => {
    const good = JSON.stringify({ version: 1, fetchedAt: NOW, reciters: [entry] });
    expect(parseReciterCatalog(good, NOW)).toEqual({ fetchedAt: NOW, reciters: [entry] });
    for (const raw of [
      null,
      "not json",
      JSON.stringify({ version: 2, fetchedAt: NOW, reciters: [entry] }),
      JSON.stringify({ version: 1, fetchedAt: NOW + 3_600_000, reciters: [entry] }),
      JSON.stringify({ version: 1, fetchedAt: NOW, reciters: [] }),
      JSON.stringify({ version: 1, fetchedAt: NOW, reciters: [entry, entry] }),
      JSON.stringify({ version: 1, fetchedAt: NOW, reciters: [{ ...entry, id: 0 }] }),
      JSON.stringify({ version: 1, fetchedAt: NOW, reciters: [{ ...entry, id: 1.5 }] }),
      JSON.stringify({ version: 1, fetchedAt: NOW, reciters: [{ ...entry, nameAr: " " }] }),
    ]) {
      expect(parseReciterCatalog(raw, NOW)).toBeNull();
    }
  });

  it("refreshes once the cached list is a week old", () => {
    expect(isReciterCatalogStale(null, NOW)).toBe(true);
    expect(isReciterCatalogStale({ fetchedAt: NOW - RECITER_CATALOG_REFRESH_MS + 1000, reciters: [entry] }, NOW)).toBe(
      false,
    );
    expect(isReciterCatalogStale({ fetchedAt: NOW - RECITER_CATALOG_REFRESH_MS, reciters: [entry] }, NOW)).toBe(true);
  });

  it("stores only a valid remote answer and keeps the old copy when the service is off", async () => {
    fetchReciters.mockResolvedValueOnce({
      ok: true,
      language: "en",
      fetchedAt: "",
      reciters: [{ id: 6, reciterName: "Mahmoud Khalil Al-Husary", style: "Murattal" }],
    });
    const fresh = await refreshReciterCatalog("en", NOW);
    expect(fresh?.reciters[0]).toMatchObject({ id: 6, nameEn: "Mahmoud Khalil Al-Husary", styleEn: "Murattal" });
    expect(await readReciterCatalog("en", NOW)).toEqual(fresh);

    fetchReciters.mockResolvedValueOnce({ ok: false, code: "not_configured", message: "" });
    expect(await refreshReciterCatalog("en", NOW + 1)).toBeNull();
    fetchReciters.mockResolvedValueOnce({
      ok: true,
      language: "en",
      fetchedAt: "",
      reciters: [{ id: -3, reciterName: "x", style: "y" }],
    });
    expect(await refreshReciterCatalog("en", NOW + 2)).toBeNull();
    expect(await readReciterCatalog("en", NOW)).toEqual(fresh);
    expect(await readReciterCatalog("ar", NOW)).toBeNull();
  });

  it("sorts by the localized name, keeps the bundled list and an unknown selection visible", () => {
    const english = buildReciterList(null, 6, "en");
    expect(english).toHaveLength(RECITERS.length);
    const names = english.map((reciter) => reciter.nameEn);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));

    const arabic = buildReciterList(null, 6, "ar").map((reciter) => reciter.nameAr);
    expect(arabic).toEqual([...arabic].sort((a, b) => a.localeCompare(b, "ar")));

    const withUnknown = buildReciterList(null, 99, "en");
    expect(withUnknown.some((reciter) => reciter.id === 99)).toBe(true);
  });

  it("searches names and styles in either language, ignoring case and diacritics", () => {
    const list = buildReciterList(null, 6, "en");
    expect(
      filterReciters(list, "husary")
        .map((reciter) => reciter.id)
        .sort(),
    ).toEqual([12, 6]);
    expect(filterReciters(list, "الحُصري").length).toBe(2);
    expect(filterReciters(list, "MUALLIM").map((reciter) => reciter.id)).toEqual([12]);
    expect(filterReciters(list, "   ")).toBe(list);
  });
});
