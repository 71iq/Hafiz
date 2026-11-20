import { readAndroidDataset, readerContent } from "@/modules/hafiz-reader-content";
import type { TafsirSourceId } from "@/lib/tafsir/sources";

export const loadNativeData = readAndroidDataset;
export const loadNativeTafseer = (surah: number) => readAndroidDataset(`tafseer/${surah}.json`);

export const nativeTafsirSourceLoader = (source: TafsirSourceId, surah: number) => async (): Promise<unknown> =>
  JSON.parse(await readerContent.downloadTafsir(source, surah));
