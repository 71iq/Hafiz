import { Platform, Text } from "react-native";
import { surahNameBismillahGlyphs, surahNameFontName } from "@/lib/fonts/loader";

const BISMILLAH_UTHMANI = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";

type Props = {
  surahNumber?: number | null;
  fontReady: boolean;
  fontSize: number;
  lineHeight: number;
};

export function Bismillah({ surahNumber, fontReady, fontSize, lineHeight }: Props) {
  const web = Platform.OS === "web";
  const selectionProps = web && surahNumber ? {
    dataSet: {
      hafizQuranToken: "word",
      hafizSurah: String(surahNumber),
      hafizAyah: "1",
      hafizWordPos: "-1",
      hafizLiteralText: BISMILLAH_UTHMANI,
      hafizQuranHidden: "false",
    },
  } : {};
  return (
    <Text
      accessibilityLabel={BISMILLAH_UTHMANI}
      selectable={web}
      {...selectionProps}
      className="text-charcoal dark:text-neutral-200"
      style={{
        // Give the four calligraphic words the row's width, including on the first font load.
        alignSelf: "stretch",
        textAlign: "center",
        writingDirection: "rtl",
        fontFamily: fontReady ? surahNameFontName() : undefined,
        fontSize,
        lineHeight,
        ...(web && { userSelect: "text" }),
      }}
    >
      {fontReady ? surahNameBismillahGlyphs() : BISMILLAH_UTHMANI}
    </Text>
  );
}
