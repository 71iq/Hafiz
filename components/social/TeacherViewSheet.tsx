import { View } from "react-native";
import { Card } from "@/components/ui/Card";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import type { TeacherView } from "@/lib/halaqa/api";
import { parsePageUnit } from "@/lib/hifz/units";
import { formatDays, formatNumber, formatPages } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { formatSocialDate, socialNumber } from "@/lib/social/text";
import { newPagesPerDay } from "@/lib/social/bands";
import { socialRowStyle } from "./SocialControls";
import { TeacherViewSkeleton } from "./SocialSkeletons";

type Language = "en" | "ar";

const STAGE_KEYS: ReadonlyArray<readonly [string, keyof UIStrings]> = [
  ["sabaq", "teacherViewStageSabaq"],
  ["sabqi", "teacherViewStageSabqi"],
  ["manzil", "teacherViewStageManzil"],
  ["manzil.needs_work", "teacherViewStageNeedsWork"],
  ["manzil.unverified", "teacherViewStageUnverified"],
];

const GRADE_KEYS: Readonly<Record<number, keyof UIStrings>> = {
  1: "teacherViewGradeAgain",
  2: "teacherViewGradeHard",
  3: "teacherViewGradeGood",
  4: "teacherViewGradeEasy",
};

/** Ayah-based card ids: "2:255", or a prefixed form such as "qiraat:2:255" or "word:2:255:3". */
const AYAH_CARD_PATTERN = /^(?:[a-z-]+:)?(\d{1,3}):(\d{1,3})(?::\d+)?$/;

/**
 * A recent grade's card in words: "Page 582", "Page 582, first half", "Page 582 into 583",
 * "Surah 2, ayah 255". Card ids are storage keys and are never shown as written.
 */
export function teacherCardLabel(cardId: string, language: Language, s: UIStrings): string {
  const unit = parsePageUnit(cardId);
  if (unit) {
    const n = formatNumber(unit.page, language);
    switch (unit.kind) {
      case "page":
        return interpolate(s.teacherViewUnitPage, { n });
      case "half":
        return interpolate(unit.half === "a" ? s.teacherViewUnitHalfA : s.teacherViewUnitHalfB, { n });
      case "seam":
        return interpolate(s.teacherViewUnitSeam, { n, next: formatNumber(unit.page + 1, language) });
      case "chunk":
        return interpolate(s.teacherViewUnitLines, {
          n,
          from: formatNumber(unit.fromLine, language),
          to: formatNumber(unit.toLine, language),
        });
    }
  }
  const ayah = AYAH_CARD_PATTERN.exec(cardId);
  if (ayah) {
    const surah = Number(ayah[1]);
    if (surah >= 1 && surah <= 114) {
      return interpolate(s.teacherViewUnitAyah, {
        surah: formatNumber(surah, language),
        ayah: formatNumber(Number(ayah[2]), language),
      });
    }
  }
  return s.teacherViewUnitOther;
}

/**
 * SOC-03: what a member chose to share with this halaqa's teachers. Sections the member did not share
 * say so; mistakes themselves and recordings are never part of it.
 */
export function TeacherViewSheet({
  memberName,
  view,
  loading,
  error,
  onClose,
}: {
  memberName: string | null;
  view: TeacherView | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const s = useStrings();
  const { isRTL, uiLanguage } = useSettings();
  const language: Language = uiLanguage === "ar" ? "ar" : "en";
  const name = view?.name ?? memberName ?? "";

  return (
    <ResponsiveSheet open={memberName !== null} onClose={onClose} dismissOnBackdrop maxWidth={600} maxHeight="88%">
      <OverlayHeader
        title={interpolate(s.teacherViewTitle, { name })}
        subtitle={s.teacherViewNote}
        onClose={onClose}
        showHandle
        isRTL={isRTL}
      />
      <OverlayBody contentContainerClassName="gap-4 px-5 pb-6 pt-2">
        {loading ? <TeacherViewSkeleton label={s.loading} /> : null}
        {error ? <Text variant="body-sm">{error}</Text> : null}
        {view ? (
          <>
            <Card elevation="low" className="gap-2 p-4">
              <Text variant="title-md" accessibilityRole="header">
                {s.teacherViewPlan}
              </Text>
              {view.plan === null ? (
                <Text variant="body-sm">{s.teacherViewNotShared}</Text>
              ) : (
                <>
                  {view.plan.hifzPlan ? (
                    <>
                      <Text variant="body-sm">
                        {interpolate(s.teacherViewNewPerDay, {
                          pages: formatPages(newPagesPerDay(view.plan.hifzPlan), language),
                        })}
                      </Text>
                      <Text variant="body-sm">
                        {interpolate(s.teacherViewCycle, { days: formatDays(view.plan.hifzPlan.cycleDays, language) })}
                      </Text>
                    </>
                  ) : (
                    <Text variant="body-sm">{s.teacherViewNoPlan}</Text>
                  )}
                  <Text variant="title-sm" className="mt-2">
                    {s.teacherViewStages}
                  </Text>
                  {STAGE_KEYS.map(([tier, key]) => (
                    <View key={tier} className="min-h-8 items-center justify-between" style={socialRowStyle(isRTL)}>
                      <Text variant="body-sm">{s[key]}</Text>
                      <Text variant="title-sm">{socialNumber(view.plan?.tiers[tier] ?? 0, language)}</Text>
                    </View>
                  ))}
                </>
              )}
            </Card>

            <Card elevation="low" className="gap-2 p-4">
              <Text variant="title-md" accessibilityRole="header">
                {s.teacherViewGrades}
              </Text>
              {view.grades === null ? (
                <Text variant="body-sm">{s.teacherViewNotShared}</Text>
              ) : (
                <>
                  <Text variant="body-sm">
                    {interpolate(s.teacherViewInbox, { n: socialNumber(view.grades.mistakeInboxCount, language) })}
                  </Text>
                  {view.grades.recent.length === 0 ? <Text variant="body-sm">{s.teacherViewNoGrades}</Text> : null}
                  {view.grades.recent.map((grade) => (
                    <View
                      key={`${grade.cardId}-${grade.reviewedAt}`}
                      className="min-h-8 items-center justify-between gap-3"
                      style={socialRowStyle(isRTL)}
                    >
                      <Text variant="body-sm" className="min-w-0 flex-1">
                        {teacherCardLabel(grade.cardId, language, s)}
                      </Text>
                      <Text variant="caption">{formatSocialDate(grade.localDate ?? grade.reviewedAt, language)}</Text>
                      <Text variant="title-sm">{GRADE_KEYS[grade.rating] ? s[GRADE_KEYS[grade.rating]] : "–"}</Text>
                    </View>
                  ))}
                </>
              )}
            </Card>
          </>
        ) : null}
      </OverlayBody>
    </ResponsiveSheet>
  );
}
