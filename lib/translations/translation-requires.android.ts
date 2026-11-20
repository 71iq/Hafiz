import { readAndroidDataset } from "@/modules/hafiz-reader-content";
import { translationRequires } from "./translation-membership";
export { translationRequires };

export async function loadTranslation(langCode: string): Promise<any> {
  if (translationRequires[langCode] !== true) throw new Error("Unknown translation: " + langCode);
  return readAndroidDataset(`translations/${langCode}.json`);
}
