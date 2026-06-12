import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  View,
  Text,
  Pressable,
  useWindowDimensions,
  type ImageSourcePropType,
} from "react-native";
import { useColorScheme } from "nativewind";
import { BookOpen } from "lucide-react-native";
import { isSupabaseConfigured } from "@/lib/supabase";
import { startAppOAuth } from "@/lib/auth/oauth";
import { useDatabaseStatus } from "@/lib/database/provider";
import { isQfLoginEnabled } from "@/lib/quran-foundation/config";
import { runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import { QF_OAUTH_PROVIDER } from "@/lib/quran-foundation/user-types";
import { useUIDirection } from "@/lib/ui/direction";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";

// NOTE: OAuth providers (Google, Apple, Facebook) must be configured in the
// Supabase dashboard under Authentication > Providers before these buttons work.
// Each provider requires its own client ID and secret from the respective platform.

type Props = {
  strings: {
    authOrContinueWith: string;
    authContinueWithQuranFoundation: string;
    authContinueWithGoogle: string;
    authContinueWithApple: string;
    authContinueWithFacebook: string;
  };
  isDark?: boolean;
  onError?: (msg: string) => void;
};

const googleLogo = require("@/assets/images/auth/google.png") as ImageSourcePropType;
const appleLogo = require("@/assets/images/auth/apple.png") as ImageSourcePropType;
const appleDarkLogo = require("@/assets/images/auth/apple_dark.png") as ImageSourcePropType;
const facebookLogo = require("@/assets/images/auth/facebook-icon.png") as ImageSourcePropType;

export function OAuthButtons({ strings: s, isDark, onError }: Props) {
  const { db } = useDatabaseStatus();
  const { colorScheme } = useColorScheme();
  const { width } = useWindowDimensions();
  const isDesktop = width >= SIDEBAR_BREAKPOINT;
  const resolvedIsDark = isDark ?? getCachedWebDarkMode() ?? colorScheme === "dark";
  const dir = useUIDirection();
  const [busyProvider, setBusyProvider] = useState<"google" | "apple" | "facebook" | "qf" | null>(null);

  if (!isSupabaseConfigured()) return null;

  const handlePress = async (provider: "google" | "apple" | "facebook") => {
    if (busyProvider) return;
    setBusyProvider(provider);
    try {
      await startAppOAuth(provider);
    } catch (err: any) {
      onError?.(err.message);
    } finally {
      setBusyProvider(null);
    }
  };

  const handleQfPress = async () => {
    if (busyProvider) return;
    setBusyProvider("qf");
    try {
      const result = await startAppOAuth(QF_OAUTH_PROVIDER);
      if (result.qfConnected && db) {
        runInitialQfUserSync(db).catch(console.warn);
      }
    } catch (err: any) {
      onError?.(err.message);
    } finally {
      setBusyProvider(null);
    }
  };

  const mutedColor = resolvedIsDark ? "#525252" : "#DFD9D1";
  const buttonBorderColor = resolvedIsDark ? "#404040" : "#DFD9D1";
  const buttonBackground = resolvedIsDark ? "#171717" : "#FFFFFF";
  const qfAuthEnabled = isQfLoginEnabled();
  const providerButtonSize = isDesktop ? 54 : 50;
  const providerIconSize = isDesktop ? 25 : 24;
  const providerGap = isDesktop ? 16 : 13;

  return (
    <View>
      {/* Divider */}
      <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 16 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: mutedColor }} />
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 12,
            color: resolvedIsDark ? "#737373" : "#8B8178",
            marginHorizontal: 12,
            writingDirection: dir,
          }}
        >
          {s.authOrContinueWith}
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: mutedColor }} />
      </View>

      {/* OAuth buttons row */}
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          justifyContent: "center",
          gap: providerGap,
        }}
      >
        <OAuthIconButton
          onPress={() => handlePress("google")}
          accessibilityLabel={s.authContinueWithGoogle}
          source={googleLogo}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
          hoverBackgroundColor={resolvedIsDark ? "#1F1F1F" : "#F7F1E8"}
          focusBorderColor={resolvedIsDark ? "#2dd4bf" : "#0d9488"}
          buttonSize={providerButtonSize}
          iconSize={providerIconSize}
          disabled={!!busyProvider}
          loading={busyProvider === "google"}
        />
        <OAuthIconButton
          onPress={() => handlePress("apple")}
          accessibilityLabel={s.authContinueWithApple}
          source={resolvedIsDark ? appleDarkLogo : appleLogo}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
          hoverBackgroundColor={resolvedIsDark ? "#1F1F1F" : "#F7F1E8"}
          focusBorderColor={resolvedIsDark ? "#2dd4bf" : "#0d9488"}
          buttonSize={providerButtonSize}
          iconSize={providerIconSize}
          disabled={!!busyProvider}
          loading={busyProvider === "apple"}
        />
        <OAuthIconButton
          onPress={() => handlePress("facebook")}
          accessibilityLabel={s.authContinueWithFacebook}
          source={facebookLogo}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
          hoverBackgroundColor={resolvedIsDark ? "#1F1F1F" : "#F7F1E8"}
          focusBorderColor={resolvedIsDark ? "#2dd4bf" : "#0d9488"}
          buttonSize={providerButtonSize}
          iconSize={providerIconSize}
          disabled={!!busyProvider}
          loading={busyProvider === "facebook"}
        />
      </View>

      {qfAuthEnabled && (
        <Pressable
          onPress={handleQfPress}
          disabled={!!busyProvider}
          className="mt-3 flex-row items-center justify-center gap-2 rounded-full border px-4 py-3"
          style={({ pressed }) => ({
            opacity: busyProvider ? 0.55 : pressed ? 0.75 : 1,
            backgroundColor: buttonBackground,
            borderColor: buttonBorderColor,
            flexDirection: dir === "rtl" ? "row-reverse" : "row",
          })}
        >
          {busyProvider === "qf" ? (
            <ActivityIndicator size="small" color={resolvedIsDark ? "#2dd4bf" : "#0d9488"} />
          ) : (
            <BookOpen size={17} color={resolvedIsDark ? "#2dd4bf" : "#0d9488"} />
          )}
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{
              color: resolvedIsDark ? "#F5F5F5" : "#2D2D2D",
              fontFamily: "Manrope_600SemiBold",
              fontSize: 14,
              writingDirection: dir,
            }}
          >
            {s.authContinueWithQuranFoundation}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function getCachedWebDarkMode(): boolean | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;

  const theme = window.localStorage.getItem("hafiz_theme");
  if (theme === "dark" || theme === "amoled") return true;
  if (theme === "beige" || theme === "white") return false;
  if (theme === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? null;
  }

  if (typeof document !== "undefined") {
    const rootBackground = window.getComputedStyle(document.documentElement).backgroundColor;
    if (rootBackground === "rgb(10, 10, 10)" || rootBackground === "rgb(38, 38, 38)") {
      return true;
    }
  }

  return null;
}

