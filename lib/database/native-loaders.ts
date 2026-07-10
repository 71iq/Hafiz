export const nativeRequires: Record<string, () => any> = {};
export const nativeTafseerRequires: Record<number, () => any> = {};

export function nativeTafsirSourceLoader(_source: string, _surahNumber: number): (() => any) | null {
  return null;
}
