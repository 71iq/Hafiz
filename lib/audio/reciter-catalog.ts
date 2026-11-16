import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchQfReciters, type QfContentReciter } from "@/lib/quran-foundation/content";
import { RECITERS, getReciterById, type QfReciter } from "@/lib/quran-foundation/recitations";

export const RECITER_CATALOG_KEY_PREFIX = "hafiz_reciters_v1_";
export const RECITER_CATALOG_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECITERS = 500;

type Language = "en" | "ar";
export type ReciterCatalog = { fetchedAt: number; reciters: QfReciter[] };

export function reciterCatalogKey(language: Language): string {
  return `${RECITER_CATALOG_KEY_PREFIX}${language}`;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

function parseReciter(value: unknown): QfReciter | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { id, nameEn, nameAr, styleEn, styleAr } = record;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  if (!isText(nameEn) || !isText(nameAr) || !isText(styleEn) || !isText(styleAr)) return null;
  return { id, nameEn, nameAr, styleEn, styleAr };
}

export function parseReciterCatalog(raw: string | null | undefined, now = Date.now()): ReciterCatalog | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.fetchedAt !== "number" || !Number.isFinite(record.fetchedAt)) return null;
  if (record.fetchedAt > now + 60_000) return null;
  if (!Array.isArray(record.reciters) || record.reciters.length === 0 || record.reciters.length > MAX_RECITERS)
    return null;
  const reciters: QfReciter[] = [];
  const ids = new Set<number>();
  for (const entry of record.reciters) {
    const reciter = parseReciter(entry);
    if (!reciter || ids.has(reciter.id)) return null;
    ids.add(reciter.id);
    reciters.push(reciter);
  }
  return { fetchedAt: record.fetchedAt, reciters };
}

export function isReciterCatalogStale(catalog: ReciterCatalog | null, now = Date.now()): boolean {
  return !catalog || now - catalog.fetchedAt >= RECITER_CATALOG_REFRESH_MS;
}

export async function readReciterCatalog(language: Language, now = Date.now()): Promise<ReciterCatalog | null> {
  try {
    return parseReciterCatalog(await AsyncStorage.getItem(reciterCatalogKey(language)), now);
  } catch {
    return null;
  }
}

async function writeReciterCatalog(language: Language, catalog: ReciterCatalog): Promise<void> {
  try {
    await AsyncStorage.setItem(
      reciterCatalogKey(language),
      JSON.stringify({ version: 1, fetchedAt: catalog.fetchedAt, reciters: catalog.reciters }),
    );
  } catch {
  }
}

export async function refreshReciterCatalog(language: Language, now = Date.now()): Promise<ReciterCatalog | null> {
  try {
    const response = await fetchQfReciters(language);
    if (!response.ok || response.reciters.length === 0) return null;
    const reciters = response.reciters.map((reciter) => toSettingsReciter(reciter, language));
    const catalog = parseReciterCatalog(JSON.stringify({ version: 1, fetchedAt: now, reciters }), now);
    if (!catalog) return null;
    await writeReciterCatalog(language, catalog);
    return catalog;
  } catch {
    return null;
  }
}

export function toSettingsReciter(reciter: QfContentReciter, language: Language): QfReciter {
  const fallback = getReciterById(reciter.id);
  const translatedName = reciter.translatedName?.trim();
  const sourceName = reciter.reciterName?.trim() ?? "";
  const style = reciter.style?.trim() ?? "";
  return {
    id: reciter.id,
    nameEn: language === "en" ? translatedName || sourceName : fallback.nameEn,
    nameAr: language === "ar" ? translatedName || sourceName : fallback.nameAr,
    styleEn: language === "en" ? style || fallback.styleEn : fallback.styleEn,
    styleAr: language === "ar" ? localizeRecitationStyle(style) || fallback.styleAr : fallback.styleAr,
  };
}

function localizeRecitationStyle(style: string): string {
  const normalized = style.trim().toLowerCase();
  if (normalized === "murattal") return "مرتل";
  if (normalized === "mujawwad") return "مجود";
  if (normalized === "muallim") return "معلم";
  return style;
}

export function buildReciterList(remote: QfReciter[] | null, selectedId: number, language: Language): QfReciter[] {
  const byId = new Map<number, QfReciter>();
  RECITERS.forEach((reciter) => byId.set(reciter.id, reciter));
  remote?.forEach((reciter) => byId.set(reciter.id, reciter));
  if (!byId.has(selectedId)) byId.set(selectedId, getReciterById(selectedId));
  const name = (reciter: QfReciter) => (language === "ar" ? reciter.nameAr : reciter.nameEn);
  const style = (reciter: QfReciter) => (language === "ar" ? reciter.styleAr : reciter.styleEn);
  return Array.from(byId.values()).sort(
    (a, b) => name(a).localeCompare(name(b), language) || style(a).localeCompare(style(b), language) || a.id - b.id,
  );
}

const ARABIC_MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

function searchable(text: string): string {
  return text
    .replace(ARABIC_MARKS, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();
}

export function filterReciters(reciters: QfReciter[], query: string): QfReciter[] {
  const needle = searchable(query.trim());
  if (!needle) return reciters;
  return reciters.filter((reciter) =>
    [reciter.nameEn, reciter.nameAr, reciter.styleEn, reciter.styleAr].some((text) =>
      searchable(text).includes(needle),
    ),
  );
}
