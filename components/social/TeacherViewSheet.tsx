import { ActivityIndicator, View } from "react-native";
import { z } from "zod";
import { Card } from "@/components/ui/Card";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import type { TeacherView } from "@/lib/halaqa/api";
import { formatDays, formatPages } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { formatSocialDate, socialNumber } from "@/lib/social/text";
import { newPerDayFromPlan } from "@/lib/social/bands";
import { socialRowStyle, useSocialAccent } from "./SocialControls";

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

const planCycle = z.object({ cycle_days: z.number().int().positive().optional() }).passthrough();

function cycleDays(plan: string | null): number | null {
  if (!plan) return null;
  try {
    const parsed = planCycle.safeParse(JSON.parse(plan));
    return parsed.success ? (parsed.data.cycle_days ?? null) : null;
  } catch {
    return null;
  }
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
  const { accent } = useSocialAccent();
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
        {loading ? <ActivityIndicator color={accent} /> : null}
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
                          pages: formatPages(newPerDayFromPlan(view.plan.hifzPlan), language),
                        })}
                      </Text>
                      {cycleDays(view.plan.hifzPlan) !== null ? (
                        <Text variant="body-sm">
                          {interpolate(s.teacherViewCycle, {
                            days: formatDays(cycleDays(view.plan.hifzPlan) ?? 0, language),
                          })}
                        </Text>
                      ) : null}
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
                      <Text variant="body-sm" dir="ltr">
                        {grade.cardId}
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
