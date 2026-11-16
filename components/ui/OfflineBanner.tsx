import { useEffect, useRef, useState } from "react";
import { Animated, View, Text } from "react-native";
import { useNetInfo } from "@react-native-community/netinfo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WifiOff } from "lucide-react-native";
import { useSettings } from "@/lib/settings/context";
import { strings } from "@/lib/i18n/strings";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { textStartStyle } from "@/lib/ui/direction";
import { warningColors } from "@/lib/ui/theme-icons";

export const OFFLINE_UNREACHABLE_DELAY_MS = 3000;
export const OFFLINE_FADE_MS = 200;

type ConnectivitySnapshot = {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
};

export function useOfflineState(connectivity: ConnectivitySnapshot): boolean {
  const disconnected = connectivity.isConnected === false;
  const unreachable = !disconnected && connectivity.isInternetReachable === false;
  const [unreachableConfirmed, setUnreachableConfirmed] = useState(false);

  useEffect(() => {
    if (!unreachable) {
      setUnreachableConfirmed(false);
      return;
    }
    const timer = setTimeout(() => setUnreachableConfirmed(true), OFFLINE_UNREACHABLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [unreachable]);

  return disconnected || (unreachable && unreachableConfirmed);
}

type Props = {
  uiLanguage: "en" | "ar";
};

export function OfflineBanner({ uiLanguage }: Props) {
  const { effectiveTheme } = useSettings();
  const netInfo = useNetInfo();
  const insets = useSafeAreaInsets();
  const isOffline = useOfflineState(netInfo);
  const reduceMotion = useReducedMotionPreference();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isOffline) {
      opacity.setValue(0);
      return;
    }
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const transition = Animated.timing(opacity, {
      toValue: 1,
      duration: OFFLINE_FADE_MS,
      useNativeDriver: true,
    });
    transition.start();
    return () => transition.stop();
  }, [isOffline, opacity, reduceMotion]);

  if (!isOffline) return null;

  const isRTL = uiLanguage === "ar";
  const colors = warningColors(effectiveTheme ?? "beige");

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{ paddingTop: insets.top, opacity }}
    >
      <View
        className="mx-4 mt-2 rounded-xl px-3 py-2.5"
        style={{
          backgroundColor: colors.surface,
          flexDirection: isRTL ? "row-reverse" : "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <WifiOff size={14} color={colors.text} />
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 12,
            lineHeight: 18,
            color: colors.text,
            writingDirection: isRTL ? "rtl" : "ltr",
            ...textStartStyle(isRTL),
            flex: 1,
          }}
        >
          {strings[uiLanguage].offlineBanner}
        </Text>
      </View>
    </Animated.View>
  );
}
