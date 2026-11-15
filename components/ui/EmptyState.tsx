import React from "react";
import { View, Text, Pressable } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { useSettings, withThemeOpacity } from "@/lib/settings/context";
import { accentIconColor, errorIconColor, mutedIconColor } from "@/lib/ui/theme-icons";

type Props = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  isDark: boolean;
  /**
   * "success" marks something just done: the icon takes the accent on a tinted disc. "error" colors
   * the icon with the theme's error token so a failure does not read as an empty list.
   */
  tone?: "neutral" | "success" | "error";
  /** "display" sets the title in the serif heading of a session's end, for an end state in a session flow. */
  titleStyle?: "default" | "display";
};

/**
 * Reusable empty-state component with icon, title, subtitle, and optional action.
 * Follows "The Serene Path" design system: warm neutrals, teal accent, pill buttons. Text colors come
 * from the theme tokens, so they follow the active theme, and read at 4.5:1 or more.
 */
export function EmptyState({ icon: Icon, title, subtitle, actionLabel, onAction, isDark, tone = "neutral", titleStyle = "default" }: Props) {
  const { themeColors, effectiveTheme } = useSettings();
  // Theme tokens, not fixed hex: the palette prop wins over isDark when the provider knows it.
  const palette = effectiveTheme ?? (isDark ? "dark" : "beige");
  const success = tone === "success";
  const accentColor = accentIconColor(palette);
  const iconColor =
    tone === "error" ? errorIconColor(palette) : success ? accentColor : mutedIconColor(palette);
  const iconBg = success
    ? withThemeOpacity(accentColor, isDark ? 0.15 : 0.1)
    : withThemeOpacity(themeColors.surfaceHigh, isDark ? 0.4 : 0.6);

  return (
    <View style={{ alignItems: "center", paddingVertical: 48, paddingHorizontal: 32 }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Icon size={36} color={iconColor} strokeWidth={1.5} />
      </View>
      <Text
        accessibilityRole="header"
        className="text-charcoal dark:text-neutral-200"
        style={
          titleStyle === "display"
            ? { fontFamily: "NotoSerif_700Bold", fontSize: 21, lineHeight: 30, textAlign: "center", marginBottom: 6 }
            : { fontFamily: "Manrope_600SemiBold", fontSize: 16, textAlign: "center", marginBottom: 6 }
        }
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          className="text-warm-700 dark:text-neutral-400"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 13,
            textAlign: "center",
            lineHeight: 20,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          className="bg-primary-muted dark:bg-primary-bright"
          style={(state) => ({
            marginTop: 20,
            paddingHorizontal: 24,
            minHeight: 44,
            borderRadius: 22,
            justifyContent: "center",
            alignItems: "center",
            transform: [{ scale: state.pressed ? 0.98 : 1 }],
          })}
        >
          <Text className="text-white dark:text-primary" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
