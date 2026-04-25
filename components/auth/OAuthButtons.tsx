import React from "react";
import { View, Text, Pressable, Platform, Image, type ImageSourcePropType } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

// NOTE: OAuth providers (Google, Apple, Facebook) must be configured in the
// Supabase dashboard under Authentication > Providers before these buttons work.
// Each provider requires its own client ID and secret from the respective platform.

type Props = {
  onError?: (msg: string) => void;
};

const googleLogo = require("@/assets/images/auth/google.png");
const appleLogo = require("@/assets/images/auth/apple.png");
const appleDarkLogo = require("@/assets/images/auth/apple_dark.png");
const facebookLogo = require("@/assets/images/auth/facebook-icon.png");

async function signInWithProvider(provider: "google" | "apple" | "facebook") {
  if (Platform.OS === "web") {
    // On web, Supabase handles redirect-based OAuth natively
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
  } else {
    // On native, use expo-web-browser to open the OAuth flow
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (data.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url);
      if (result.type === "success" && result.url) {
        // Extract tokens from the callback URL
        const url = new URL(result.url);
        const params = new URLSearchParams(url.hash.slice(1)); // tokens are in hash fragment
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        }
      }
    }
  }
}

export function OAuthButtons({ onError }: Props) {
  const s = useStrings();
  const { isDark } = useSettings();

  if (!isSupabaseConfigured()) return null;

  const handlePress = async (provider: "google" | "apple" | "facebook") => {
    try {
      await signInWithProvider(provider);
    } catch (err: any) {
      onError?.(err.message);
    }
  };

  const mutedColor = isDark ? "#525252" : "#DFD9D1";
  const appleSource = (isDark ? appleDarkLogo : appleLogo) as ImageSourcePropType;
  const buttonBorderColor = isDark ? "#333" : "#E0E0E0";
  const buttonBackground = isDark ? "#1a1a1a" : "#FFFFFF";

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
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}>
        <OAuthIconButton
          onPress={() => handlePress("google")}
          source={googleLogo}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
        />
        <OAuthIconButton
          onPress={() => handlePress("apple")}
          source={appleSource}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
        />
        <OAuthIconButton
          onPress={() => handlePress("facebook")}
          source={facebookLogo}
          backgroundColor={buttonBackground}
          borderColor={buttonBorderColor}
        />
      </View>
    </View>
  );
}

function OAuthIconButton({
  onPress,
  source,
  backgroundColor,
  borderColor,
}: {
  onPress: () => void;
  source: ImageSourcePropType;
  backgroundColor: string;
  borderColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor,
        borderWidth: 1,
        borderColor,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <Image source={source} style={{ width: 24, height: 24 }} resizeMode="contain" />
    </Pressable>
  );
}
