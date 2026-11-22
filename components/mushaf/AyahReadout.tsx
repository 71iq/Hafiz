import { Platform, StyleSheet, View, type ViewProps } from "react-native";

type Props = Pick<ViewProps, "accessibilityActions" | "onAccessibilityAction"> & { text: string };

/** Read the complete Unicode ayah independently of its page-font glyphs and their hit targets. */
export function AyahReadout({ text, accessibilityActions, onAccessibilityAction }: Props) {
  if (!text) return null;
  if (Platform.OS === "web") {
    return (
      <span
        lang="ar"
        dir="rtl"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          clipPath: "inset(50%)",
          overflow: "hidden",
          pointerEvents: "none",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={text}
      accessibilityLanguage="ar"
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    />
  );
}
