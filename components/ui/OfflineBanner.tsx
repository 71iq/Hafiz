import { useEffect, useRef } from "react";
import { Animated, View, Text } from "react-native";
import { useColorScheme } from "nativewind";
import { useNetInfo } from "@react-native-community/netinfo";
import { WifiOff } from "lucide-react-native";

const OFFLINE_TEXT = {
  en: "You\u2019re offline \u2014 study features work, community features will sync when connected",
  ar: "\u0623\u0646\u062a \u063a\u064a\u0631 \u0645\u062a\u0635\u0644 \u2014 \u0645\u064a\u0632\u0627\u062a \u0627\u0644\u062f\u0631\u0627\u0633\u0629 \u062a\u0639\u0645\u0644\u060c \u0627\u0644\u0645\u064a\u0632\u0627\u062a \u0627\u0644\u0627\u062c\u062a\u0645\u0627\u0639\u064a\u0629 \u0633\u062a\u062a\u0645 \u0645\u0632\u0627\u0645\u0646\u062a\u0647\u0627 \u0639\u0646\u062f \u0627\u0644\u0627\u062a\u0635\u0627\u0644",
};

type Props = {
  uiLanguage: "en" | "ar";
};

/**
 * Self-contained offline banner that slides in from the top when
 * the device loses connectivity and slides out when reconnected.
 * Uses amber/gold tint background consistent with the app's design system.
 */
export function OfflineBanner({ uiLanguage }: Props) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;

  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const isVisible = useRef(false);

  useEffect(() => {
    if (isOffline && !isVisible.current) {
      isVisible.current = true;
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!isOffline && isVisible.current) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -80,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start(() => {
        isVisible.current = false;
      });
    }
  }, [isOffline, translateY, opacity]);

  // Don't render anything until netInfo has resolved (isConnected is null initially)
  if (netInfo.isConnected === null) return null;

  const backgroundColor = isDark
    ? "rgba(253,220,145,0.10)"
    : "rgba(253,220,145,0.15)";

  const textColor = isDark ? "#a3a3a3" : "#8a7058"; // neutral-400 dark, warm-600 light
  const iconColor = isDark ? "#a3a3a3" : "#8a7058";

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        transform: [{ translateY }],
        opacity,
      }}
    >
      <View
        className="mx-4 mt-2 rounded-xl px-3 py-2.5"
        style={{
          backgroundColor,
          flexDirection: uiLanguage === "ar" ? "row-reverse" : "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <WifiOff size={14} color={iconColor} />
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 12,
            color: textColor,
            writingDirection: uiLanguage === "ar" ? "rtl" : "ltr",
            textAlign: uiLanguage === "ar" ? "right" : "left",
            flex: 1,
          }}
        >
          {OFFLINE_TEXT[uiLanguage]}
        </Text>
      </View>
    </Animated.View>
  );
}
