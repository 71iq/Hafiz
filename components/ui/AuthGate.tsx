import React from "react";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { Lock } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";

type Props = {
  title: string;
  subtitle: string;
};

export function AuthGate({ title, subtitle }: Props) {
  const router = useRouter();
  const s = useStrings();
  const { isDark } = useSettings();

  return (
    <View className="flex-1 items-center justify-center px-8">
      <View
        className="w-20 h-20 rounded-full items-center justify-center mb-6"
        style={{ backgroundColor: isDark ? "#1a2e2e" : "#f0fdfa" }}
      >
        <Lock size={32} color={isDark ? "#2dd4bf" : "#0d9488"} />
      </View>

      <Text
        className="text-charcoal dark:text-neutral-100 text-center mb-3"
        style={{ fontFamily: "NotoSerif_700Bold", fontSize: 22 }}
      >
        {title}
      </Text>

      <Text
        className="text-warm-400 dark:text-neutral-500 text-center mb-8"
        style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22 }}
      >
        {subtitle}
      </Text>

      <View style={{ width: "100%", maxWidth: 280, gap: 12 }}>
        <Button onPress={() => router.push("/auth/login")}>
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#fff" }}>
            {s.authLogin}
          </Text>
        </Button>

        <Button
          onPress={() => router.push("/auth/signup")}
          variant="outline"
        >
          <Text
            className="text-primary-accent dark:text-primary-bright"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
          >
            {s.authSignup}
          </Text>
        </Button>
      </View>
    </View>
  );
}
