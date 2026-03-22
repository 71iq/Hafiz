import { Pressable, Animated, View } from "react-native";
import { useEffect, useRef } from "react";

type Props = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

/** shadcn-style animated toggle switch, consistent on web + native */
export function Switch({ value, onValueChange, disabled }: Props) {
  const thumbLeft = useRef(new Animated.Value(value ? 22 : 2)).current;

  useEffect(() => {
    Animated.spring(thumbLeft, {
      toValue: value ? 22 : 2,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  }, [value]);

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        backgroundColor: value ? "#0d9488" : "#E8E1DA", // primary-accent : surface-high
        opacity: disabled ? 0.4 : 1,
        position: "relative",
        overflow: "hidden",
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
    >
      <Animated.View
        style={{
          position: "absolute",
          top: 2,
          left: thumbLeft,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: "#ffffff",
          // Ambient teal-tinted shadow per DESIGN.md
          shadowColor: "#003638",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04,
          shadowRadius: 8,
          elevation: 1,
        }}
      />
    </Pressable>
  );
}
