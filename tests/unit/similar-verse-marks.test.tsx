import React from "react";
import { Dimensions, I18nManager } from "react-native";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OperationNoticeProvider } from "@/components/ui/OperationNoticeProvider";
import { AyahBlock } from "@/components/mushaf/AyahBlock";
import { PageMushaf } from "@/components/mushaf/PageMushaf";
import { ReadingSettingsSheet } from "@/components/mushaf/ReadingSettingsSheet";
import { pageCardId } from "@/lib/hifz/units";
import { strings } from "@/lib/i18n/strings";
import { SettingsProvider } from "@/lib/settings/context";
import { DirectionProvider } from "@/lib/ui/direction";

// MUT-02: the reader marks an ayah whose similar verse is memorized, in page and verse view, and the
// mark opens the comparison in the ayah detail sheet. All text below is synthetic, never Quran data.

type Language = "en" | "ar";
type Fixture = {
  saved: Map<string, string>;
  memorizedPages: number[];
  failSimilar: boolean;
};

const MARKED = { surah: 2, ayah: 5 };
const PLAIN = { surah: 2, ayah: 6 };
const SIBLING = { surah: 31, ayah: 5 };
const PAGE = 2;
const SIBLING_PAGE = 412;
// Two words and a marker for the marked ayah, one word and a marker for the plain one.
const MARKED_GLYPHS = ["G-a", "G-b", "G-m5"];
const PLAIN_GLYPHS = ["G-c", "G-m6"];
const refRows = [
  {
    group_id: "fixture-group",
    kind: "similar",
    sort_order: 0,
    surah: MARKED.surah,
    ayah: MARKED.ayah,
    surah_name_ar: "سورة أ",
    pre_text: "بداية أولى",
    similar_text: "عبارة مشتركة",
    post_text: "نهاية أولى",
    v2_page: PAGE,
    text_uthmani: "نص أول",
  },
  {
    group_id: "fixture-group",
    kind: "similar",
    sort_order: 1,
    surah: SIBLING.surah,
    ayah: SIBLING.ayah,
    surah_name_ar: "سورة ب",
    pre_text: "بداية ثانية",
    similar_text: "عبارة مشتركة",
    post_text: "نهاية ثانية",
    v2_page: SIBLING_PAGE,
    text_uthmani: "نص ثان",
  },
];
const verseText = (row: (typeof refRows)[number]) => `${row.pre_text} ${row.similar_text} ${row.post_text}`;
const meaning = (language: Language, surah: number, ayah: number) =>
  language === "ar" ? `معنى تجريبي ${surah}:${ayah}` : `Fixture meaning ${surah}:${ayah}`;

let fixture: Fixture;
let reads: string[];
let mockDb: ReturnType<typeof createDb>;
const originalWindow = Dimensions.get("window");
const originalScreen = Dimensions.get("screen");

function keysOf(params: readonly unknown[]): { surah: number; ayah: number }[] {
  const keys: { surah: number; ayah: number }[] = [];
  for (let index = 0; index + 1 < params.length; index += 2)
    keys.push({ surah: Number(params[index]), ayah: Number(params[index + 1]) });
  return keys;
}

