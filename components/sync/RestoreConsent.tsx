import { Pressable, Text, View } from "react-native";
import { CloudOff } from "lucide-react-native";
import { BusyIndicator } from "@/components/ui/BusyIndicator";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuthStore } from "@/lib/auth/store";
import type { RestoreCategory, RestoreConsentRequest } from "@/lib/database/sync";
import { formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useRestoreConsent, useSyncRestorePause } from "@/lib/sync/restore-consent";

const CATEGORY_LABEL: Record<RestoreCategory, keyof UIStrings> = {
  studyCards: "syncRestoreCategoryStudyCards",
  reviewHistory: "syncRestoreCategoryReviewHistory",
  bookmarks: "syncRestoreCategoryBookmarks",
  highlights: "syncRestoreCategoryHighlights",
  notes: "syncRestoreCategoryNotes",
  journey: "syncRestoreCategoryJourney",
  achievements: "syncRestoreCategoryAchievements",
  wordMeanings: "syncRestoreCategoryWordMeanings",
  habitDays: "syncRestoreCategoryHabitDays",
  reviewSessions: "syncRestoreCategoryReviewSessions",
  recitationErrors: "syncRestoreCategoryRecitationErrors",
  settings: "syncRestoreCategorySettings",
};

function consentMessage(request: RestoreConsentRequest, s: UIStrings, language: "en" | "ar"): string {
  const intro = request.accountEmail
    ? interpolate(s.syncRestoreIntroNamed, { account: request.accountEmail })
    : s.syncRestoreIntro;
  const lines = request.summary.categories.map(
    ({ key, count }) => `• ${String(s[CATEGORY_LABEL[key]])}: ${formatNumber(count, language)}`,
  );
  if (request.summary.pendingChanges > 0) {
    lines.push(`• ${s.syncRestorePendingChanges}: ${formatNumber(request.summary.pendingChanges, language)}`);
  }
  return [intro, ...lines, "", s.syncRestoreReadingAvailable].join("\n");
}

/**
 * The one restore confirmation, mounted where sync results are handled. Use account progress submits
 * only the opaque token; Cancel sync (or dismissing) stores the account's pause and keeps local data.
 */
export function RestoreConsentDialog() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { request, busy, issue, accept, cancel, prepareAgain } = useRestoreConsent(userId);
  const { isDark, isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  if (!request) return null;
  const needsPreparation = issue === "expired" || issue === "failed";
  const issueText =
    issue === "stale"
      ? s.syncRestoreStale
      : issue === "expired"
        ? s.syncRestoreExpired
        : issue === "failed"
          ? s.syncRestoreFailed
          : null;
  return (
    <ConfirmDialog
      visible
      title={s.syncRestoreTitle}
      message={consentMessage(request, s, uiLanguage)}
      cancelLabel={s.syncRestoreCancel}
      confirmLabel={needsPreparation ? s.syncRestorePrepareAgain : s.syncRestoreUseAccount}
      destructive={!needsPreparation}
      emphasis="cancel"
      confirmLoading={busy === "accepting" || busy === "resuming"}
      confirmDisabled={busy === "cancelling"}
      error={issueText}
      isDark={isDark}
      isRTL={isRTL}
      onCancel={cancel}
      onConfirm={needsPreparation ? prepareAgain : accept}
    />
  );
}

/** A persistent Sync paused / Resume sync status beside the sync indicator. */
export function SyncPausedStatus() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { paused, resuming, resume } = useSyncRestorePause(userId);
  const { isDark, isRTL } = useSettings();
  const s = useStrings();
  if (!paused) return null;
  const color = isDark ? "#d4d4d4" : "#5c4a3a";
  return (
    <Pressable
      onPress={resume}
      disabled={resuming}
      accessibilityRole="button"
      accessibilityLabel={`${s.syncPaused}. ${s.syncResume}`}
      accessibilityState={{ busy: resuming, disabled: resuming }}
      // Rows set their own order from the UI direction, as MirroredRow does.
      style={{ direction: "ltr" }}
      className={`min-h-11 items-center gap-2 rounded-full border border-warm-200 bg-surface px-4 dark:border-neutral-700 dark:bg-surface-dark ${
        isRTL ? "flex-row-reverse" : "flex-row"
      }`}
    >
      {resuming ? <BusyIndicator size="small" color={color} /> : <CloudOff size={16} color={color} />}
      <View style={{ direction: "ltr" }} className={isRTL ? "flex-row-reverse gap-1" : "flex-row gap-1"}>
        <Text className="text-warm-600 dark:text-neutral-300" style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}>
          {s.syncPaused}
        </Text>
        <Text
          className="text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
        >
          {s.syncResume}
        </Text>
      </View>
    </Pressable>
  );
}
