import React, { useLayoutEffect, useRef, useState } from "react";
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
import { startAppOAuth, type AppOAuthProvider } from "@/lib/auth/oauth";
import { useAuthStore } from "@/lib/auth/store";
import { isSocialAuthEnabled } from "@/lib/auth/config";
import { useDatabaseStatus } from "@/lib/database/provider";
import { isQfLoginEnabled } from "@/lib/quran-foundation/config";
import { runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import { QF_OAUTH_PROVIDER } from "@/lib/quran-foundation/user-types";
import { getCachedAuthDarkMode } from "@/lib/settings/startup-theme";
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
  /** Runs once a native OAuth flow has established this screen's session. */
  onSignedIn?: () => void;
};

const googleLogo = require("@/assets/images/auth/google.png") as ImageSourcePropType;
const appleLogo = require("@/assets/images/auth/apple.png") as ImageSourcePropType;
const facebookLogo = require("@/assets/images/auth/facebook-icon.png") as ImageSourcePropType;

export function OAuthButtons({ strings: s, isDark, onError, onSignedIn }: Props) {
  const { db } = useDatabaseStatus();
  const { colorScheme } = useColorScheme();
  const { width } = useWindowDimensions();
  const isDesktop = width >= SIDEBAR_BREAKPOINT;
  const resolvedIsDark = isDark ?? getCachedAuthDarkMode({ useDocumentFallback: true }) ?? colorScheme === "dark";
  const dir = useUIDirection();
  const [busyProvider, setBusyProvider] = useState<"google" | "apple" | "facebook" | "qf" | null>(null);

  const busyOwner = useRef<object | null>(null);
  const mounted = useRef(false);
  const committedDb = useRef({ db });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      busyOwner.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (committedDb.current.db !== db) committedDb.current = { db };
  }, [db]);

  if (!isSupabaseConfigured() || !isSocialAuthEnabled()) return null;

  const handleOAuth = async (provider: AppOAuthProvider, busy: NonNullable<typeof busyProvider>) => {
    if (busyOwner.current || !mounted.current) return;
    const invocation = {};
    const databaseScope = committedDb.current;
    busyOwner.current = invocation;
    setBusyProvider(busy);
    const ownsBusy = () => mounted.current && busyOwner.current === invocation;
    const flow = startAppOAuth(provider, "sign-in", useAuthStore.getState);
    try {
      const result = await flow.result;
      if (
        ownsBusy() &&
        db &&
        committedDb.current === databaseScope &&
        result.status === "completed" &&
        result.owner.isCurrent() &&
        result.value.qfConnected &&
        result.value.qfOwner?.isCurrent()
      ) {
        runInitialQfUserSync(db, result.value.qfOwner).catch(console.warn);
      }
      // Web sign-in leaves the page for the provider and returns with no session here.
      // Native resolves with the restored session, so leave the auth screen like email login.
      if (ownsBusy() && result.status === "completed" && result.owner.isCurrent() && result.value.session) {
        onSignedIn?.();
      }
    } catch (error) {
      if (ownsBusy() && flow.isCurrent()) onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      if (ownsBusy()) {
        busyOwner.current = null;
        setBusyProvider(null);
      }
    }
  };
  const handlePress = (provider: "google" | "apple" | "facebook") => handleOAuth(provider, provider);
  const handleQfPress = () => handleOAuth(QF_OAUTH_PROVIDER, "qf");

  const mutedColor = resolvedIsDark ? "#525252" : "#DFD9D1";
  const buttonBorderColor = resolvedIsDark ? "#E5E7EB" : "#DFD9D1";
  const buttonBackground = "#FFFFFF";
  const qfAuthEnabled = isQfLoginEnabled();
  const providerButtonWidth = isDesktop ? 120 : 104;
  const providerButtonHeight = 56;
  const providerIconSize = 26;
  const providerIconBoxSize = 28;
  const providerGap = isDesktop ? 14 : 12;

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
          hoverBackgroundColor="#F8FAFC"
          focusBorderColor={resolvedIsDark ? "#2dd4bf" : "#0d9488"}
          buttonWidth={providerButtonWidth}
          buttonHeight={providerButtonHeight}
          iconSize={providerIconSize}
          iconBoxSize={providerIconBoxSize}
          disabled={!!busyProvider}
          loading={busyProvider === "google"}
        />
        <OAuthIconButton
          onPress={() => handlePress("apple")}
          accessibilityLabel={s.authContinueWithApple}
          source={appleLogo}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
          hoverBackgroundColor="#F8FAFC"
          focusBorderColor={resolvedIsDark ? "#2dd4bf" : "#0d9488"}
          buttonWidth={providerButtonWidth}
          buttonHeight={providerButtonHeight}
          iconSize={24}
          iconBoxSize={providerIconBoxSize}
          disabled={!!busyProvider}
          loading={busyProvider === "apple"}
        />
        <OAuthIconButton
          onPress={() => handlePress("facebook")}
          accessibilityLabel={s.authContinueWithFacebook}
          source={facebookLogo}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
          hoverBackgroundColor="#F8FAFC"
          focusBorderColor={resolvedIsDark ? "#2dd4bf" : "#0d9488"}
          buttonWidth={providerButtonWidth}
          buttonHeight={providerButtonHeight}
          iconSize={providerIconSize}
          iconBoxSize={providerIconBoxSize}
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

function OAuthIconButton({
  onPress,
  accessibilityLabel,
  source,
  backgroundColor,
  borderColor,
  hoverBackgroundColor,
  focusBorderColor,
  buttonWidth,
  buttonHeight,
  iconSize,
  iconBoxSize,
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
  buttonWidth: number;
  buttonHeight: number;
  iconSize: number;
  iconBoxSize: number;
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
        width: buttonWidth,
        height: buttonHeight,
        borderRadius: 14,
        backgroundColor: hovered && isInteractive ? hoverBackgroundColor : backgroundColor,
        borderWidth: 1,
        borderColor: focused && isInteractive ? focusBorderColor : borderColor,
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
        opacity: disabled && !loading ? 0.55 : 1,
        transform: [{ scale: pressed && isInteractive ? 0.97 : 1 }],
        boxShadow: focused ? "0 0 0 2px rgba(45, 212, 191, 0.18)" : "0 4px 12px rgba(0, 0, 0, 0.06)",
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#0d9488" />
      ) : (
        <View
          pointerEvents="none"
          style={{
            width: iconBoxSize,
            height: iconBoxSize,
            alignItems: "center",
            justifyContent: "center",
            overflow: "visible",
          }}
        >
          <Image
            source={source}
            accessibilityIgnoresInvertColors
            style={[
              { width: iconSize, height: iconSize },
              Platform.OS === "web"
                ? ({
                    display: "block",
                    lineHeight: 0,
                    objectFit: "contain",
                    overflow: "visible",
                    verticalAlign: "middle",
                  } as any)
                : null,
            ]}
            resizeMode="contain"
          />
        </View>
      )}
    </Pressable>
  );
}
