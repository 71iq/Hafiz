import { X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
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
  const { isDark, uiLanguage } = useSettings();
  const [banner, setBanner] = useState<ReminderBanner | null>(null);

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
      // Its own top gap, since it renders nothing when there is no reminder (Home's header sits above).
      <Card elevation="mid" className="mt-4 p-4 gap-3" accessibilityRole="alert">
        <Text variant="body">{s.notifRamadanOffer}</Text>
        <MirroredRow className="flex-wrap gap-2">
          <Button size="sm" className="h-11" onPress={() => choose("after_taraweeh")} label={s.notifRamadanAfterTaraweeh} />
          <Button size="sm" className="h-11" onPress={() => choose("before_suhoor")} label={s.notifRamadanBeforeSuhoor} />
          <Button size="sm" variant="ghost" className="h-11" onPress={() => choose(null)} label={s.notifRamadanKeep} />
        </MirroredRow>
      </Card>
    );
  }

  const start = () => {
    dismiss();
    if (onStart) onStart(banner.route);
    else openReminderRoute(db, banner.route).catch(() => {});
  };

  return (
    <Card elevation="mid" className="mt-4 p-4" accessibilityRole="alert" accessibilityLabel={`${s.notifBannerLabel}: ${banner.title}`}>
      <MirroredRow className="items-start gap-2">
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
      </MirroredRow>
      {banner.route !== "home" || onStart ? (
        <MirroredRow className="mt-2">
          <Button size="sm" className="h-11" onPress={start} label={s.notifBannerStart} />
        </MirroredRow>
      ) : null}
    </Card>
  );
}
