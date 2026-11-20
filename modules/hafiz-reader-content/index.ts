import { requireNativeModule } from "expo";

type ReaderContent = {
  readDataset(name: string): Promise<string>;
  downloadTafsir(source: string, surah: number): Promise<string>;
  seedDatabase(directory: string, name: string): Promise<void>;
  v4PageBytes(page: number): Promise<Uint8Array>;
  classicPageUri(page: number): string;
  isClassicInstalled(): boolean;
  downloadClassicPage(page: number): Promise<void>;
  finishClassicInstall(): Promise<void>;
};

export const readerContent = requireNativeModule<ReaderContent>("HafizReaderContent");

export async function readAndroidDataset(name: string): Promise<unknown> {
  return JSON.parse(await readerContent.readDataset(name));
}
