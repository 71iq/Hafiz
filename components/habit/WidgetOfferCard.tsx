import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Smartphone } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MirroredRow } from "@/components/ui/MirroredRow";
import { Text } from "@/components/ui/Text";
import type { AppDatabase } from "@/lib/database/types";
import type { UIStrings } from "@/lib/i18n/strings";
import { widgetPlatform } from "@/lib/widget/platform";
import { markWidgetOfferShown, readWidgetOfferShown } from "@/lib/widget/settings";

/**
 * Spec 8.2: whether the session end may offer the home-screen widget. True only on Android where the
 * launcher can show the add dialog, with no widget placed, when the offer was never shown on this
 * device. The session conditions (a wird event, a streak of 3 or more, no other prompt) are
 * SessionHabitCards' promptCard.
 */
export function useWidgetOffer(db: AppDatabase): boolean {
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    if (!widgetPlatform.supported) return;
    let active = true;
    (async () => {
      if (!(await widgetPlatform.canRequestPin())) return;
      const placement = await widgetPlatform.getPlacement();
      if (placement.small > 0 || placement.medium > 0) return;
      if (await readWidgetOfferShown(db)) return;
      if (active) setOffer(true);
    })().catch((error: unknown) => console.warn("[Widget] Could not check the widget offer:", error));
    return () => {
      active = false;
    };
  }, [db]);
  return offer;
}

/**
 * The one-time widget offer at the session end, in the same slot and look as the reminder offer. It
 * counts as shown once it appears, whatever the person chooses.
 */
export function WidgetOfferCard({
  db,
  language,
  isDark,
  s,
}: {
  db: AppDatabase;
  language: "en" | "ar";
  isDark: boolean;
  s: UIStrings;
}) {
  const dir = language === "ar" ? "rtl" : "ltr";
  const accent = isDark ? "#2dd4bf" : "#0d9488";
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    markWidgetOfferShown(db, new Date()).catch((error: unknown) =>
      console.warn("[Widget] Could not record the widget offer:", error),
    );
  }, [db]);

  if (answered) return null;

  const add = () => {
    setAnswered(true);
    widgetPlatform.requestPin("small").catch((error: unknown) => console.warn("[Widget] Pin request failed:", error));
  };

  return (
    <Card elevation="low" className="px-5 py-4">
      <MirroredRow dir={dir} className="items-center gap-2">
        <Smartphone size={16} color={accent} />
        <Text
          dir={dir}
          className="text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 15 }}
        >
          {s.widgetOfferTitle}
        </Text>
      </MirroredRow>
      <Text dir={dir} variant="body-sm" className="mt-1.5 text-warm-700 dark:text-neutral-300">
        {s.widgetOfferBody}
      </Text>
      {/* Outline, so the session's own filled commit button stays the one primary action on screen. */}
      <View className="mt-3" style={{ gap: 6 }}>
        <Button
          variant="outline"
          dir={dir}
          className="border border-warm-300 dark:border-neutral-700"
          label={s.widgetOfferAdd}
          onPress={add}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => setAnswered(true)}
          className="min-h-[44px] items-center justify-center"
        >
          <Text
            className="text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
          >
            {s.notifSkip}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}
