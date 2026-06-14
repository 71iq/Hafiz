export function shouldJustifyMushafLine(pageNumber: number, lineNumber: number, centered: boolean, wordCount: number): boolean {
  if (centered || wordCount <= 1) return false;
  if (pageNumber === 2 && lineNumber === 5) return false;
  return true;
}
