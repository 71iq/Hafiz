import { View } from "react-native";
import { Card } from "@/components/ui/Card";
import { SimilarVerseLine } from "@/components/hifz/SimilarVerseLine";
import type { DatabaseExecutor } from "@/lib/database/types";
import { meaningKey, type MeaningLanguage } from "@/lib/hifz/meanings";
import type { SimilarGroup, SimilarRef } from "@/lib/hifz/similar";
import { useVerseMeanings } from "@/lib/hifz/use-verse-meanings";
import type { UIStrings } from "@/lib/i18n/strings";

type Props = {
  db: DatabaseExecutor;
  groups: readonly SimilarGroup[];
  language: MeaningLanguage;
  isRTL: boolean;
  accent: string;
  s: UIStrings;
  width: number;
};

/**
 * MUT-01, MUT-05: the sabaq step that compares each chunk ayah with the similar verses already
 * memorized, one card per group, each verse with its meaning in the interface language. The meanings
 * are read once for the step, not on each render.
 */
export function SimilarVerseComparison({ db, groups, language, isRTL, accent, s, width }: Props) {
  const meanings = useVerseMeanings(
    db,
    groups.flatMap((group) => [group.self, ...group.siblings]),
    language,
  );
  const meaningOf = (ref: SimilarRef) => {
    const text = meanings.get(meaningKey(ref));
    return text ? { label: s.hifzSimilarMeaning, text } : null;
  };
  return (
    <View style={{ width, gap: 10 }}>
      {groups.map((group) => (
        <Card
          key={`${group.groupId}-${group.self.surah}:${group.self.ayah}`}
          elevation="low"
          className="p-4"
          style={{ gap: 10 }}
        >
          {/* The verse being memorized against each sibling, and each sibling against it: the words that
              differ, in order, are underlined (MUT-01). */}
          <SimilarVerseLine
            reference={group.self}
            isRTL={isRTL}
            accent={accent}
            compareWith={group.siblings}
            meaning={meaningOf(group.self)}
          />
          {group.siblings.map((sibling) => (
            <SimilarVerseLine
              key={`${sibling.surah}:${sibling.ayah}`}
              reference={sibling}
              isRTL={isRTL}
              accent={accent}
              muted
              compareWith={[group.self]}
              meaning={meaningOf(sibling)}
            />
          ))}
        </Card>
      ))}
    </View>
  );
}
