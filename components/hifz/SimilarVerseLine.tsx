import { View } from "react-native";
import { Text } from "@/components/ui/Text";
import { formatAyahRef } from "@/lib/arabic";
import type { SimilarRef } from "@/lib/hifz/similar";

type Props = {
  reference: SimilarRef;
  isRTL: boolean;
  accent: string;
  muted?: boolean;
  /** False while a discrimination prompt asks which verse this is (MUT-04). */
  showReference?: boolean;
};

/**
 * One similar verse with the shared wording marked (MUT-01, MUT-04, MUT-05). The text segments come from
 * the bundled similar-verse data and are only displayed (ETH-12). The verse stays right to left in both
 * interface directions; its reference follows the interface.
 */
export function SimilarVerseLine({ reference, isRTL, accent, muted = false, showReference = true }: Props) {
  return (
    <View style={{ gap: 4 }}>
      {showReference ? (
        <Text dir={isRTL ? "rtl" : "ltr"} variant="caption">
          {`${reference.surahName} ${formatAyahRef(isRTL, reference.surah, reference.ayah)}`}
        </Text>
      ) : null}
      <Text
        style={{ writingDirection: "rtl", textAlign: "right", fontSize: 19, lineHeight: 34, opacity: muted ? 0.85 : 1 }}
        className="text-charcoal dark:text-neutral-100"
      >
        {reference.pre ? `${reference.pre} ` : ""}
        <Text style={{ color: accent, fontWeight: "700" }}>{reference.similar}</Text>
        {reference.post ? ` ${reference.post}` : ""}
      </Text>
    </View>
  );
}
