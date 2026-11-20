import { useRef, useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SocialToggleRow, socialRowStyle } from "@/components/social/SocialControls";
import { Button } from "@/components/ui/Button";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Text } from "@/components/ui/Text";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  fetchProfilePrivacy,
  profilePrivacyKeys,
  saveProfilePrivacy,
  type ProfilePrivacy,
} from "@/lib/profile/privacy";
import { useSettings } from "@/lib/settings/context";
import { socialFailureMessage } from "@/lib/social/messages";
import { captureSocialOwner, requireSocialOwner } from "@/lib/social/owner";

type Visibility = Pick<ProfilePrivacy, "showStreak" | "showJuzCompletions">;

/**
 * Settings, Privacy and sharing (SOC-01): what the public profile shows. Mount it only while open, so
 * each open reads the stored choices again.
 *
 * Saving writes both choices, and a cached copy can predate another device changing one, so they
 * appear only after a read that completed while the sheet is open. When the stored values change, the
 * drafts start again from them.
 *
 * Save acts at once. It closes the sheet with "Saved" and the app uses the new choices while the
 * server stores them; a refusal restores the stored choices and says so through `onNotice`, which
 * outlives the sheet.
 */
export function ProfilePrivacySheet({
  userId,
  onClose,
  onNotice,
}: {
  userId: string;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const s = useStrings();
  const { isRTL } = useSettings();
  const queryClient = useQueryClient();

  const privacy = useQuery({
    queryKey: profilePrivacyKeys.mine(userId),
    queryFn: () => fetchProfilePrivacy(requireSocialOwner(userId)),
    retry: false,
    networkMode: "always",
    refetchOnMount: "always",
  });
  const [verified, setVerified] = useState(false);
  const readSinceOpen = privacy.isFetchedAfterMount && privacy.isSuccess && !privacy.isFetching;
  if (readSinceOpen && !verified) setVerified(true);
  const fresh: Visibility | null = (verified || readSinceOpen) && privacy.data ? privacy.data : null;

  const freshKey = fresh ? `${fresh.showStreak}:${fresh.showJuzCompletions}` : null;
  const [draft, setDraft] = useState({ key: freshKey, visibility: fresh });
  if (draft.key !== freshKey) setDraft({ key: freshKey, visibility: fresh });
  const visibility = draft.key === freshKey ? draft.visibility : fresh;
  const setVisible = (key: keyof Visibility) => (value: boolean) =>
    setDraft((current) =>
      current.visibility ? { ...current, visibility: { ...current.visibility, [key]: value } } : current,
    );


  // Save runs once per press.
  const saving = useRef(false);

  const save = () => {
    if (!visibility || !privacy.data || saving.current) return;
    const owner = captureSocialOwner(userId);
    if (!owner) return;
    saving.current = true;
    const key = profilePrivacyKeys.mine(userId);
    const before = queryClient.getQueryData<ProfilePrivacy>(key);
    const shown: ProfilePrivacy = { ...(before ?? privacy.data), ...visibility };
    queryClient.setQueryData(key, shown);
    onNotice(s.socialSaved);
    onClose();
    saveProfilePrivacy(visibility, owner).then(
      async () => {
        if (!owner.isCurrent()) return;
        await queryClient.invalidateQueries({ queryKey: key });
      },
      (error: unknown) => {
        // The stored choices still apply: show them again and read them back.
        if (queryClient.getQueryData(key) === shown) queryClient.setQueryData(key, before);
        void queryClient.invalidateQueries({ queryKey: key });
        if (!owner.isCurrent()) return;
        onNotice(`${s.privacyNotSaved} ${socialFailureMessage(error, s)}`);
      },
    );
  };


  const startButton = { alignSelf: isRTL ? "flex-end" : "flex-start" } as const;
  const outline = "h-11 px-4 border border-warm-300 dark:border-neutral-700";

  return (
    <ResponsiveSheet open onClose={onClose} maxWidth={560} maxHeight="88%">
      <OverlayHeader title={s.privacySettingsTitle} onClose={onClose} showHandle isRTL={isRTL} />
      <OverlayBody contentContainerClassName="gap-1 px-5 pb-4 pt-2">
        <Text variant="title-md" accessibilityRole="header">
          {s.profileVisibilityTitle}
        </Text>
        {visibility ? (
          <>
            <SocialToggleRow
              label={s.profileShowStreak}
              value={visibility.showStreak}
              onValueChange={setVisible("showStreak")}
            />
            <SocialToggleRow
              label={s.profileShowJuz}
              value={visibility.showJuzCompletions}
              onValueChange={setVisible("showJuzCompletions")}
            />
          </>
        ) : privacy.isError && !privacy.isFetching ? (
          <View className="gap-2 pt-1">
            <Text variant="body-sm" className="text-warm-700 dark:text-neutral-300" accessibilityLiveRegion="polite">
              {socialFailureMessage(privacy.error, s)}
            </Text>
            <View style={startButton}>
              <Button
                variant="outline"
                className={outline}
                label={s.socialTryAgain}
                onPress={() => void privacy.refetch()}
              />
            </View>
          </View>
        ) : (
          // Placeholder rows where the two choices will be, so the sheet does not jump when they load.
          <View
            accessible
            accessibilityLabel={s.privacyLoading}
            accessibilityState={{ busy: true }}
            className="gap-3 pt-1"
          >
            {[0, 1].map((index) => (
              <View key={index} className="items-center justify-between gap-3 py-2" style={socialRowStyle(isRTL)}>
                <SkeletonText width="55%" lineHeight={14} />
                <Skeleton width={44} height={26} borderRadius={13} />
              </View>
            ))}
          </View>
        )}
      </OverlayBody>
      <OverlayFooter isRTL={isRTL} className="px-5 pb-5">
        {/* The footer is a row: this column takes its width, so the buttons' row has a width for
            flex-1 to share. */}
        <View className="flex-1">
          <View className="gap-3" style={socialRowStyle(isRTL)}>
            <Button variant="ghost" className="flex-1" label={s.socialCancel} onPress={onClose} />
            <Button
              className="flex-1"
              label={s.socialSave}
              onPress={save}
              disabled={!visibility}
              accessibilityState={{ disabled: !visibility }}
            />
          </View>
        </View>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}
