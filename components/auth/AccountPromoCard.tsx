import { Pressable, Text, View } from "react-native";
import { UserPlus, X as XIcon } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";
import { mutedIconColor } from "@/lib/ui/theme-icons";

export type AccountPromoAction = { label: string; onPress: () => void; primary?: boolean };

type Props = {
  title?: string;
  message: string;
  actions: readonly AccountPromoAction[];
  onDismiss: () => void;
  className?: string;
};

/**
 * The guest promotion for optional account sync, shared by Home and Progress. Outline actions keep it
 * quieter than study actions. The close control has its own 44 px target beside the text, not over
 * it, while its icon stays small.
 */
export function AccountPromoCard({ title, message, actions, onDismiss, className = "mb-6" }: Props) {
  const s = useStrings();
  const { isDark, isRTL, effectiveTheme } = useSettings();
  const row = { direction: "ltr" as const, flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const) };
  const textDirection = { ...textStartStyle(isRTL), writingDirection: isRTL ? ("rtl" as const) : ("ltr" as const) };
  return (
    <Card elevation="low" className={`p-4 ${className}`}>
      <View className="items-start gap-3" style={row}>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
          <UserPlus size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
        </View>
        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
          {title ? (
            <Text
              className="text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textDirection }}
            >
              {title}
            </Text>
          ) : null}
          <Text
            className={title ? "text-warm-600 dark:text-neutral-400" : "text-charcoal dark:text-neutral-100"}
            style={{
              fontFamily: title ? "Manrope_400Regular" : "Manrope_700Bold",
              fontSize: title ? 12 : 14,
              lineHeight: title ? 18 : 20,
              ...textDirection,
            }}
          >
            {message}
          </Text>
          <View className="mt-2 flex-wrap gap-2" style={row}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                onPress={action.onPress}
                accessibilityRole="button"
                className={`min-h-[44px] justify-center rounded-full border px-4 ${
                  action.primary
                    ? "border-primary-accent dark:border-primary-bright"
                    : "border-warm-300 dark:border-neutral-700"
                }`}
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              >
                <Text
                  className={
                    action.primary
                      ? "text-primary-muted dark:text-primary-bright"
                      : "text-charcoal dark:text-neutral-200"
                  }
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={s.homeDismiss}
          // The row is mirrored by hand under a pinned LTR direction, so the outset names a physical side.
          className={`-mt-2 h-11 w-11 items-center justify-center rounded-full ${isRTL ? "-ml-2" : "-mr-2"}`}
        >
          <XIcon size={14} color={mutedIconColor(effectiveTheme)} />
        </Pressable>
      </View>
    </Card>
  );
}
