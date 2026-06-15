import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { completeQfOAuthConnection } from "@/lib/quran-foundation/user";
import { strings } from "@/lib/i18n/strings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";

const QF_WEB_REDIRECT_URI = "https://hafizquran.app/auth/qf-callback";

export default function QfCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string; error_description?: string }>();
  const s = strings[getStartupLanguage()];
  const [message, setMessage] = useState<string>(s.qfAuthCallbackLoading);

  useEffect(() => {
    let cancelled = false;
    const finish = async () => {
      const error = firstParam(params.error);
      const errorDescription = firstParam(params.error_description);
      if (error) {
        const text = errorDescription || error;
        if (!cancelled) setMessage(text);
        router.replace(`/settings?qf_error=${encodeURIComponent(text)}`);
        return;
      }

      const code = firstParam(params.code);
      const state = firstParam(params.state);
      if (!code || !state) {
        if (!cancelled) setMessage(s.qfAuthCallbackFailed);
        router.replace(`/settings?qf_error=${encodeURIComponent(s.qfAuthCallbackFailed)}`);
        return;
      }

      const response = await completeQfOAuthConnection(code, state, QF_WEB_REDIRECT_URI);
      if (response.ok) {
        router.replace("/settings?qf=connected");
        return;
      }

      if (!cancelled) setMessage(response.message);
      router.replace(`/settings?qf_error=${encodeURIComponent(response.message)}`);
    };

    finish().catch((err: any) => {
      const text = err?.message || s.qfAuthCallbackFailed;
      if (!cancelled) setMessage(text);
      router.replace(`/settings?qf_error=${encodeURIComponent(text)}`);
    });

    return () => {
      cancelled = true;
    };
  }, [params.code, params.error, params.error_description, params.state, router, s.qfAuthCallbackFailed]);

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
