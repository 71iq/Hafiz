import { Fragment, type ReactNode } from "react";
import { View } from "react-native";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { formatAyahRef } from "@/lib/arabic";
import { formatNumber } from "@/lib/i18n/count";
import { interpolate } from "@/lib/i18n/useStrings";
import type { SimilarRef } from "@/lib/hifz/similar";
import { differingWords } from "@/lib/hifz/word-diff";

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
   * The verses to tell this one apart from: the other verse of an answered prompt, or the siblings in
   * a comparison. The words that differ from any of them, compared in order so a moved or repeated word
   * counts too (differingWords), are underlined, and only the shared ones keep the accent.
   */
  compareWith?: readonly SimilarRef[] | null;
  /** MUT-05: the verse's meaning in the interface language, with the label naming its source. */
  meaning?: { label: string; text: string } | null;
  /** MUT-01's context cue: "Page {{n}}", added after the reference when given. */
  pageTemplate?: string;
};

const CONTEXT_STYLE = { writingDirection: "rtl", textAlign: "right", fontSize: 15, lineHeight: 26 } as const;

function verseWords(reference: SimilarRef): string[] {
  return [reference.pre, reference.similar, reference.post].join(" ").split(/\s+/).filter(Boolean);
}

/**
 * "النبأ 78:2 · Page 582": the Arabic surah name isolated in English so the digits after it keep their
 * order, and the page when a template is given (MUT-01). An Arabic comma joins it in Arabic, since a
 * middle dot beside Arabic-Indic digits reads as a zero.
 */
function referenceLabel(reference: SimilarRef, isRTL: boolean, pageTemplate?: string): string {
  const label = `${reference.surahName}${isRTL ? "" : "\u200E"} ${formatAyahRef(isRTL, reference.surah, reference.ayah)}`;
  if (!pageTemplate) return label;
  return `${label}${isRTL ? "، " : " · "}${interpolate(pageTemplate, { n: formatNumber(reference.page, isRTL ? "ar" : "en") })}`;
}

/**
 * Which words to underline: those that differ inside the shared passage, plus the nearest differing
 * word on each side of it, where the verses part. The rest of the surrounding text differs anyway, so
 * marking it would bury the difference that matters.
 */
function underlined(differs: readonly boolean[], from: number, to: number): boolean[] {
  const marks = differs.map((differs, index) => differs && index >= from && index < to);
  for (let index = from - 1; index >= 0; index -= 1) {
    if (differs[index]) {
      marks[index] = true;
      break;
    }
  }
  for (let index = to; index < differs.length; index += 1) {
    if (differs[index]) {
      marks[index] = true;
      break;
    }
  }
  return marks;
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
  pageTemplate,
}: Props) {
  const dir = isRTL ? "rtl" : "ltr";
  const context = reference.context;
  const words = verseWords(reference);
  const differs = compareWith && compareWith.length > 0 ? differingWords(words, compareWith.map(verseWords)) : null;
  // The marked passage's positions in the verse: the words after the part before it.
  const sharedFrom = reference.pre.split(/\s+/).filter(Boolean).length;
  const sharedTo = sharedFrom + reference.similar.split(/\s+/).filter(Boolean).length;
  const marks = differs ? underlined(differs, sharedFrom, sharedTo) : null;
  return (
    <View style={{ gap: 4 }}>
      {showReference ? (
        <MirroredRow dir={dir} className="items-center gap-1.5">
          <Text dir={dir} variant="caption">
            {referenceLabel(reference, isRTL, pageTemplate)}
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
          {referenceLabel(reference, isRTL, pageTemplate)}
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
        {marks ? (
          words.map((word, index) => {
            const inPassage = index >= sharedFrom && index < sharedTo;
            return (
              // The space stays outside the word, so an underline never runs under it.
              <Fragment key={`${index}:${word}`}>
                {index > 0 ? " " : ""}
                <Text
                  // Around the passage the text is muted, unless it holds where the verses part.
                  className={inPassage || marks[index] ? undefined : "text-warm-700 dark:text-neutral-400"}
                  style={
                    marks[index]
                      ? { textDecorationLine: "underline" }
                      : inPassage
                        ? { color: accent, fontWeight: "700" }
                        : undefined
                  }
                >
                  {word}
                </Text>
              </Fragment>
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
        <View className="mt-1" style={{ gap: 2 }}>
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