function createDb() {
  const db = {
    getAllAsync: jest.fn(async (sql: string, params: readonly unknown[] = []): Promise<unknown[]> => {
      if (sql.includes("FROM user_settings WHERE key IN")) {
        return params.flatMap((key) =>
          fixture.saved.has(String(key)) ? [{ key, value: fixture.saved.get(String(key)) }] : [],
        );
      }
      if (sql.includes("FROM page_map")) {
        return [1, PAGE].map((page) => ({ page, surah_start: 2, ayah_start: 1, surah_end: 2, ayah_end: 6 }));
      }
      if (sql.startsWith("SELECT surah, ayah, text_qcf2, v2_page FROM quran_text")) {
        return [
          { ...MARKED, text_qcf2: MARKED_GLYPHS.join(" "), v2_page: PAGE },
          { ...PLAIN, text_qcf2: PLAIN_GLYPHS.join(" "), v2_page: PAGE },
        ];
      }
      if (sql.includes("FROM surahs ORDER BY number")) {
        return [
          {
            number: 2,
            name_arabic: "سورة تجريبية",
            name_english: "Fixture",
            ayah_count: 6,
            revelation_type: "Madaniyah",
          },
        ];
      }
      if (sql.includes("FROM page_lines")) {
        return [
          {
            page_number: PAGE,
            line_number: 1,
            line_type: "ayah",
            is_centered: 0,
            first_word_id: 1,
            last_word_id: 5,
            surah_number: null,
          },
        ];
      }
      if (sql.includes("FROM juz_map")) return [];
      if (sql.includes("FROM mutashabihat_refs r")) {
        reads.push(`similar:${params.join(",")}`);
        if (fixture.failSimilar) throw new Error("synthetic similar-verse read failure");
        return params.includes(PAGE) ? refRows : [];
      }
      if (sql.includes("FROM study_cards")) {
        reads.push("memorized");
        return fixture.memorizedPages.map((page) => ({ id: pageCardId(page) }));
      }
      if (sql.includes("FROM translations WHERE")) {
        return keysOf(params).map(({ surah, ayah }) => ({ surah, ayah, text: meaning("en", surah, ayah) }));
      }
      if (sql.includes("FROM tafseer WHERE source = 'muyassar'")) {
        return keysOf(params).map(({ surah, ayah }) => ({ surah, ayah, text: meaning("ar", surah, ayah) }));
      }
      if (sql === "SELECT source, text FROM tafseer WHERE surah = ? AND ayah = ?") return [];
      throw new Error(`Unexpected read: ${sql}`);
    }),
    getFirstAsync: jest.fn(async (sql: string, params: readonly unknown[] = []): Promise<unknown> => {
      if (sql.includes("JOIN surahs s ON s.number = q.surah")) {
        const [surah, ayah] = params.map(Number);
        const glyphs = surah === MARKED.surah && ayah === MARKED.ayah ? MARKED_GLYPHS : PLAIN_GLYPHS;
        return {
          text_uthmani: "نص تجريبي",
          text_qcf2: glyphs.join(" "),
          v2_page: PAGE,
          surah_name_arabic: "سورة تجريبية",
          surah_name_english: "Fixture",
        };
      }
      if (sql.includes("FROM translations WHERE surah = ? AND ayah = ?")) return { text_en: "Fixture translation" };
      if (sql.includes("FROM quran_text")) return null;
      throw new Error(`Unexpected read: ${sql}`);
    }),
    runAsync: jest.fn(async (sql: string, params: readonly unknown[] = []) => {
      if (!sql.startsWith("INSERT OR REPLACE INTO user_settings")) throw new Error(`Unexpected write: ${sql}`);
      fixture.saved.set(String(params[0]), String(params[1]));
      return { changes: 1, lastInsertRowId: 0 };
    }),
    withTransactionAsync: async (task: (transaction: unknown) => Promise<void>) => task(db),
  };
  return db;
}

jest.mock("@/lib/database/provider", () => ({
  useDatabase: () => mockDb,
  useDatabaseStatus: () => ({ db: mockDb, isReady: true, progress: null, error: null }),
}));
jest.mock("nativewind", () => ({
  useColorScheme: () => ({ setColorScheme: () => undefined }),
  vars: (variables: Record<string, string>) => variables,
}));
jest.mock("@/lib/database/sync-queue", () => ({ enqueueSync: async () => undefined }));
jest.mock("@/lib/translations/import", () => ({
  importTranslation: async () => {
    throw new Error("Translation imports are not part of this fixture");
  },
}));
jest.mock("@/lib/selection/context", () => ({
  useSelection: () => ({
    selection: null,
    selectAyah: mockSelectAyah,
    getHighlightColor: () => undefined,
    getWordHighlightColor: () => undefined,
    isBookmarked: () => false,
    showToast: () => undefined,
    refreshBookmarks: async () => undefined,
  }),
}));
const mockSelectAyah = jest.fn();
jest.mock("@/lib/audio/ayah-audio", () => ({
  useAyahAudio: () => ({
    getAyahState: () => ({ active: false, playing: false, loading: false }),
    toggleAyah: async () => ({ ok: true }),
  }),
}));
jest.mock("@/lib/selection/queries", () => ({
  addBookmark: async () => undefined,
  removeBookmark: async () => undefined,
  fetchSurahName: async () => "",
  fetchUthmaniRange: async () => "",
}));
// Sheets and switches settle at once, so no animation frame updates them after a test step.
jest.mock("@/lib/ui/reduced-motion", () => ({ useReducedMotionPreference: () => true }));
jest.mock("@/lib/quran-foundation/config", () => ({
  isQfContentEnabled: () => false,
  isRecitationEnabled: () => false,
}));
jest.mock("@/components/reflections/ReflectionsSection", () => ({ ReflectionsSection: () => null }));
jest.mock("@/components/notes/PrivateNotesSection", () => ({ PrivateNotesSection: () => null }));
jest.mock("@/components/mushaf/word-tabs/QiraatTab", () => ({ QiraatTab: () => null }));
jest.mock("@/components/mushaf/ayah-tabs/HadithTab", () => ({ HadithTab: () => null }));
jest.mock("@/components/settings/TafsirSourcePicker", () => ({ TafsirSourcePicker: () => null }));
jest.mock("@/components/mushaf/WordToken", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  return {
    WEAK_SPOT_LIGHT: "#d97706",
    WEAK_SPOT_DARK: "#f59e0b",
    WordToken: ({ glyph }: { glyph: string }) => ReactActual.createElement(Text, null, glyph),
  };
});
jest.mock("@/lib/fonts/loader", () => ({
  isSurahNameFontLoaded: () => true,
  loadSurahNameFont: async () => undefined,
  surahNameGlyph: () => undefined,
  surahNameBismillahGlyphs: () => "",
  surahNameFontName: () => "FixtureSurahFont",
  isQuranPageFontLoaded: () => true,
  loadQuranPageFont: async () => undefined,
  quranPageFontName: () => "FixturePageFont",
  quranPageFontPaletteStyle: () => ({}),
  quranPageMarkerFontPaletteStyle: () => ({}),
}));

