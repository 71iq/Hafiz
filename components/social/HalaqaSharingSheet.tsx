import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/Button";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Text } from "@/components/ui/Text";
import type { HalaqaSharing } from "@/lib/halaqa/api";
import { useStrings } from "@/lib/i18n/useStrings";
import type { ProfilePrivacy } from "@/lib/profile/privacy";
import { useSettings } from "@/lib/settings/context";
import { SocialErrorText, SocialToggleRow, socialRowStyle } from "./SocialControls";

export type ProfileVisibility = Pick<ProfilePrivacy, "showStreak" | "showJuzCompletions" | "isMinor">;
/** The profile choices to save, with the minority the sheet loaded, which the server compares. */
export type ProfileVisibilityChange = ProfileVisibility & { expectedMinor: boolean };

/**
 * Sharing choices (SOC-01, SOC-03, ETH-07): what this halaqa's members and teachers see, and what the
 * public profile shows. Mount it with a key per open so the drafts start from the saved values. Pass
 * `privacy` only from a read that completed while the sheet is open: saving a stale copy is refused by
 * the server. Without it the profile choices are not shown or saved, and `privacyNotice` says why.
 * When `privacy` arrives or its stored values change, only the profile choices start again from it;
 * the halaqa choices the person already changed stay.
 */
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
  privacyNotice?: { message: string; onRetry?: () => void } | null;
  pending: boolean;
  error: string | null;
  onSave: (sharing: HalaqaSharing, privacy: ProfileVisibilityChange | null) => void;
  onClose: () => void;
}) {
  const s = useStrings();
  const { isRTL } = useSettings();
  const [draft, setDraft] = useState(sharing);
  // The profile choices start from the stored values they were loaded from, which the save sends as
  // the expected minority, and start again only when those stored values change.
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
            <Text variant="caption" accessibilityLiveRegion="polite">
              {privacyNotice.message}
            </Text>
            {privacyNotice.onRetry ? (
              <Button variant="ghost" label={s.socialTryAgain} onPress={privacyNotice.onRetry} disabled={pending} />
            ) : null}
          </View>
        ) : null}
        <SocialErrorText message={error} />
      </OverlayBody>
      <OverlayFooter isRTL={isRTL} className="px-5 pb-5">
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
