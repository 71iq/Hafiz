import { useEffect, useRef } from "react";
import { Animated, View, Text } from "react-native";
import { useColorScheme } from "nativewind";
import { useNetInfo } from "@react-native-community/netinfo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WifiOff } from "lucide-react-native";
import { useSettings, withThemeOpacity } from "@/lib/settings/context";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { textStartStyle } from "@/lib/ui/direction";

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
  const { effectiveTheme, themeColors } = useSettings();
  const isDark = colorScheme === "dark";

  const netInfo = useNetInfo();
  const insets = useSafeAreaInsets();
  const isOffline = netInfo.isConnected === false;
  const reduceMotion = useReducedMotionPreference();

  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const target = isOffline
      ? { translateY: 0, opacity: 1, duration: 300 }
      : { translateY: -80, opacity: 0, duration: 250 };

    if (reduceMotion) {
      translateY.setValue(target.translateY);
      opacity.setValue(target.opacity);
      return;
    }

    const transition = Animated.parallel([
      Animated.timing(translateY, {
        toValue: target.translateY,
        duration: target.duration,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: target.opacity,
        duration: target.duration,
        useNativeDriver: true,
      }),
    ]);
    transition.start();
    return () => transition.stop();
  }, [isOffline, opacity, reduceMotion, translateY]);

  // Don't render anything until netInfo has resolved (isConnected is null initially)
  if (netInfo.isConnected === null) return null;

  const backgroundColor = isDark
    ? "rgba(253,220,145,0.10)"
    : effectiveTheme === "white"
      ? withThemeOpacity(themeColors.surfaceHigh, 0.72)
      : "rgba(253,220,145,0.15)";

  const textColor = isDark ? "#a3a3a3" : effectiveTheme === "white" ? "#71717A" : "#8a7058";
  const iconColor = textColor;

  return (
    <Animated.View
      pointerEvents="none"
      aria-hidden={!isOffline}
      accessibilityElementsHidden={!isOffline}
      importantForAccessibility={isOffline ? "auto" : "no-hide-descendants"}
      style={{
        position: "absolute",
        // Edge-to-edge Android draws under the status bar.
        top: insets.top,
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
            ...textStartStyle(uiLanguage === "ar"),
            flex: 1,
          }}
        >
          {OFFLINE_TEXT[uiLanguage]}
        </Text>
      </View>
    </Animated.View>
  );
}
