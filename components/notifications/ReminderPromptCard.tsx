import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { BellRing } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import type { AppDatabase } from "@/lib/database/types";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatClockMinutes } from "@/lib/notifications/clock";
import { declineNotificationPrompt, requestNotificationPermission, shouldOfferNotificationPrompt } from "@/lib/notifications/permission";
import { readReminderPrefs } from "@/lib/notifications/settings";
import { localizeDigits, prayerLabel } from "@/lib/notifications/templates";
import type { ReminderAnchor } from "@/lib/notifications/types";

/** Whether the session end may ask for notification permission now (ONB-02, ONB-03), with the reminder time. */
export function useReminderOffer(db: AppDatabase): ReminderAnchor | null {
  const [anchor, setAnchor] = useState<ReminderAnchor | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      if (!(await shouldOfferNotificationPrompt(db))) return;
      const prefs = await readReminderPrefs(db);
      if (active) setAnchor(prefs.anchor);
    })().catch((error) => console.warn("[Reminders] Could not check the permission offer:", error));
    return () => {
      active = false;
    };
  }, [db]);
  return anchor;
}

/**
 * The contextual permission card (5.8.2, ONB-02): says when the reminder comes before the system
 * prompt appears. Allow and Not now each count as one of the 4 prompts.
 */
export function ReminderPromptCard({
  db,
  anchor,
  language,
  isDark,
  s,
}: {
  db: AppDatabase;
  anchor: ReminderAnchor;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
}) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const [answered, setAnswered] = useState(false);
  const reason =
    anchor.kind === "prayer"
      ? interpolate(s.notifPermissionReasonPrayer, { prayer: prayerLabel(anchor.prayer, language) })
      : interpolate(s.notifPermissionReasonClock, { time: localizeDigits(formatClockMinutes(anchor.minutes), language) });

  if (answered) return null;

  const allow = () => {
    setAnswered(true);
    requestNotificationPermission(db).catch((error) => console.warn("[Reminders] Permission request failed:", error));
  };
  const decline = () => {
    setAnswered(true);
    declineNotificationPrompt(db).catch((error) => console.warn("[Reminders] Could not record the answer:", error));
  };

  return (
    <Card elevation="low" className="px-5 py-4">
      <MirroredRow dir={dir} className="items-center gap-2">
        <BellRing size={16} color={accent} />
        <Text dir={dir} className="text-charcoal dark:text-neutral-100" style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}>
          {s.notifPromptTitle}
        </Text>
      </MirroredRow>
      <Text dir={dir} variant="caption" className="mt-1.5" style={{ lineHeight: 18 }}>
        {reason}
      </Text>
      <View className="mt-3" style={{ gap: 6 }}>
        <Button label={s.notifAllowButton} onPress={allow} />
        <Pressable accessibilityRole="button" onPress={decline} className="min-h-[44px] items-center justify-center">
          <Text className="text-warm-500 dark:text-neutral-400" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
            {s.notifSkip}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}
