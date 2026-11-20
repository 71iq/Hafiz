import { QPC_V2_FONTS } from "./qpc-v2-fonts";
import { QPC_V4_TAJWEED_FONTS } from "./qpc-v4-tajweed-fonts";
import { registerFont } from "./register-font";
import type { QuranPageFontStyle } from "./page-style";

export function registerPageFont(name: string, style: QuranPageFontStyle, page: number) {
  return registerFont(name, (style === "qcf2" ? QPC_V2_FONTS : QPC_V4_TAJWEED_FONTS)[page]);
}
