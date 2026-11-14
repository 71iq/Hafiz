import { useState } from "react";
import { Pressable, View } from "react-native";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { SimilarVerseLine } from "@/components/hifz/SimilarVerseLine";
import { formatAyahRef } from "@/lib/arabic";
import type { DatabaseExecutor } from "@/lib/database/types";
import { formatNumber } from "@/lib/i18n/count";
import { meaningKey, type MeaningLanguage } from "@/lib/hifz/meanings";
import type { SimilarGroup, SimilarRef } from "@/lib/hifz/similar";
import { useVerseMeanings } from "@/lib/hifz/use-verse-meanings";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";

type Props = {
  db: DatabaseExecutor;
  groups: readonly SimilarGroup[];
  language: MeaningLanguage;
  isRTL: boolean;
  accent: string;
  s: UIStrings;
  width: number;
};

/** Siblings shown at first in a group; a group can hold up to 29, so the rest wait behind a button. */
const SIBLINGS_SHOWN = 3;

function verseKey(ref: SimilarRef): string {
  return `${ref.surah}:${ref.ayah}`;
}

/**
 * MUT-01, MUT-05: the sabaq step that compares each chunk ayah with the similar verses already
 * memorized, one card per group. The verse being memorized shows its meaning in the interface
 * language; each sibling's waits behind "Show translation", and a group shows its first three
 * siblings, then "Show n more", so a page with many similar verses stays short. The meanings are read
 * once for the step, not on each render.
 */
export function SimilarVerseComparison({ db, groups, language, isRTL, accent, s, width }: Props) {
  const meanings = useVerseMeanings(
    db,
    groups.flatMap((group) => [group.self, ...group.siblings]),
    language,
  );
  const [openMeanings, setOpenMeanings] = useState<ReadonlySet<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const dir = isRTL ? "rtl" : "ltr";
  const meaningOf = (ref: SimilarRef) => {
    const text = meanings.get(meaningKey(ref));
    return text
      ? { label: interpolate(s.hifzSimilarMeaning, { ref: formatAyahRef(isRTL, ref.surah, ref.ayah) }), text }
      : null;
  };
  const toggle = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    next.add(key);
    return next;
  };
  return (
    <View style={{ width, gap: 10 }}>
      {groups.map((group) => {
        const groupKey = `${group.groupId}-${verseKey(group.self)}`;
        const shown = openGroups.has(groupKey) ? group.siblings : group.siblings.slice(0, SIBLINGS_SHOWN);
        const hidden = group.siblings.length - shown.length;
        return (
          <Card key={groupKey} elevation="low" className="p-4" style={{ gap: 12 }}>
            {/* The verse being memorized against each sibling, and each sibling against it: the words that
                differ, in order, are underlined (MUT-01). */}
            <SimilarVerseLine
              reference={group.self}
              isRTL={isRTL}
              accent={accent}
              compareWith={group.siblings}
              meaning={meaningOf(group.self)}
              pageTemplate={s.hifzPageN}
            />
            {shown.map((sibling) => {
              const key = `${groupKey}-${verseKey(sibling)}`;
              const meaning = meaningOf(sibling);
              return (
                // A rule above each sibling, so a meaning reads with the verse above it, not the next.
                <View key={key} className="pt-3 border-t border-warm-200 dark:border-neutral-800" style={{ gap: 4 }}>
                  <SimilarVerseLine
                    reference={sibling}
                    isRTL={isRTL}
                    accent={accent}
                    muted
                    compareWith={[group.self]}
                    meaning={openMeanings.has(key) ? meaning : null}
                    pageTemplate={s.hifzPageN}
                  />
                  {meaning && !openMeanings.has(key) ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setOpenMeanings((current) => toggle(current, key))}
                      className="min-h-[44px] justify-center"
                      style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}
                    >
                      <Text dir={dir} variant="label-md" style={{ color: accent }}>
                        {s.hifzSimilarShowMeaning}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
            {hidden > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setOpenGroups((current) => toggle(current, groupKey))}
                className="min-h-[44px] justify-center pt-3 border-t border-warm-200 dark:border-neutral-800"
              >
                <Text dir={dir} align="center" variant="label-md" style={{ color: accent }}>
                  {interpolate(s.hifzSimilarShowMore, { n: formatNumber(hidden, isRTL ? "ar" : "en") })}
                </Text>
              </Pressable>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}
