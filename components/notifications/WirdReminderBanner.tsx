import { X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { useDatabase } from "@/lib/database/provider";
import { subscribeReviewActivity } from "@/lib/fsrs/review-events";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  answerRamadanOffer,
  dismissReminderBanner,
  loadReminderBanner,
  type ReminderBanner,
} from "@/lib/notifications/banner";
import { openReminderRoute } from "@/lib/notifications/reminder-route";
import type { RamadanAnchor, ReminderRoute } from "@/lib/notifications/types";
import { useSettings } from "@/lib/settings/context";

export type WirdReminderBannerProps = {
  /** Called on "Start". Defaults to the reminder's own route: the wird review for the plan, al-Kahf or Home. */
  onStart?: (route: ReminderRoute) => void;
};

/**
 * In-app reminder (NOT-03). On web it replaces scheduled notifications; on native it shows only
 * while notifications are not allowed. It also carries the one-time Ramadan time offer (NOT-10).
 * Renders nothing when there is no reminder due. Refreshes on focus and after reviews.
 */
export function WirdReminderBanner({ onStart }: WirdReminderBannerProps) {
  const db = useDatabase();
  const s = useStrings();
  const { isRTL, isDark, uiLanguage } = useSettings();
  const [banner, setBanner] = useState<ReminderBanner | null>(null);
  const row = isRTL ? "row-reverse" : "row";

  const refresh = useCallback(() => {
    loadReminderBanner(db, { language: uiLanguage })
      .then(setBanner)
      .catch(() => setBanner(null));
  }, [db, uiLanguage]);

  useEffect(() => {
    refresh();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const unsubscribe = subscribeReviewActivity(refresh);
    return () => {
      appState.remove();
      unsubscribe();
    };
  }, [refresh]);

  if (!banner) return null;

  const dismiss = () => {
    setBanner(null);
    dismissReminderBanner(db, banner).catch(() => {});
  };

  if (banner.kind === "ramadan_offer") {
    const choose = (choice: RamadanAnchor | null) => {
      setBanner(null);
      answerRamadanOffer(db, { hijriYear: banner.hijriYear, choice }).catch(() => {});
    };
    return (
      <Card elevation="mid" className="p-4 gap-3" accessibilityRole="alert">
        <Text variant="body">{s.notifRamadanOffer}</Text>
        <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
          <Button size="sm" className="h-11" onPress={() => choose("after_taraweeh")} label={s.notifRamadanAfterTaraweeh} />
          <Button size="sm" className="h-11" onPress={() => choose("before_suhoor")} label={s.notifRamadanBeforeSuhoor} />
          <Button size="sm" variant="ghost" className="h-11" onPress={() => choose(null)} label={s.notifRamadanKeep} />
        </View>
      </Card>
    );
  }

  const start = () => {
    dismiss();
    if (onStart) onStart(banner.route);
    else openReminderRoute(db, banner.route).catch(() => {});
  };

  return (
    <Card elevation="mid" className="p-4" accessibilityRole="alert" accessibilityLabel={`${s.notifBannerLabel}: ${banner.title}`}>
      <View style={{ flexDirection: row, alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title-md">{banner.title}</Text>
          <Text variant="body-sm">{banner.body}</Text>
        </View>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel={s.notifBannerDismiss}
          hitSlop={4}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <X size={18} color={isDark ? "#E5E5E5" : "#3F3F46"} />
        </Pressable>
      </View>
      {banner.route !== "home" || onStart ? (
        <View style={{ flexDirection: row, marginTop: 8 }}>
          <Button size="sm" className="h-11" onPress={start} label={s.notifBannerStart} />
        </View>
      ) : null}
    </Card>
  );
}