function Providers({ language, children }: { language: Language; children: React.ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <SettingsProvider>
        <OperationNoticeProvider ready>
          <DirectionProvider dir={language === "ar" ? "rtl" : "ltr"}>{children}</DirectionProvider>
        </OperationNoticeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function markerLabel(language: Language, { surah, ayah }: { surah: number; ayah: number }) {
  const ref = language === "ar" ? `${toArabicDigits(surah)}:${toArabicDigits(ayah)}` : `${surah}:${ayah}`;
  return strings[language].hifzSimilarMarker.replace("{{ref}}", ref);
}

function toArabicDigits(value: number) {
  return String(value).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
}

/** Lets the settings load, the page data load and the similar-verse reads settle. */
async function settle() {
  for (let step = 0; step < 6; step += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The reader, optionally with its settings sheet open beside it, as the reader shows it. */
function renderPageView(language: Language, { withSettings = false } = {}) {
  return render(
    <Providers language={language}>
      <PageMushaf currentPage={PAGE} />
      {withSettings ? <ReadingSettingsSheet visible onClose={() => undefined} /> : null}
    </Providers>,
  );
}

function renderVerseView(language: Language, { withSettings = false } = {}) {
  return render(
    <Providers language={language}>
      <AyahBlock {...MARKED} text={MARKED_GLYPHS.join(" ")} v2Page={PAGE} fontSize={20} lineHeight={44} />
      <AyahBlock {...PLAIN} text={PLAIN_GLYPHS.join(" ")} v2Page={PAGE} fontSize={20} lineHeight={44} />
      {withSettings ? <ReadingSettingsSheet visible onClose={() => undefined} /> : null}
    </Providers>,
  );
}

async function toggleMarkSetting(language: Language) {
  fireEvent.press(screen.getByLabelText(strings[language].hifzSimilarMarkSetting));
  await settle();
}

async function expectComparisonOpen(language: Language) {
  // Both verses of the group, and the marked ayah's meaning in the interface language (MUT-05). How
  // the comparison shows a sibling's meaning is SimilarVerseComparison's own behavior.
  expect(await screen.findByText(verseText(refRows[0]))).toBeTruthy();
  expect(screen.getByText(verseText(refRows[1]))).toBeTruthy();
  expect(await screen.findByText(meaning(language, MARKED.surah, MARKED.ayah))).toBeTruthy();
  expect(screen.getByText(strings[language].hifzSimilarTitle)).toBeTruthy();
}

beforeEach(() => {
  reads = [];
  mockSelectAyah.mockReset();
  mockDb = createDb();
  const screenSize = { width: 390, height: 844, scale: 1, fontScale: 1 };
  Dimensions.set({ window: screenSize, screen: screenSize });
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

describe.each(["en", "ar"] satisfies Language[])("similar-verse marks in %s", (language) => {
  beforeEach(() => {
    fixture = {
      saved: new Map([
        ["ui_language", language],
        ["translation_language", "en"],
        ["view_mode", "page"],
        ["page_scroll", "horizontal"],
      ]),
      memorizedPages: [SIBLING_PAGE],
      failSimilar: false,
    };
    jest.replaceProperty(I18nManager, "isRTL", language === "ar");
  });

  it("marks only the page-view ayah whose similar verse is memorized, and opens the comparison", async () => {
    renderPageView(language);
    await settle();

    const marker = await screen.findByLabelText(markerLabel(language, MARKED));
    expect(screen.queryByLabelText(markerLabel(language, PLAIN))).toBeNull();
    expect(screen.getAllByTestId("similar-verse-marker")).toHaveLength(1);
    // One read for the page's groups and one for the memorized pages, however many ayat it holds.
    expect(reads.filter((read) => read.startsWith("similar:"))).toEqual([`similar:${PAGE}`]);
    expect(reads.filter((read) => read === "memorized")).toHaveLength(1);

    fireEvent.press(marker);
    await expectComparisonOpen(language);
  });

  it("keeps a long press on the marked ayah number selecting the ayah", async () => {
    renderPageView(language);
    await settle();

    fireEvent(await screen.findByLabelText(markerLabel(language, MARKED)), "longPress");
    expect(mockSelectAyah).toHaveBeenCalledWith(MARKED.surah, MARKED.ayah);
    expect(screen.queryByText(verseText(refRows[1]))).toBeNull();
  });

  it("reads the memorized pages again when the marks come back on screen, so a change made meanwhile shows", async () => {
    const first = renderPageView(language);
    await settle();
    expect(await screen.findByLabelText(markerLabel(language, MARKED))).toBeTruthy();
    first.unmount();
    // While no reader is open, the sibling's page stops being memorized (a sync, a deletion).
    fixture.memorizedPages = [PAGE];
    renderPageView(language);
    await settle();
    expect(screen.getByText(MARKED_GLYPHS[0])).toBeTruthy();
    expect(screen.queryByTestId("similar-verse-marker")).toBeNull();
  });

  it("marks nothing on a page whose similar verses are not memorized", async () => {
    fixture.memorizedPages = [PAGE];
    renderPageView(language);
    await settle();

    expect(screen.getByText(MARKED_GLYPHS[0])).toBeTruthy();
    expect(reads).toContain(`similar:${PAGE}`);
    expect(screen.queryByTestId("similar-verse-marker")).toBeNull();
  });

  it("hides the page-view marks when Mark similar verses is turned off, and shows them again", async () => {
    renderPageView(language, { withSettings: true });
    await settle();
    expect(await screen.findByLabelText(markerLabel(language, MARKED))).toBeTruthy();

    await toggleMarkSetting(language);
    expect(screen.queryByTestId("similar-verse-marker")).toBeNull();
    expect(fixture.saved.get("mark_similar_verses")).toBe("false");

    await toggleMarkSetting(language);
    expect(await screen.findByLabelText(markerLabel(language, MARKED))).toBeTruthy();
    expect(fixture.saved.get("mark_similar_verses")).toBe("true");
  });

  it("reads nothing while the saved setting is off, and marks once it is turned on", async () => {
    fixture.saved.set("mark_similar_verses", "false");
    renderPageView(language, { withSettings: true });
    await settle();

    expect(screen.getByText(MARKED_GLYPHS[0])).toBeTruthy();
    expect(screen.queryByTestId("similar-verse-marker")).toBeNull();
    expect(reads).toEqual([]);

    await toggleMarkSetting(language);
    expect(await screen.findByLabelText(markerLabel(language, MARKED))).toBeTruthy();
    expect(reads).toContain(`similar:${PAGE}`);
  });

  it("shows the page without marks when the similar-verse read fails", async () => {
    fixture.failSimilar = true;
    renderPageView(language);
    await settle();

    expect(reads).toContain(`similar:${PAGE}`);
    expect(screen.getByText(MARKED_GLYPHS[0])).toBeTruthy();
    expect(screen.getByText(PLAIN_GLYPHS[0])).toBeTruthy();
    expect(screen.queryByTestId("similar-verse-marker")).toBeNull();
  });

  it("marks the verse-view ayah once per page and opens the comparison from it", async () => {
    renderVerseView(language);
    await settle();

    const marker = await screen.findByLabelText(markerLabel(language, MARKED));
    expect(screen.queryByLabelText(markerLabel(language, PLAIN))).toBeNull();
    // Two blocks on one page share a single read of that page.
    expect(reads.filter((read) => read.startsWith("similar:"))).toEqual([`similar:${PAGE}`]);

    fireEvent.press(marker);
    await expectComparisonOpen(language);
  });

  it("hides the verse-view mark when Mark similar verses is off, and shows it once turned on", async () => {
    fixture.saved.set("mark_similar_verses", "false");
    renderVerseView(language, { withSettings: true });
    await settle();

    expect(screen.getAllByText(strings[language].wordTranslation).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("similar-verse-marker")).toBeNull();
    expect(reads).toEqual([]);

    await toggleMarkSetting(language);
    expect(await screen.findByLabelText(markerLabel(language, MARKED))).toBeTruthy();
    expect(screen.queryByLabelText(markerLabel(language, PLAIN))).toBeNull();
  });
});
