import React, { useState } from "react";
import { ActivityIndicator, View, Text, Pressable, Image, type ImageSourcePropType } from "react-native";
import { BookOpen } from "lucide-react-native";
import { isSupabaseConfigured } from "@/lib/supabase";
import { startAppOAuth } from "@/lib/auth/oauth";
import { useDatabase } from "@/lib/database/provider";
import { useStrings } from "@/lib/i18n/useStrings";
import { isQfLoginEnabled } from "@/lib/quran-foundation/config";
import { runInitialQfUserSync } from "@/lib/quran-foundation/user-sync";
import { QF_OAUTH_PROVIDER } from "@/lib/quran-foundation/user-types";
import { useSettings } from "@/lib/settings/context";

// NOTE: OAuth providers (Google, Apple, Facebook) must be configured in the
// Supabase dashboard under Authentication > Providers before these buttons work.
// Each provider requires its own client ID and secret from the respective platform.

type Props = {
  onError?: (msg: string) => void;
};

const googleLogo = require("@/assets/images/auth/google-icon.png");
const appleLogo = require("@/assets/images/auth/apple-icon.png");
const appleDarkLogo = require("@/assets/images/auth/apple_dark-icon.png");
const facebookLogo = require("@/assets/images/auth/facebook-icon-icon.png");

export function OAuthButtons({ onError }: Props) {
  const s = useStrings();
  const db = useDatabase();
  const { isDark } = useSettings();
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
      if (result.qfConnected) {
        runInitialQfUserSync(db).catch(console.warn);
      }
    } catch (err: any) {
      onError?.(err.message);
    } finally {
      setBusyProvider(null);
    }
  };

  const mutedColor = isDark ? "#525252" : "#DFD9D1";
  const appleSource = (isDark ? appleDarkLogo : appleLogo) as ImageSourcePropType;
  const buttonBorderColor = isDark ? "#333" : "#E0E0E0";
  const buttonBackground = isDark ? "#1a1a1a" : "#FFFFFF";
  const qfAuthEnabled = isQfLoginEnabled();

  return (
    <View>
      {/* Divider */}
      <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 16 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: mutedColor }} />
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 12,
            color: isDark ? "#737373" : "#8B8178",
            marginHorizontal: 12,
          }}
        >
          {s.authOrContinueWith}
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: mutedColor }} />
      </View>

      {/* OAuth buttons row */}
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 14 }}>
        <OAuthIconButton
          onPress={() => handlePress("google")}
          source={googleLogo}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
          disabled={!!busyProvider}
          loading={busyProvider === "google"}
        />
        <OAuthIconButton
          onPress={() => handlePress("apple")}
          source={appleSource}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
          disabled={!!busyProvider}
          loading={busyProvider === "apple"}
        />
        <OAuthIconButton
          onPress={() => handlePress("facebook")}
          source={facebookLogo}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
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
          })}
        >
          {busyProvider === "qf" ? (
            <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
          ) : (
            <BookOpen size={17} color={isDark ? "#2dd4bf" : "#0d9488"} />
          )}
          <Text
            className="text-charcoal dark:text-neutral-100"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
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
  source,
  backgroundColor,
  borderColor,
  disabled = false,
  loading = false,
}: {
  onPress: () => void;
  source: ImageSourcePropType;
  backgroundColor: string;
  borderColor: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor,
        borderWidth: 1,
        borderColor,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled && !loading ? 0.55 : 1,
        transform: [{ scale: pressed && !disabled ? 0.95 : 1 }],
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#0d9488" />
      ) : (
        <Image source={source} style={{ width: 32, height: 32 }} resizeMode="contain" />
      )}
    </Pressable>
  );
}
