export type TafsirSourceId = "muyassar" | "zilal" | "tahrir-tanwir" | "qurtubi";

type TafsirImportKind = "muyassar" | "zilal" | "surahRows";

export type TafsirSourceConfig = {
  id: TafsirSourceId;
  labelKey: string;
  descriptionKey: string;
  importKind: TafsirImportKind;
  progressDetail: string;
  expectedRows?: number;
};

export const DEFAULT_TAFSIR_SOURCE: TafsirSourceId = "muyassar";

export const TAFSIR_SOURCES: TafsirSourceConfig[] = [
  {
    id: "muyassar",
    labelKey: "tafseerMuyassar",
    descriptionKey: "tafseerMuyassarDesc",
    importKind: "muyassar",
    progressDetail: "Al-Muyassar (114 files)",
  },
  {
    id: "zilal",
    labelKey: "tafseerZilal",
    descriptionKey: "tafseerZilalDesc",
    importKind: "zilal",
    progressDetail: "Fi Zilal al-Quran",
  },
  {
    id: "tahrir-tanwir",
    labelKey: "tafseerTahrirTanwir",
    descriptionKey: "tafseerTahrirTanwirDesc",
    importKind: "surahRows",
    progressDetail: "Al-Tahrir wa al-Tanwir",
  },
  {
    id: "qurtubi",
    labelKey: "tafseerQurtubi",
    descriptionKey: "tafseerQurtubiDesc",
    importKind: "surahRows",
    progressDetail: "Tafseer Al Qurtubi",
    expectedRows: 6234,
  },
];

export const SURAH_ROW_TAFSIR_SOURCES = TAFSIR_SOURCES.filter(
  (source) => source.importKind === "surahRows"
);

export function isTafsirSourceId(value: string | null | undefined): value is TafsirSourceId {
  return TAFSIR_SOURCES.some((source) => source.id === value);
}
