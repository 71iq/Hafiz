import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useGlobalSearchParams, useNavigation, useRouter } from "expo-router";
import { useAuthStore } from "@/lib/auth/store";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { completeAuthReturn } from "@/lib/auth/return-origin";
import { strings } from "@/lib/i18n/strings";
import { useAppLanguage } from "@/lib/i18n/useStrings";
import type { RootStackState } from "@/lib/navigation/return-to-tabs";
import { AuthFormNotice, AuthScreenShell, AuthTextLink, useAuthIconColors } from "@/components/auth/AuthScreenShell";

const CALLBACK_SESSION_WAIT_MS = 10_000;

export default function OAuthCallbackScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const locale = useAppLanguage();
  const dir = locale === "ar" ? "rtl" : "ltr";
  const s = strings[locale];
  const colors = useAuthIconColors();
  const params = useGlobalSearchParams<{ error?: string; error_description?: string }>();
  const initialized = useAuthStore((state) => state.isInitialized);
  const identified = useAuthStore((state) => getAuthSessionIdentity(state.session).kind === "identified");
  const [timedOut, setTimedOut] = useState(false);
  const completed = useRef(false);
  const providerError = typeof params.error === "string" && params.error.length > 0;

  useEffect(() => {
    if (!initialized || completed.current) return;
    if (identified) {
      completed.current = true;
      completeAuthReturn(navigation.getState() as RootStackState);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), CALLBACK_SESSION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [initialized, identified, navigation]);

  const failed = !identified && (providerError || timedOut);

  return (
    <AuthScreenShell
      locale={locale}
      title={failed ? s.authLogin : s.authCallbackSigningIn}
      subtitle=""
      appName={s.appName}
      brandHeadline={s.authBrandHeadline}
      backLabel={s.authBack}
      languageLabel={s.authLanguage}
      onBack={() => router.replace("/auth/login")}
    >
      {failed ? (
        <View>
          <AuthFormNotice message={s.authCallbackFailed} dir={dir} />
          <AuthTextLink
            label={s.authBackToLogin}
            dir={dir}
            align="center"
            onPress={() => router.replace("/auth/login")}
          />
        </View>
      ) : (
        <View className="items-center py-6">
          <ActivityIndicator size="large" color={colors.accent} accessibilityLabel={s.authCallbackSigningIn} />
        </View>
      )}
    </AuthScreenShell>
  );
}
