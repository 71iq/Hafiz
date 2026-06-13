import { toArabicNumber } from "@/lib/arabic";

export function localizedAyahMarker(ayah: number, isRTL: boolean): string {
  return `﴿${isRTL ? toArabicNumber(ayah) : String(ayah)}﴾`;
}
