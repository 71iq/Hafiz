import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { completeQfOAuthConnection } from "@/lib/quran-foundation/user";
import { strings } from "@/lib/i18n/strings";
import { useAppLanguage } from "@/lib/i18n/useStrings";
import { getQfOAuthRedirectUri } from "@/lib/quran-foundation/oauth-redirect";
import { errorMessage } from "@/lib/error-message";

// redirectUri must match the address the authorization began with. The app callback route passes
// its own, so a browser that opens it, without the app, still completes against that address.
export default function QfCallbackScreen({ redirectUri }: { redirectUri?: string }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string; error_description?: string }>();
  const s = strings[useAppLanguage()];
  const [message, setMessage] = useState<string>(s.qfAuthCallbackLoading);

  useEffect(() => {
    let cancelled = false;
    const returnToAccount = (error?: string) => {
      if (cancelled) return;
      if (error !== undefined) setMessage(error);
      router.replace({
        pathname: "/settings",
        params:
          error === undefined ? { category: "account", qf: "connected" } : { category: "account", qf_error: error },
      });
    };
    const finish = async () => {
      const error = firstParam(params.error);
      const errorDescription = firstParam(params.error_description);
      if (error) {
        returnToAccount(errorDescription || error);
        return;
      }

      const code = firstParam(params.code);
      const state = firstParam(params.state);
      if (!code || !state) {
        returnToAccount(s.qfAuthCallbackFailed);
        return;
      }

      const response = await completeQfOAuthConnection(code, state, redirectUri ?? getQfOAuthRedirectUri());
      returnToAccount(response.ok ? undefined : response.message || s.qfAuthCallbackFailed);
    };

    finish().catch((err: unknown) => returnToAccount(errorMessage(err) || s.qfAuthCallbackFailed));

    return () => {
      cancelled = true;
    };
  }, [params.code, params.error, params.error_description, params.state, redirectUri, router, s.qfAuthCallbackFailed]);

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="flex-1 items-center justify-center px-8">
        <ActivityIndicator size="large" color="#0d9488" />
        <Text
          className="mt-4 text-center text-charcoal dark:text-neutral-100"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
        >
          {message}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
