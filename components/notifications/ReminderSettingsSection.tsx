import { Minus, Plus } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, View } from "react-native";
import { PrayerTimesSetup, CALCULATION_METHOD_LABEL_KEYS } from "@/components/notifications/PrayerTimesSetup";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { SwitchRow, SwitchTrack } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { useDatabase } from "@/lib/database/provider";
import { addDays } from "@/lib/habit/dates";
import type { UIStringKey } from "@/lib/i18n/strings";
import { interpolate, useStrings } from "@/lib/i18n/useStrings";
import { exportWirdCalendar } from "@/lib/notifications/calendar";
import { deviceClock, formatClockMinutesForDisplay } from "@/lib/notifications/clock";
import { LATE_REMINDER_MINUTES } from "@/lib/notifications/day-times";
import {
  getNotificationPermission,
  openNotificationSystemSettings,
  requestNotificationPermission,
} from "@/lib/notifications/permission";
import type { PermissionState } from "@/lib/notifications/platform-types";
import { isRamadan } from "@/lib/notifications/ramadan";
import { previewReminders, rescheduleReminders, type ReminderPreview } from "@/lib/notifications/schedule";
import { readReminderPrefs, writeReminderPref, type ReminderPrefChange } from "@/lib/notifications/settings";
import { localizeDigits, prayerLabel } from "@/lib/notifications/templates";
import {
  DEFAULT_ANCHOR,
  MAX_PRAYER_OFFSET_MINUTES,
  NOTIFICATION_TYPES,
  type NotificationType,
  type RamadanAnchor,
  type ReminderAnchor,
  type ReminderPrefs,
} from "@/lib/notifications/types";
import { readPrayerLocation } from "@/lib/prayer/settings";
import { PRAYERS, type PrayerLocation, type PrayerName } from "@/lib/prayer/times";
import { useSettings } from "@/lib/settings/context";

const TYPE_LABELS: Readonly<Record<NotificationType, readonly [UIStringKey, UIStringKey]>> = {
  wird_reminder: ["notifTypeWird", "notifTypeWirdHint"],
  streak_at_risk: ["notifTypeStreak", "notifTypeStreakHint"],
  remind_later: ["notifTypeRemindLater", "notifTypeRemindLaterHint"],
  late_reminder: ["notifTypeLate", "notifTypeLateHint"],
  makeup_window: ["notifTypeMakeUp", "notifTypeMakeUpHint"],
  grace_used: ["notifTypeGrace", "notifTypeGraceHint"],
  earnback_open: ["notifTypeEarnBack", "notifTypeEarnBackHint"],
  friday_kahf: ["notifTypeKahf", "notifTypeKahfHint"],
  group_encouragement: ["notifTypeGroup", "notifTypeGroupHint"],
  comeback: ["notifTypeComeback", "notifTypeComebackHint"],
};

const OFFSET_STEP = 5;
const CLOCK_STEP = 15;
/** "Morning" in the plan anchor list (3.3). */
const DEFAULT_CLOCK_MINUTES = 6 * 60;
type RamadanChoice = RamadanAnchor | "usual";
/** Outline buttons need a visible edge; the shared outline variant is transparent only. */
const OUTLINE_BORDER = "border border-warm-300 dark:border-neutral-700";