function OAuthIconButton({
  onPress,
  accessibilityLabel,
  source,
  backgroundColor,
  borderColor,
  hoverBackgroundColor,
  focusBorderColor,
  buttonSize,
  iconSize,
  disabled = false,
  loading = false,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  source: ImageSourcePropType;
  backgroundColor: string;
  borderColor: string;
  hoverBackgroundColor: string;
  focusBorderColor: string;
  buttonSize: number;
  iconSize: number;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const isInteractive = !disabled && !loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: loading }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => ({
        width: buttonSize,
        height: buttonSize,
        borderRadius: buttonSize / 2,
        backgroundColor: hovered && isInteractive ? hoverBackgroundColor : backgroundColor,
        borderWidth: 1,
        borderColor: focused && isInteractive ? focusBorderColor : borderColor,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled && !loading ? 0.55 : 1,
        transform: [{ scale: pressed && isInteractive ? 0.97 : 1 }],
        boxShadow: focused
          ? "0 0 0 2px rgba(45, 212, 191, 0.18)"
          : "0 8px 18px rgba(0, 0, 0, 0.10)",
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#0d9488" />
      ) : (
        <Image
          source={source}
          accessibilityIgnoresInvertColors
          style={{ width: iconSize, height: iconSize }}
          resizeMode="contain"
        />
      )}
    </Pressable>
  );
}
