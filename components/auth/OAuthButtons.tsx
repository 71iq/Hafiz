import React, { useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, View, Text, Pressable, type ImageSourcePropType } from "react-native";
import { useColorScheme } from "nativewind";
import { BookOpen } from "lucide-react-native";
import { isSupabaseConfigured } from "@/lib/supabase";
import { startAppOAuth, type AppOAuthProvider } from "@/lib/auth/oauth";
import { useAuthStore } from "@/lib/auth/store";
import { isSocialAuthEnabled } from "@/lib/auth/config";
import { persistAuthReturnForRedirect } from "@/lib/auth/return-origin";
import { useDatabaseStatus } from "@/lib/database/provider";
import { isQfLoginEnabled } from "@/lib/quran-foundation/config";
import { runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import { QF_OAUTH_PROVIDER } from "@/lib/quran-foundation/user-types";
import { getCachedAuthDarkMode } from "@/lib/settings/startup-theme";
import { interpolate } from "@/lib/i18n/useStrings";
import { textStartStyle, useUIDirection } from "@/lib/ui/direction";


type Props = {
  strings: {
    authOrContinueWith: string;
    authContinueWithQuranFoundation: string;
    authContinueWithGoogle: string;
    authContinueWithApple: string;
    authContinueWithFacebook: string;
    authOpeningProvider?: string;
    authProviderFailed?: string;
  };
  isDark?: boolean;
  onError?: (msg: string) => void;
  onSignedIn?: () => void;
};

type SocialProvider = "google" | "apple" | "facebook";
type BusyProvider = SocialProvider | "qf";

const googleLogo = require("@/assets/images/auth/google.png") as ImageSourcePropType;
const appleLogo = require("@/assets/images/auth/apple.png") as ImageSourcePropType;
const facebookLogo = require("@/assets/images/auth/facebook-icon.png") as ImageSourcePropType;

const PROVIDER_NAMES: Record<BusyProvider, string> = {
  google: "Google",
  apple: "Apple",
  facebook: "Facebook",
  qf: "Quran Foundation",
};

type ProviderStyle = { background: string; border: string; text: string; logoTint?: string };

export function providerButtonStyle(provider: SocialProvider, isDark: boolean): ProviderStyle {
  if (provider === "apple")
    return isDark
      ? { background: "#000000", border: "#5E5E5E", text: "#FFFFFF", logoTint: "#FFFFFF" }
      : { background: "#FFFFFF", border: "#000000", text: "#000000", logoTint: "#000000" };
  return isDark
    ? { background: "#131314", border: "#8E918F", text: "#E3E3E3" }
    : { background: "#FFFFFF", border: "#747775", text: "#1F1F1F" };
}

export function OAuthButtons({ strings: s, isDark, onError, onSignedIn }: Props) {
  const { db } = useDatabaseStatus();
  const { colorScheme } = useColorScheme();
  const resolvedIsDark = isDark ?? getCachedAuthDarkMode({ useDocumentFallback: true }) ?? colorScheme === "dark";
  const dir = useUIDirection();
  const [busyProvider, setBusyProvider] = useState<BusyProvider | null>(null);
  const [failedProvider, setFailedProvider] = useState<BusyProvider | null>(null);

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

  const failureText = (provider: BusyProvider) =>
    interpolate(s.authProviderFailed ?? "Could not sign in with {{provider}}. Try again.", {
      provider: PROVIDER_NAMES[provider],
    });

  const handleOAuth = async (provider: AppOAuthProvider, busy: BusyProvider) => {
    if (busyOwner.current || !mounted.current) return;
    const invocation = {};
    const databaseScope = committedDb.current;
    busyOwner.current = invocation;
    setBusyProvider(busy);
    setFailedProvider(null);
    const ownsBusy = () => mounted.current && busyOwner.current === invocation;
    const cancelRedirect = Platform.OS === "web" ? persistAuthReturnForRedirect() : () => {};
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
      if (ownsBusy() && result.status === "completed" && result.owner.isCurrent() && result.value.session) {
        onSignedIn?.();
      }
    } catch {
      cancelRedirect();
      if (ownsBusy() && flow.isCurrent()) {
        setFailedProvider(busy);
        onError?.(failureText(busy));
      }
    } finally {
      if (ownsBusy()) {
        busyOwner.current = null;
        setBusyProvider(null);
      }
    }
  };
  const handlePress = (provider: SocialProvider) => handleOAuth(provider, provider);
  const handleQfPress = () => handleOAuth(QF_OAUTH_PROVIDER, "qf");

  const mutedColor = resolvedIsDark ? "#525252" : "#DFD9D1";
  const qfAuthEnabled = isQfLoginEnabled();
  const providers: { id: SocialProvider; label: string; source: ImageSourcePropType }[] = [
    { id: "google", label: s.authContinueWithGoogle, source: googleLogo },
    { id: "apple", label: s.authContinueWithApple, source: appleLogo },
    { id: "facebook", label: s.authContinueWithFacebook, source: facebookLogo },
  ];
  const statusText = busyProvider
    ? interpolate(s.authOpeningProvider ?? "Opening {{provider}}...", { provider: PROVIDER_NAMES[busyProvider] })
    : failedProvider
      ? failureText(failedProvider)
      : null;

  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 16 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: mutedColor }} />
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 13,
            color: resolvedIsDark ? "#A3A3A3" : "#6E5A47",
            marginHorizontal: 12,
            writingDirection: dir,
          }}
        >
          {s.authOrContinueWith}
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: mutedColor }} />
      </View>

      <View style={{ gap: 10 }}>
        {providers.map((provider) => (
          <OAuthProviderButton
            key={provider.id}
            onPress={() => handlePress(provider.id)}
            label={provider.label}
            source={provider.source}
            colors={providerButtonStyle(provider.id, resolvedIsDark)}
            focusColor={resolvedIsDark ? "#2dd4bf" : "#0d9488"}
            dir={dir}
            disabled={!!busyProvider}
            loading={busyProvider === provider.id}
          />
        ))}
      </View>

      {qfAuthEnabled && (
        <Pressable
          onPress={handleQfPress}
          disabled={!!busyProvider}
          className="mt-3 flex-row items-center justify-center gap-2 rounded-full border px-4 py-3"
          style={({ pressed }) => ({
            opacity: busyProvider && busyProvider !== "qf" ? 0.55 : pressed ? 0.75 : 1,
            backgroundColor: "#FFFFFF",
            borderColor: resolvedIsDark ? "#E5E7EB" : "#DFD9D1",
            flexDirection: dir === "rtl" ? "row-reverse" : "row",
          })}
        >
          {busyProvider === "qf" ? (
            <ActivityIndicator size="small" color={resolvedIsDark ? "#2dd4bf" : "#0d9488"} />
          ) : (
            <BookOpen size={17} color={resolvedIsDark ? "#2dd4bf" : "#0d9488"} />
          )}
          <Text
            className="text-charcoal"
            style={{ color: "#2D2D2D", fontFamily: "Manrope_600SemiBold", fontSize: 14, writingDirection: dir }}
          >
            {s.authContinueWithQuranFoundation}
          </Text>
        </Pressable>
      )}

      {statusText ? (
        <Text
          accessibilityLiveRegion="polite"
          className={
            failedProvider && !busyProvider ? "text-red-700 dark:text-red-300" : "text-warm-600 dark:text-neutral-400"
          }
          style={{
            marginTop: 10,
            fontFamily: "Manrope_500Medium",
            fontSize: 14,
            lineHeight: 20,
            ...textStartStyle(dir === "rtl"),
            writingDirection: dir,
          }}
        >
          {statusText}
        </Text>
      ) : null}
    </View>
  );
}

