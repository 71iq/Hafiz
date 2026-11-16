
const termsData = require("../../assets/data/morphology/morphology-terms-ar.json");

export function getVerbFormName(formStr: string | null): string | null {
  if (!formStr) return null;
  const match = formStr.match(/\(([IVX]+)\)/);
  if (!match) return formStr;

  const romanToIndex: Record<string, number> = {
    I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5,
    VII: 6, VIII: 7, IX: 8, X: 9, XI: 10,
  };
  const idx = romanToIndex[match[1]];
  if (idx !== undefined && termsData.verb_forms_tri?.[idx]) {
    return termsData.verb_forms_tri[idx];
  }
  return formStr;
}
