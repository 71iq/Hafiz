import { useEffect, useRef } from "react";
import { Animated, Text } from "react-native";

type Props = {
  message: string | null;
  onDismiss: () => void;
  duration?: number;
};

export function Toast({ message, onDismiss, duration = 2000 }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => onDismiss());
    }, duration);

    return () => clearTimeout(timer);
  }, [message, duration, onDismiss, opacity]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 60,
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 9999,
        opacity,
      }}
    >
      <Text
        style={{
          backgroundColor: "#003638",
          color: "#fff",
          fontFamily: "Manrope_600SemiBold",
          fontSize: 13,
          paddingHorizontal: 20,
          paddingVertical: 10,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        {message}
      </Text>
    </Animated.View>
  );
}