type ReminderSwitchRowProps = {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

/** The whole row is the 44 pt target and the accessible switch; the visual switch is decorative. */
function ReminderSwitchRow({ label, hint, value, onValueChange, disabled }: ReminderSwitchRowProps) {
  return (
    <SwitchRow
      label={label}
      hint={hint}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      style={{ minHeight: 44, justifyContent: "center", paddingVertical: 6 }}
    >
      <MirroredRow className="items-center gap-3">
        <View style={{ flex: 1 }}>
          <Text variant="title-md">{label}</Text>
          {hint ? <Text variant="caption">{hint}</Text> : null}
        </View>
        <SwitchTrack value={value} disabled={disabled} />
      </MirroredRow>
    </SwitchRow>
  );
}

type StepperProps = {
  value: string;
  decreaseLabel: string;
  increaseLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease: boolean;
  canIncrease: boolean;
  iconColor: string;
};

/** Minus stays on the left and plus on the right in both languages, like a number line. */
function Stepper({ value, decreaseLabel, increaseLabel, onDecrease, onIncrease, canDecrease, canIncrease, iconColor }: StepperProps) {
  return (
    <View style={{ direction: "ltr", flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Button
        variant="outline"
        size="icon"
        className={`h-11 w-11 ${OUTLINE_BORDER}`}
        onPress={onDecrease}
        disabled={!canDecrease}
        accessibilityLabel={decreaseLabel}
      >
        <Minus size={18} color={iconColor} />
      </Button>
      <Text variant="title-md" style={{ flex: 1 }} align="center" accessibilityLiveRegion="polite">
        {value}
      </Text>
      <Button
        variant="outline"
        size="icon"
        className={`h-11 w-11 ${OUTLINE_BORDER}`}
        onPress={onIncrease}
        disabled={!canIncrease}
        accessibilityLabel={increaseLabel}
      >
        <Plus size={18} color={iconColor} />
      </Button>
    </View>
  );
}

/**
 * Reminder settings (5.8, NOT-11): a master switch, a switch per type that never touches the
 * others, the reminder time after a prayer or at a clock time, the Ramadan time, prayer-time
 * location, the app-icon badge and the calendar file. Every change replans reminders (NOT-04).
 * The screen supplies the section heading (notifSettingsTitle).
 */
export function ReminderSettingsSection() {
  const db = useDatabase();
  const s = useStrings();
  const { isRTL, isDark, uiLanguage } = useSettings();
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [location, setLocation] = useState<PrayerLocation | null>(null);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [prayerSheetOpen, setPrayerSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isWeb = Platform.OS === "web";
  const iconColor = isDark ? "#E5E5E5" : "#3F3F46";

  const refresh = useCallback(async () => {
    const [nextPrefs, nextPermission, nextLocation, nextPreview] = await Promise.all([
      readReminderPrefs(db),
      getNotificationPermission(),
      readPrayerLocation(db),
      previewReminders(db, { language: uiLanguage }),
    ]);
    setPrefs(nextPrefs);
    setPermission(nextPermission);
    setLocation(nextLocation);
    setPreview(nextPreview);
  }, [db, uiLanguage]);

  useEffect(() => {
    refresh().catch(() => setError(s.notifSaveFailed));
    // Permission can change in system settings while Hafiz is in the background.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh().catch(() => {});
    });
    return () => subscription.remove();
  }, [refresh, s.notifSaveFailed]);

  const update = async (change: ReminderPrefChange) => {
    setError(null);
    try {
      await writeReminderPref(db, change);
      await rescheduleReminders(db, { language: uiLanguage });
    } catch {
      setError(s.notifSaveFailed);
    }
    await refresh().catch(() => {});
  };

  const allowNotifications = async () => {
    if (permission && permission.status !== "granted" && !permission.canAskAgain) {
      await openNotificationSystemSettings();
      return;
    }
    setPermission(await requestNotificationPermission(db));
    await refresh().catch(() => {});
  };

  const addToCalendar = async () => {
    setError(null);
    try {
      await exportWirdCalendar(db, { language: uiLanguage });
    } catch {
      setError(s.notifCalendarFailed);
    }
  };

  if (!prefs) return null;

  const anchor = prefs.anchor;
  const setAnchor = (value: ReminderAnchor) => void update({ kind: "anchor", value });
  const today = deviceClock.dateOf(new Date());
  const showRamadan = prefs.ramadanAnchor !== null || isRamadan(today);
  const nativeBlocked = !isWeb && permission !== null && permission.status !== "granted";

  const whenText = (() => {
    if (!preview?.next) return null;
    const time = formatClockMinutesForDisplay(deviceClock.minutesOf(preview.next.at), uiLanguage);
    if (preview.next.localDate === today) return interpolate(s.notifWhenToday, { time });
    if (preview.next.localDate === addDays(today, 1)) return interpolate(s.notifWhenTomorrow, { time });
    const date = new Intl.DateTimeFormat(uiLanguage, { weekday: "long" }).format(preview.next.at);
    return interpolate(s.notifWhenLater, { date, time });
  })();

  return (
    <View className="gap-4">
      <Card elevation="low" className="p-5 gap-3">
        <ReminderSwitchRow
          label={s.notifMasterLabel}
          hint={s.notifMasterHint}
          value={prefs.enabled}
          onValueChange={(value) => void update({ kind: "enabled", value })}
        />
        {nativeBlocked && prefs.enabled && (
          <View className="gap-2">
            <Text variant="body-sm">{s.notifPermissionOff}</Text>
            <Button
              variant="outline"
              className={OUTLINE_BORDER}
              onPress={() => void allowNotifications()}
              label={permission?.canAskAgain ? s.notifAllowButton : s.notifOpenSystemSettings}
            />
          </View>
        )}
        {isWeb && <Text variant="body-sm">{s.notifWebNote}</Text>}
        <Text variant="caption">{s.notifLimitsNote}</Text>
      </Card>

      {prefs.enabled && (
        <Card elevation="low" className="p-5 gap-3">
          <Text variant="title-md">{s.notifAnchorTitle}</Text>
          <ToggleGroup<ReminderAnchor["kind"]>
            value={anchor.kind}
            onValueChange={(kind) => {
              if (kind === anchor.kind) return;
              setAnchor(kind === "clock" ? { kind: "clock", minutes: DEFAULT_CLOCK_MINUTES } : DEFAULT_ANCHOR);
            }}
            items={[
              { value: "prayer", label: s.notifAnchorAfterPrayer },
              { value: "clock", label: s.notifAnchorClock },
            ]}
          />
          {anchor.kind === "prayer" ? (
            <>
              <ToggleGroup<PrayerName>
                value={anchor.prayer}
                onValueChange={(prayer) => setAnchor({ ...anchor, prayer })}
                itemClassName="flex-auto px-2"
                accessibilityLabel={s.notifAnchorPrayerLabel}
                items={PRAYERS.map((prayer) => ({ value: prayer, label: prayerLabel(prayer, uiLanguage) }))}
              />
              <Stepper
                value={interpolate(s.notifAnchorOffset, {
                  prayer: prayerLabel(anchor.prayer, uiLanguage),
                  minutes: localizeDigits(anchor.offsetMinutes, uiLanguage),
                })}
                decreaseLabel={s.notifOffsetEarlier}
                increaseLabel={s.notifOffsetLater}
                canDecrease={anchor.offsetMinutes > 0}
                canIncrease={anchor.offsetMinutes < MAX_PRAYER_OFFSET_MINUTES}
                onDecrease={() => setAnchor({ ...anchor, offsetMinutes: Math.max(0, anchor.offsetMinutes - OFFSET_STEP) })}
                onIncrease={() =>
                  setAnchor({ ...anchor, offsetMinutes: Math.min(MAX_PRAYER_OFFSET_MINUTES, anchor.offsetMinutes + OFFSET_STEP) })
                }
                iconColor={iconColor}
              />
            </>
          ) : (
            <Stepper
              value={interpolate(s.notifClockValue, { time: formatClockMinutesForDisplay(anchor.minutes, uiLanguage) })}
              decreaseLabel={s.notifClockEarlier}
              increaseLabel={s.notifClockLater}
              canDecrease
              canIncrease
              onDecrease={() => setAnchor({ kind: "clock", minutes: (anchor.minutes - CLOCK_STEP + 1440) % 1440 })}
              onIncrease={() => setAnchor({ kind: "clock", minutes: (anchor.minutes + CLOCK_STEP) % 1440 })}
              iconColor={iconColor}
            />
          )}
          {whenText && <Text variant="body-sm">{interpolate(s.notifNextReminder, { when: whenText })}</Text>}

          {showRamadan && (
            <View className="gap-2">
              <Text variant="title-sm">{s.notifRamadanTitle}</Text>
              <ToggleGroup<RamadanChoice>
                value={prefs.ramadanAnchor ?? "usual"}
                onValueChange={(choice) => void update({ kind: "ramadanAnchor", value: choice === "usual" ? null : choice })}
                itemClassName="flex-auto px-2"
                items={[
                  { value: "usual", label: s.notifRamadanUsual },
                  { value: "after_taraweeh", label: s.notifRamadanAfterTaraweeh },
                  { value: "before_suhoor", label: s.notifRamadanBeforeSuhoor },
                ]}
              />
            </View>
          )}

          <MirroredRow className="items-center gap-3" style={{ minHeight: 44 }}>
            <View style={{ flex: 1 }}>
              <Text variant="title-sm">{s.notifPrayerTimesTitle}</Text>
              <Text variant="caption">
                {location ? s[CALCULATION_METHOD_LABEL_KEYS[location.method]] : s.notifPrayerTimesNotSet}
              </Text>
            </View>
            <Button
              variant="outline"
              size="sm"
              className={`h-11 ${OUTLINE_BORDER}`}
              onPress={() => setPrayerSheetOpen(true)}
              label={location ? s.notifPrayerTimesEdit : s.notifPrayerTimesSetup}
            />
          </MirroredRow>
        </Card>
      )}

      {prefs.enabled && (
        <Card elevation="low" className="p-5 gap-1">
          <Text variant="title-md" className="mb-2">
            {s.notifTypesTitle}
          </Text>
          {NOTIFICATION_TYPES.map((type) => {
            if (isWeb && type === "remind_later") return null;
            const [labelKey, hintKey] = TYPE_LABELS[type];
            const label =
              type === "late_reminder"
                ? interpolate(s[labelKey], { time: formatClockMinutesForDisplay(LATE_REMINDER_MINUTES, uiLanguage) })
                : s[labelKey];
            return (
              <ReminderSwitchRow
                key={type}
                label={label}
                hint={s[hintKey]}
                value={prefs.types[type]}
                onValueChange={(value) => void update({ kind: "type", type, value })}
              />
            );
          })}
          {!isWeb && (
            <ReminderSwitchRow
              label={s.notifBadgeLabel}
              hint={s.notifBadgeHint}
              value={prefs.badge}
              onValueChange={(value) => void update({ kind: "badge", value })}
            />
          )}
        </Card>
      )}

      <Button variant="outline" className={OUTLINE_BORDER} onPress={() => void addToCalendar()} label={s.notifCalendarButton} />
      {error && (
        <Text variant="body-sm" accessibilityLiveRegion="polite" className="text-red-600 dark:text-red-400">
          {error}
        </Text>
      )}

      <ResponsiveSheet open={prayerSheetOpen} onClose={() => setPrayerSheetOpen(false)} maxWidth={560} maxHeight="92%">
        <OverlayHeader title={s.notifPrayerTimesTitle} onClose={() => setPrayerSheetOpen(false)} isRTL={isRTL} />
        <OverlayBody contentContainerClassName="px-5 pb-8">
          <PrayerTimesSetup
            onChange={(next) => {
              setLocation(next);
              refresh().catch(() => {});
            }}
            onDone={() => setPrayerSheetOpen(false)}
          />
        </OverlayBody>
      </ResponsiveSheet>
    </View>
  );
}
