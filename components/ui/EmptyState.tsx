import React from "react";
import { View, Text, Pressable } from "react-native";
import type { LucideIcon } from "lucide-react-native";

type Props = {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  isDark: boolean;
};

/**
 * Reusable empty-state component with icon, title, subtitle, and optional action.
 * Follows "The Serene Path" design system: warm neutrals, teal accent, pill buttons.
 */
export function EmptyState({ icon: Icon, title, subtitle, actionLabel, onAction, isDark }: Props) {
  const iconColor = isDark ? "#525252" : "#DFD9D1";
  const iconBg = isDark ? "rgba(82,82,82,0.15)" : "rgba(223,217,209,0.3)";
  const titleColor = isDark ? "#a3a3a3" : "#8a7058";
  const subtitleColor = isDark ? "#737373" : "#A39B93";
  const accentColor = isDark ? "#2dd4bf" : "#0d9488";

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
        style={{
          fontFamily: "Manrope_600SemiBold",
          fontSize: 16,
          color: titleColor,
          textAlign: "center",
          marginBottom: 6,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 13,
            color: subtitleColor,
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
          style={(state) => ({
            marginTop: 20,
            backgroundColor: accentColor,
            paddingHorizontal: 24,
            height: 40,
            borderRadius: 20,
            justifyContent: "center",
            alignItems: "center",
            transform: [{ scale: state.pressed ? 0.98 : 1 }],
          })}
        >
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#FFFFFF" }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
