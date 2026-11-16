import { Fragment, type ReactNode } from "react";
import { Platform, Text as RNText, View } from "react-native";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import { formatAyahRef, toArabicNumber } from "@/lib/arabic";
import { formatNumber } from "@/lib/i18n/count";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import type { SimilarRef } from "@/lib/hifz/similar";
import { differingWords } from "@/lib/hifz/word-diff";

type Props = {
  reference: SimilarRef;
  isRTL: boolean;
  accent: string;
  muted?: boolean;
  showReference?: boolean;
  status?: ReactNode;
  compareWith?: readonly SimilarRef[] | null;
  meaning?: { label: string; text: string } | null;
  pageTemplate?: string;
};

const CONTEXT_STYLE = { writingDirection: "rtl", textAlign: "right", fontSize: 15, lineHeight: 26 } as const;
const UNDERLINE_STYLE = {
  textDecorationLine: "underline",
  ...(Platform.OS === "web" ? { textDecorationSkipInk: "none" } : null),
} as const;
const AYAH_END_STYLE = { fontSize: 15 } as const;
const SCREEN_READER_ONLY = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  opacity: 0,
  userSelect: "none",
} as const;

function verseWords(reference: SimilarRef): string[] {
  return [reference.pre, reference.similar, reference.post].join(" ").split(/\s+/).filter(Boolean);
}

const segmentWords = (text: string) => text.split(/\s+/).filter(Boolean);

function differingParts(reference: SimilarRef, others: readonly SimilarRef[]): boolean[] {
  const part = (pick: (ref: SimilarRef) => string) =>
    differingWords(segmentWords(pick(reference)), others.map((other) => segmentWords(pick(other))));
  return [...part((ref) => ref.pre), ...part((ref) => ref.similar), ...part((ref) => ref.post)];
}

function GapMark({ label }: { label: string }) {
  const web = Platform.OS === "web";
  return (
    <>
      <RNText className="text-warm-700 dark:text-neutral-400" aria-hidden={web}>
        {"\u00A0…"}
      </RNText>
      {web ? <RNText style={SCREEN_READER_ONLY}>{` ${label} `}</RNText> : null}
    </>
  );
}

function spokenVerse(
  words: readonly string[],
  ayahEnds: ReadonlyMap<number, number>,
  gaps: ReadonlySet<number>,
  label: string,
  isRTL: boolean,
): string {
  const comma = isRTL ? "،" : ",";
  return words
    .map((word, index) => {
      const ayah = ayahEnds.get(index);
      return `${word}${ayah !== undefined ? ` (${toArabicNumber(ayah)})` : ""}${gaps.has(index) ? `${comma} ${label}${comma}` : ""}`;
    })
    .join(" ");
}

function referenceLabel(reference: SimilarRef, isRTL: boolean, pageTemplate?: string): string {
  const label = `${reference.surahName}${isRTL ? "" : "\u200E"} ${formatAyahRef(isRTL, reference.surah, reference.ayah)}`;
  if (!pageTemplate) return label;
  return `${label}${isRTL ? "، " : " · "}${interpolate(pageTemplate, { n: formatNumber(reference.page, isRTL ? "ar" : "en") })}`;
}

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
  const differs = compareWith && compareWith.length > 0 ? differingParts(reference, compareWith) : null;
  const sharedFrom = reference.pre.split(/\s+/).filter(Boolean).length;
  const sharedTo = sharedFrom + reference.similar.split(/\s+/).filter(Boolean).length;
  const marks = differs ? underlined(differs, sharedFrom, sharedTo) : null;
  const ayahEnds = new Map((reference.ayahEnds ?? []).map((end) => [end.after, end.ayah]));
  const gaps = new Set(reference.gaps ?? []);
  const gapLabel = strings[isRTL ? "ar" : "en"].hifzSimilarWordsLeftOut;
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
        <Text dir={dir} variant="caption">
          {reference.surahName}
        </Text>
      ) : (
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
        accessibilityLabel={
          gaps.size > 0 && Platform.OS !== "web" ? spokenVerse(words, ayahEnds, gaps, gapLabel, isRTL) : undefined
        }
      >
        {words.map((word, index) => {
          const inPassage = index >= sharedFrom && index < sharedTo;
          const underline = marks?.[index] === true;
          const ayahEnd = ayahEnds.get(index);
          return (
            <Fragment key={`${index}:${word}`}>
              {index > 0 ? " " : ""}
              <RNText
                className={marks && !inPassage && !underline ? "text-warm-700 dark:text-neutral-400" : undefined}
                style={underline ? UNDERLINE_STYLE : inPassage ? { color: accent, fontWeight: "700" } : undefined}
              >
                {word}
              </RNText>
              {ayahEnd !== undefined ? (
                <RNText className="text-warm-700 dark:text-neutral-400" style={AYAH_END_STYLE}>
                  {`\u00A0(${toArabicNumber(ayahEnd)})`}
                </RNText>
              ) : null}
              {gaps.has(index) ? <GapMark label={gapLabel} /> : null}
            </Fragment>
          );
        })}
      </Text>
      {context?.after ? (
        <Text style={CONTEXT_STYLE} className="text-warm-700 dark:text-neutral-400">
          {`${context.after} …`}
        </Text>
      ) : null}
      {meaning && meaning.text ? (
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
