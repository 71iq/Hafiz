import type { ReactNode } from "react";
import { View } from "react-native";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { formatAyahRef, normalizeArabicWord } from "@/lib/arabic";
import type { SimilarRef } from "@/lib/hifz/similar";

type Props = {
  reference: SimilarRef;
  isRTL: boolean;
  accent: string;
  muted?: boolean;
  /**
   * False while a discrimination prompt asks which verse this is (MUT-04). The reference line keeps its
   * place, hidden, so the card does not grow under the finger when it is shown.
   */
  showReference?: boolean;
  /** Shown beside the reference once it is shown, such as the prompt's answer mark or "Your choice". */
  status?: ReactNode;
  /**
   * The other verse of a pair, once a prompt is answered: the words this verse does not share with it
   * are underlined and only the shared ones keep the accent, so the difference is what stands out.
   */
  compareWith?: SimilarRef | null;
  /** MUT-05: the verse's meaning in the interface language, with the label naming its source. */
  meaning?: { label: string; text: string } | null;
};

const CONTEXT_STYLE = { writingDirection: "rtl", textAlign: "right", fontSize: 15, lineHeight: 26 } as const;

function verseWords(reference: SimilarRef): string[] {
  return [reference.pre, reference.similar, reference.post].join(" ").split(/\s+/).filter(Boolean);
}

/** "Surah 78:2", with the Arabic surah name isolated in English so the digits after it keep their order. */
function referenceLabel(reference: SimilarRef, isRTL: boolean): string {
  return `${reference.surahName}${isRTL ? "" : "‎"} ${formatAyahRef(isRTL, reference.surah, reference.ayah)}`;
}

/**
 * One similar verse with the shared wording marked (MUT-01, MUT-04, MUT-05). The text segments come from
 * the bundled similar-verse data, or the verse's Unicode text for a tail-only group, and are only
 * displayed (ETH-12). The verse and any neighbouring words that tell it from an identical sibling stay
 * right to left in both interface directions; its reference and meaning follow the interface.
 */
export function SimilarVerseLine({
  reference,
  isRTL,
  accent,
  muted = false,
  showReference = true,
  status = null,
  compareWith = null,
  meaning = null,
}: Props) {
  const dir = isRTL ? "rtl" : "ltr";
  const context = reference.context;
  const otherWords = compareWith ? new Set(verseWords(compareWith).map(normalizeArabicWord)) : null;
  const sharedWords = new Set(reference.similar.split(/\s+/).filter(Boolean).map(normalizeArabicWord));
  return (
    <View style={{ gap: 4 }}>
      {showReference ? (
        <MirroredRow dir={dir} className="items-center gap-1.5">
          <Text dir={dir} variant="caption">
            {referenceLabel(reference, isRTL)}
          </Text>
          {status}
        </MirroredRow>
      ) : context?.surahName ? (
        // The two verses and their neighbours read the same, so only the surah tells them apart.
        <Text dir={dir} variant="caption">
          {reference.surahName}
        </Text>
      ) : (
        // Hidden until a choice, but holding its line so the card keeps its height.
        <Text
          dir={dir}
          variant="caption"
          style={{ opacity: 0 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {referenceLabel(reference, isRTL)}
        </Text>
      )}
      {context?.before ? (
        <Text style={CONTEXT_STYLE} className="text-warm-700 dark:text-neutral-400">
          {`… ${context.before}`}
        </Text>
      ) : null}
      <Text
        style={{ writingDirection: "rtl", textAlign: "right", fontSize: 19, lineHeight: 34, opacity: muted ? 0.85 : 1 }}
        className="text-charcoal dark:text-neutral-100"
      >
        {otherWords ? (
          verseWords(reference).map((word, index) => {
            const key = normalizeArabicWord(word);
            const differs = !otherWords.has(key);
            return (
              <Text
                key={`${index}:${word}`}
                style={
                  differs
                    ? { textDecorationLine: "underline" }
                    : sharedWords.has(key)
                      ? { color: accent, fontWeight: "700" }
                      : undefined
                }
              >
                {index > 0 ? ` ${word}` : word}
              </Text>
            );
          })
        ) : (
          <>
            {reference.pre ? `${reference.pre}${reference.similar ? " " : ""}` : ""}
            {reference.similar ? <Text style={{ color: accent, fontWeight: "700" }}>{reference.similar}</Text> : null}
            {reference.post ? `${reference.pre || reference.similar ? " " : ""}${reference.post}` : ""}
          </>
        )}
      </Text>
      {context?.after ? (
        <Text style={CONTEXT_STYLE} className="text-warm-700 dark:text-neutral-400">
          {`${context.after} …`}
        </Text>
      ) : null}
      {meaning && meaning.text ? (
        // Set apart from the verse, in the interface font and direction, so it never reads as Quran text.
        <View className="mt-1 pt-2 border-t border-warm-200 dark:border-neutral-800" style={{ gap: 2 }}>
          <Text dir={dir} variant="label-md" className="text-warm-700 dark:text-neutral-400">
            {meaning.label}
          </Text>
          <Text dir={dir} variant="body-sm" className="text-charcoal dark:text-neutral-200">
            {meaning.text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
