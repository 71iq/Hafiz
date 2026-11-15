import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { BookMarked, ChevronLeft, ChevronRight, Trophy, Users, type LucideIcon } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { useSettings, withThemeOpacity } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import type { UIStringKey } from "@/lib/i18n/strings";
import { textStartStyle } from "@/lib/ui/direction";
import { accentIconColor, mutedIconColor } from "@/lib/ui/theme-icons";

export type SecondaryDestination = "halaqa" | "leaderboard" | "reflection-journey";

const DESTINATIONS: Record<
  SecondaryDestination,
  { href: Href; label: UIStringKey; hint: UIStringKey; icon: LucideIcon }
> = {
  // Route names stay as they are: each screen keeps its own sign-in and opt-in gates.
  halaqa: { href: "/(tabs)/halaqa", label: "tabHalaqa", hint: "navigationHalaqaHint", icon: Users },
  leaderboard: { href: "/(tabs)/leaderboard", label: "tabBoard", hint: "navigationBoardHint", icon: Trophy },
  "reflection-journey": {
    href: "/(tabs)/reflection-journey",
    label: "reflectionJourneyTitle",
    hint: "navigationJourneyHint",
    icon: BookMarked,
  },
};

/**
 * Labeled entry rows for destinations that are not phone tabs (Halaqa, Board, Journey). Home and
 * Progress show them so every destination stays reachable below 768px with four tabs.
 */
export function SecondaryDestinations({
  destinations,
  className,
  details,
}: {
  destinations: readonly SecondaryDestination[];
  className?: string;
  /** Replaces a row's hint line, such as Journey's "2 / 5 completed" on Progress. */
  details?: Partial<Record<SecondaryDestination, string>>;
}) {
  const s = useStrings();
  const { isRTL, effectiveTheme } = useSettings();
  const Chevron = isRTL ? ChevronLeft : ChevronRight;
  const muted = mutedIconColor(effectiveTheme);
  const accent = accentIconColor(effectiveTheme);

  return (
    <Card elevation="low" className={className ?? "mb-6"} accessibilityLabel={s.navigationSecondaryTitle}>
      {destinations.map((name, index) => {
        const item = DESTINATIONS[name];
        const Icon = item.icon;
        return (
          <Pressable
            key={name}
            onPress={() => router.navigate(item.href)}
            accessibilityRole="button"
            accessibilityLabel={s[item.label]}
            accessibilityHint={details?.[name] ?? s[item.hint]}
            className={`min-h-14 flex-row items-center gap-3 px-4 py-3 ${
              index > 0 ? "border-t border-black/5 dark:border-white/5" : ""
            }`}
            // Web reports hover and keyboard focus on the state; both get the soft accent background.
            style={(state) => {
              const { pressed, hovered, focused } = state as typeof state & { hovered?: boolean; focused?: boolean };
              return {
                direction: isRTL ? "rtl" : "ltr",
                opacity: pressed ? 0.7 : 1,
                backgroundColor: hovered || focused ? withThemeOpacity(accent, 0.12) : undefined,
              };
            }}
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/10">
              <Icon size={18} color={accent} />
            </View>
            <View className="flex-1">
              <Text
                className="text-charcoal dark:text-neutral-100"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, lineHeight: 21, ...textStartStyle(isRTL) }}
              >
                {s[item.label]}
              </Text>
              <Text
                className="text-warm-700 dark:text-neutral-400"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 19, ...textStartStyle(isRTL) }}
              >
                {details?.[name] ?? s[item.hint]}
              </Text>
            </View>
            <Chevron size={18} color={muted} />
          </Pressable>
        );
      })}
    </Card>
  );
}
