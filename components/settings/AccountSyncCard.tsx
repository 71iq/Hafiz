import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { CloudOff, RefreshCw } from "lucide-react-native";
import { SyncIndicator, useSyncStatusDetails, type SyncStatusDetails } from "@/components/ui/SyncIndicator";
import { useAuthStore } from "@/lib/auth/store";
import { formatNumber } from "@/lib/i18n/count";
import { formatRelativeTime } from "@/lib/i18n/relative-time";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { useSyncRestorePause } from "@/lib/sync/restore-consent";
import { textStartStyle } from "@/lib/ui/direction";

export function lastSyncedLabel(lastSyncedAt: string | null, s: UIStrings, language: "en" | "ar", now = Date.now()) {
  if (!lastSyncedAt) return s.accountNotSyncedYet;
  const time = formatRelativeTime(lastSyncedAt, s.justNow, language, now);
  return time ? interpolate(s.accountLastSynced, { time }) : s.accountNotSyncedYet;
}

export function accountSyncSummary(
  details: Pick<SyncStatusDetails, "status" | "pendingCount" | "failure">,
  paused: boolean,
  s: UIStrings,
  language: "en" | "ar",
): { text: string; tone: "muted" | "error" } {
  if (paused) return { text: s.accountSyncPausedHint, tone: "muted" };
  if (details.status === "syncing") return { text: s.syncStateSyncing, tone: "muted" };
  if (details.status === "offline" || details.failure === "offline")
    return { text: s.accountSyncFailedOffline, tone: "muted" };
  if (details.failure === "failed") return { text: s.accountSyncFailedServer, tone: "error" };
  if (details.failure === "partial") return { text: s.accountSyncFailedPartial, tone: "error" };
  if (details.pendingCount > 0)
    return {
      text: interpolate(s.accountSyncPending, { count: formatNumber(details.pendingCount, language) }),
      tone: "muted",
    };
  return { text: s.accountSyncUpToDate, tone: "muted" };
}

export function AccountSyncCard() {
  const s = useStrings();
  const { isDark, isRTL, uiLanguage } = useSettings();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const details = useSyncStatusDetails();
  const { paused, resuming, resume } = useSyncRestorePause(userId);
  const [manualBusy, setManualBusy] = useState(false);
  const manualRun = useRef(0);
  const summary = accountSyncSummary(details, paused, s, uiLanguage);
  const busy = details.status === "syncing" || manualBusy || resuming;
  const hasFailure = details.failure === "failed" || details.failure === "partial";
  const actionLabel = paused ? s.syncResume : hasFailure ? s.accountSyncRetry : s.accountSyncNow;
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const textDirection = { ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" } as const;

  const runAction = useCallback(() => {
    if (busy) return;
    if (paused) {
      resume();
      return;
    }
    const run = ++manualRun.current;
    setManualBusy(true);
    details
      .syncNow()
      .catch(() => {})
      .finally(() => {
        if (manualRun.current === run) setManualBusy(false);
      });
  }, [busy, details, paused, resume]);

  return (
    <View
      className="mb-4 rounded-3xl bg-surface p-4 dark:bg-surface-dark"
      accessibilityLabel={s.accountSyncOpenDetails}
    >
      <View className="items-center gap-3" style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row" }}>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
          {paused ? <CloudOff size={18} color={accent} /> : <RefreshCw size={18} color={accent} />}
        </View>
        <View className="min-w-0 flex-1">
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textDirection }}
          >
            {paused ? s.syncPaused : s.accountSyncTitle}
          </Text>
          <Text
            className="mt-0.5 text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 17, ...textDirection }}
          >
            {lastSyncedLabel(details.lastSyncedAt, s, uiLanguage)}
          </Text>
        </View>
        <SyncIndicator status={details.status} isDark={isDark} hideSuccess />
      </View>
      <Text
        accessibilityLiveRegion="polite"
        className={
          summary.tone === "error" ? "mt-3 text-red-600 dark:text-red-400" : "mt-3 text-warm-500 dark:text-neutral-400"
        }
        style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19, ...textDirection }}
      >
        {summary.text}
      </Text>
      <Pressable
        onPress={runAction}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ disabled: busy, busy }}
        className="mt-3 min-h-11 items-center justify-center gap-2 rounded-full bg-primary-accent px-4"
        style={({ pressed }) => ({
          direction: isRTL ? "rtl" : "ltr",
          flexDirection: "row",
          opacity: busy ? 0.6 : pressed ? 0.8 : 1,
        })}
      >
        {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <RefreshCw size={15} color="#FFFFFF" />}
        <Text style={{ color: "#FFFFFF", fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>{actionLabel}</Text>
      </Pressable>
      <Text
        className="mt-3 text-warm-500 dark:text-neutral-400"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, ...textDirection }}
      >
        {s.accountOptionalLogin}
      </Text>
    </View>
  );
}
