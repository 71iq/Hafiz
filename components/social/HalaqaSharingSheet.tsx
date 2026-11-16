import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import type { HalaqaSharing } from "@/lib/halaqa/api";
import { useStrings } from "@/lib/i18n/useStrings";
import type { ProfilePrivacy } from "@/lib/profile/privacy";
import { useSettings } from "@/lib/settings/context";
import { SocialErrorText, SocialToggleRow, socialRowStyle } from "./SocialControls";

export type ProfileVisibility = Pick<ProfilePrivacy, "showStreak" | "showJuzCompletions" | "isMinor">;
export type ProfileVisibilityChange = ProfileVisibility & { expectedMinor: boolean };

export function HalaqaSharingSheet({
  open,
  sharing,
  privacy,
  privacyNotice,
  pending,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  sharing: HalaqaSharing;
  privacy: ProfileVisibility | null;
  privacyNotice?: { message: string; onRetry?: () => void; loading?: boolean } | null;
  pending: boolean;
  error: string | null;
  onSave: (sharing: HalaqaSharing, privacy: ProfileVisibilityChange | null) => void;
  onClose: () => void;
}) {
  const s = useStrings();
  const { isRTL } = useSettings();
  const [draft, setDraft] = useState(sharing);
  const privacyKey = privacy ? `${privacy.isMinor}:${privacy.showStreak}:${privacy.showJuzCompletions}` : null;
  const [profile, setProfile] = useState({ key: privacyKey, loaded: privacy, visibility: privacy });
  if (profile.key !== privacyKey) setProfile({ key: privacyKey, loaded: privacy, visibility: privacy });
  const { loaded, visibility } = profile.key === privacyKey ? profile : { loaded: privacy, visibility: privacy };
  const set = (key: keyof HalaqaSharing) => (value: boolean) => setDraft((current) => ({ ...current, [key]: value }));
  const setVisible = (key: keyof ProfileVisibility) => (value: boolean) =>
    setProfile((current) => (current.visibility ? { ...current, visibility: { ...current.visibility, [key]: value } } : current));
  const close = () => {
    if (!pending) onClose();
  };

  return (
    <ResponsiveSheet open={open} onClose={close} dismissOnBackdrop={!pending} maxWidth={560} maxHeight="88%">
      <OverlayHeader title={s.halaqaSharingTitle} onClose={close} showHandle isRTL={isRTL} />
      <OverlayBody contentContainerClassName="gap-1 px-5 pb-4 pt-2">
        <SocialToggleRow
          label={s.halaqaShareConsistency}
          hint={s.halaqaShareConsistencyHint}
          value={draft.consistency}
          onValueChange={set("consistency")}
          disabled={pending}
        />
        <SocialToggleRow label={s.halaqaShareJuz} value={draft.juz} onValueChange={set("juz")} disabled={pending} />
        <SocialToggleRow
          label={s.halaqaSharePlan}
          hint={s.halaqaSharePlanHint}
          value={draft.planWithTeachers}
          onValueChange={set("planWithTeachers")}
          disabled={pending}
        />
        <SocialToggleRow
          label={s.halaqaShareGrades}
          value={draft.gradesWithTeachers}
          onValueChange={set("gradesWithTeachers")}
          disabled={pending}
        />
        <Text variant="caption" className="mb-4">
          {s.halaqaTeacherShareHint}
        </Text>

        {visibility ? (
          <View className="gap-1 border-t border-warm-200 pt-4 dark:border-neutral-800">
            <Text variant="title-md" accessibilityRole="header">
              {s.profileVisibilityTitle}
            </Text>
            <Text variant="caption" className="mb-1">
              {s.socialIntentionNote}
            </Text>
            <SocialToggleRow
              label={s.profileShowStreak}
              value={visibility.showStreak && !visibility.isMinor}
              onValueChange={setVisible("showStreak")}
              disabled={pending || visibility.isMinor}
            />
            <SocialToggleRow
              label={s.profileShowJuz}
              value={visibility.showJuzCompletions && !visibility.isMinor}
              onValueChange={setVisible("showJuzCompletions")}
              disabled={pending || visibility.isMinor}
            />
            <SocialToggleRow
              label={s.profileIsMinor}
              hint={s.profileIsMinorHint}
              value={visibility.isMinor}
              onValueChange={setVisible("isMinor")}
              disabled={pending}
            />
          </View>
        ) : privacyNotice ? (
          <View className="gap-2 border-t border-warm-200 pt-4 dark:border-neutral-800">
            <Text variant="title-md" accessibilityRole="header">
              {s.profileVisibilityTitle}
            </Text>
            {privacyNotice.loading ? (
              <View accessible accessibilityLabel={privacyNotice.message} accessibilityState={{ busy: true }} className="gap-3 pt-1">
                {[0, 1, 2].map((index) => (
                  <View key={index} className="items-center justify-between gap-3 py-2" style={socialRowStyle(isRTL)}>
                    <SkeletonText width={index === 2 ? "40%" : "55%"} lineHeight={14} />
                    <Skeleton width={44} height={26} borderRadius={13} />
                  </View>
                ))}
              </View>
            ) : (
              <>
                <Text variant="body-sm" className="text-warm-700 dark:text-neutral-300" accessibilityLiveRegion="polite">
                  {privacyNotice.message}
                </Text>
                {privacyNotice.onRetry ? (
                  <View style={{ alignSelf: isRTL ? "flex-end" : "flex-start" }}>
                    <Button
                      variant="outline"
                      className="h-11 px-4 border border-warm-300 dark:border-neutral-700"
                      label={s.socialTryAgain}
                      onPress={privacyNotice.onRetry}
                      disabled={pending}
                    />
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </OverlayBody>
      <OverlayFooter isRTL={isRTL} className="px-5 pb-5">
        {error ? (
          <View className="mb-3">
            <SocialErrorText message={error} />
          </View>
        ) : null}
        <View className="gap-3" style={socialRowStyle(isRTL)}>
          <Button variant="ghost" className="flex-1" label={s.socialCancel} onPress={close} disabled={pending} />
          <Button
            className="flex-1"
            label={s.socialSave}
            onPress={() => onSave(draft, visibility && loaded ? { ...visibility, expectedMinor: loaded.isMinor } : null)}
            disabled={pending}
            accessibilityState={{ disabled: pending, busy: pending }}
          />
        </View>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}