function OAuthProviderButton({
  onPress,
  label,
  source,
  colors,
  focusColor,
  dir,
  disabled = false,
  loading = false,
}: {
  onPress: () => void;
  label: string;
  source: ImageSourcePropType;
  colors: ProviderStyle;
  focusColor: string;
  dir: "ltr" | "rtl";
  disabled?: boolean;
  loading?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const isInteractive = !disabled && !loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => ({
        minHeight: 48,
        width: "100%",
        borderRadius: 14,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: focused && isInteractive ? focusColor : colors.border,
        paddingHorizontal: 16,
        paddingVertical: 10,
        direction: "ltr",
        flexDirection: dir === "rtl" ? "row-reverse" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        opacity: disabled && !loading ? 0.55 : 1,
        transform: [{ scale: pressed && isInteractive ? 0.98 : 1 }],
        boxShadow: focused ? `0 0 0 3px ${focusColor}55` : undefined,
      })}
    >
      <View pointerEvents="none" style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <Image
            source={source}
            accessibilityIgnoresInvertColors
            style={[
              { width: 20, height: 20 },
              colors.logoTint ? { tintColor: colors.logoTint } : null,
              Platform.OS === "web" ? ({ display: "block", objectFit: "contain" } as object) : null,
            ]}
            resizeMode="contain"
          />
        )}
      </View>
      <Text
        style={{
          flexShrink: 1,
          color: colors.text,
          fontFamily: "Manrope_600SemiBold",
          fontSize: 15,
          lineHeight: 20,
          textAlign: "center",
          writingDirection: dir,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
