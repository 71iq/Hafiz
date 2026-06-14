import { toArabicNumber } from "@/lib/arabic";

export function localizedAyahMarker(ayah: number, isRTL: boolean): string {
  const label = isRTL ? toArabicNumber(ayah) : String(ayah);
  // LTR runs mirror the ornate Quran brackets visually, so English preview text uses display-order brackets.
  return isRTL ? `﴿${label}﴾` : `﴾${label}﴿`;
}
