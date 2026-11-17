import { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SocialErrorText, SocialToggleRow, socialRowStyle } from "@/components/social/SocialControls";
import { Button } from "@/components/ui/Button";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Text } from "@/components/ui/Text";
import { useAuthStore } from "@/lib/auth/store";
import { boardKeys } from "@/lib/board/api";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  fetchLegacyHalaqaIds,
  fetchProfilePrivacy,
  leaveLegacyHalaqas,
  ProfilePrivacyChangedError,
  profilePrivacyKeys,
  saveProfilePrivacy,
  type ProfilePrivacy,
} from "@/lib/profile/privacy";
import { useSettings } from "@/lib/settings/context";
import { socialFailureMessage } from "@/lib/social/messages";
import { requireSocialOwner } from "@/lib/social/owner";

type Visibility = Pick<ProfilePrivacy, "showStreak" | "showJuzCompletions" | "isMinor">;

/**
 * Settings, Privacy and sharing (SOC-01, ETH-07): what the public profile shows, the under-18 setting,
 * and a way out of halaqas an earlier version joined, whose members and teachers still read what was
 * shared. Mount it only while open, so each open reads the stored choices again.
 *
 * ETH-07: saving sends the minority the form loaded, which the server compares. A cached copy can
 * predate another device changing it, so the profile choices appear only after a read that completed
 * while the sheet is open. When the stored values change, the drafts start again from them.
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

  const freshKey = fresh ? `${fresh.isMinor}:${fresh.showStreak}:${fresh.showJuzCompletions}` : null;
  const [draft, setDraft] = useState({ key: freshKey, loaded: fresh, visibility: fresh });
  if (draft.key !== freshKey) setDraft({ key: freshKey, loaded: fresh, visibility: fresh });
  const { loaded, visibility } = draft.key === freshKey ? draft : { loaded: fresh, visibility: fresh };
  const setVisible = (key: keyof Visibility) => (value: boolean) =>
    setDraft((current) =>
      current.visibility ? { ...current, visibility: { ...current.visibility, [key]: value } } : current,
    );

  const halaqas = useQuery({
    queryKey: profilePrivacyKeys.legacyHalaqas(userId),
    queryFn: () => fetchLegacyHalaqaIds(requireSocialOwner(userId)),
    retry: false,
    networkMode: "always",
    refetchOnMount: "always",
  });

  const [saveError, setSaveError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: Visibility & { expectedMinor: boolean }) =>
      saveProfilePrivacy(input, requireSocialOwner(userId)),
    onSuccess: async (saved) => {
      onNotice(saved.leftBoard ? s.socialSavedLeftBoard : s.socialSaved);
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.mine(userId) }),
        // Recording minority leaves matched halaqas on the server.
        queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.legacyHalaqas(userId) }),
        saved.leftBoard ? queryClient.invalidateQueries({ queryKey: boardKeys.all(userId) }) : null,
        // Recording minority clears the photo on the server, so the signed-in profile reloads.
        saved.isMinor ? useAuthStore.getState().fetchProfile() : null,
      ]);
    },
    onError: (error) => {
      if (error instanceof ProfilePrivacyChangedError) {
        // Another device changed the age setting. The choices reload and the person decides again.
        setSaveError(s.socialErrorPrivacyChanged);
        void privacy.refetch();
        return;
      }
      setSaveError(socialFailureMessage(error, s));
    },
  });

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [left, setLeft] = useState(false);
  const leave = useMutation({
    mutationFn: () => leaveLegacyHalaqas(requireSocialOwner(userId)),
    onSuccess: async () => {
      setLeft(true);
      setConfirmLeave(false);
      await queryClient.invalidateQueries({ queryKey: profilePrivacyKeys.legacyHalaqas(userId) });
    },
  });

  const pending = save.isPending || leave.isPending;
  const close = () => {
    if (!pending) onClose();
  };
  const startButton = { alignSelf: isRTL ? "flex-end" : "flex-start" } as const;
  const outline = "h-11 px-4 border border-warm-300 dark:border-neutral-700";
  const inHalaqa = (halaqas.data?.length ?? 0) > 0;

  return (
    <ResponsiveSheet open onClose={close} dismissOnBackdrop={!pending} maxWidth={560} maxHeight="88%">
      <OverlayHeader title={s.privacySettingsTitle} onClose={close} showHandle isRTL={isRTL} />
      <OverlayBody contentContainerClassName="gap-1 px-5 pb-4 pt-2">
        <Text variant="title-md" accessibilityRole="header">
          {s.profileVisibilityTitle}
        </Text>
        {visibility ? (
          <>
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
          // Placeholder rows where the three choices will be, so the sheet does not jump when they load.
          <View
            accessible
            accessibilityLabel={s.privacyLoading}
            accessibilityState={{ busy: true }}
            className="gap-3 pt-1"
          >
            {[0, 1, 2].map((index) => (
              <View key={index} className="items-center justify-between gap-3 py-2" style={socialRowStyle(isRTL)}>
                <SkeletonText width={index === 2 ? "40%" : "55%"} lineHeight={14} />
                <Skeleton width={44} height={26} borderRadius={13} />
              </View>
            ))}
          </View>
        )}

        {/* Shown only to someone an earlier version left in a halaqa, or whose list could not be read. */}
        {inHalaqa || left || (halaqas.isError && !halaqas.isFetching) ? (
          <View className="mt-4 gap-2 border-t border-warm-200 pt-4 dark:border-neutral-800">
            <Text variant="title-md" accessibilityRole="header">
              {s.legacyHalaqaTitle}
            </Text>
            {left && !inHalaqa ? (
              <Text variant="body-sm" className="text-warm-700 dark:text-neutral-300" accessibilityLiveRegion="polite">
                {s.legacyHalaqaLeft}
              </Text>
            ) : inHalaqa ? (
              <>
                <Text variant="body-sm" className="text-warm-700 dark:text-neutral-300">
                  {confirmLeave ? s.legacyHalaqaConfirm : s.legacyHalaqaBody}
                </Text>
                {leave.isError ? <SocialErrorText message={socialFailureMessage(leave.error, s)} /> : null}
                {confirmLeave ? (
                  <View className="gap-3" style={socialRowStyle(isRTL)}>
                    <Button
                      variant="ghost"
                      className="flex-1"
                      label={s.legacyHalaqaKeep}
                      onPress={() => setConfirmLeave(false)}
                      disabled={pending}
                    />
                    <Button
                      variant="destructive"
                      className="flex-1"
                      label={s.legacyHalaqaConfirmLeave}
                      onPress={() => leave.mutate()}
                      disabled={pending}
                      accessibilityState={{ disabled: pending, busy: leave.isPending }}
                    />
                  </View>
                ) : (
                  <View style={startButton}>
                    <Button
                      variant="outline"
                      className={outline}
                      label={s.legacyHalaqaLeave}
                      onPress={() => {
                        leave.reset();
                        setConfirmLeave(true);
                      }}
                      disabled={pending}
                    />
                  </View>
                )}
              </>
            ) : (
              <View className="gap-2">
                <Text
                  variant="body-sm"
                  className="text-warm-700 dark:text-neutral-300"
                  accessibilityLiveRegion="polite"
                >
                  {socialFailureMessage(halaqas.error, s)}
                </Text>
                <View style={startButton}>
                  <Button
                    variant="outline"
                    className={outline}
                    label={s.socialTryAgain}
                    onPress={() => void halaqas.refetch()}
                  />
                </View>
              </View>
            )}
          </View>
        ) : null}
      </OverlayBody>
      <OverlayFooter isRTL={isRTL} className="px-5 pb-5">
        {/* The footer is a row: this column takes its width, so the error sits above the buttons and
            their row has a width for flex-1 to share. */}
        <View className="flex-1">
          {saveError ? (
            <View className="mb-3">
              <SocialErrorText message={saveError} />
            </View>
          ) : null}
          <View className="gap-3" style={socialRowStyle(isRTL)}>
            <Button variant="ghost" className="flex-1" label={s.socialCancel} onPress={close} disabled={pending} />
            <Button
              className="flex-1"
              label={s.socialSave}
              onPress={() => {
                if (!visibility || !loaded) return;
                setSaveError(null);
                save.mutate({ ...visibility, expectedMinor: loaded.isMinor });
              }}
              disabled={pending || !visibility}
              accessibilityState={{ disabled: pending || !visibility, busy: save.isPending }}
            />
          </View>
        </View>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}
