import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { LogIn, UserPlus, X as XIcon } from "lucide-react-native";
import { Card } from "@/components/ui/Card";
import type { AccountPromoSurface } from "@/lib/auth/account-promo";
import { captureAuthReturn } from "@/lib/auth/return-origin";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { textStartStyle } from "@/lib/ui/direction";
import { mutedIconColor } from "@/lib/ui/theme-icons";

type Props = {
  surface: AccountPromoSurface;
  title?: string;
  message: string;
  logInLabel: string;
  signUpLabel?: string;
  onDismiss: () => void;
  className?: string;
};

export function AccountPromoCard({
  surface,
  title,
  message,
  logInLabel,
  signUpLabel,
  onDismiss,
  className = "mb-6",
}: Props) {
  const s = useStrings();
  const router = useRouter();
  const { isDark, isRTL, effectiveTheme } = useSettings();
  const accent = isDark ? "#2dd4bf" : "#0f766e";
  const row = { direction: "ltr" as const, flexDirection: isRTL ? ("row-reverse" as const) : ("row" as const) };
  const textDirection = { ...textStartStyle(isRTL), writingDirection: isRTL ? ("rtl" as const) : ("ltr" as const) };
  const openAuth = (path: "/auth/login" | "/auth/signup") => {
    captureAuthReturn({ route: surface });
    router.push(path);
  };
  return (
    <Card elevation="low" className={`px-5 py-4 bg-primary-accent/10 dark:bg-primary-bright/10 ${className}`}>
      <View className="items-start gap-3" style={row}>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
          <UserPlus size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
        </View>
        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
          {title ? (
            <Text
              className="text-charcoal dark:text-neutral-200"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, ...textDirection }}
            >
              {title}
            </Text>
          ) : null}
          <Text
            className={title ? "text-warm-600 dark:text-neutral-400" : "text-charcoal dark:text-neutral-100"}
            style={{
              fontFamily: title ? "Manrope_400Regular" : "Manrope_500Medium",
              fontSize: title ? 12 : 14,
              lineHeight: title ? 18 : 20,
              ...textDirection,
            }}
          >
            {message}
          </Text>
          <View className="mt-2 flex-wrap gap-2" style={row}>
            <Pressable
              onPress={() => openAuth("/auth/login")}
              accessibilityRole="button"
              accessibilityLabel={logInLabel}
              className="rounded-full px-4"
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                borderWidth: 1.5,
                borderColor: accent,
                backgroundColor: "transparent",
                opacity: pressed ? 0.76 : 1,
              })}
            >
              <View className="flex-row items-center gap-2" style={row}>
                <LogIn size={15} color={accent} />
                <Text style={{ color: accent, fontFamily: "Manrope_700Bold", fontSize: 13 }}>{logInLabel}</Text>
              </View>
            </Pressable>
            {signUpLabel ? (
              <Pressable
                onPress={() => openAuth("/auth/signup")}
                accessibilityRole="button"
                className="min-h-[44px] justify-center rounded-full border border-warm-300 px-4 dark:border-neutral-700"
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              >
                <Text
                  className="text-charcoal dark:text-neutral-200"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                >
                  {signUpLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={s.homeDismiss}
          className={`-mt-2 h-11 w-11 items-center justify-center rounded-full ${isRTL ? "-ml-2" : "-mr-2"}`}
        >
          <XIcon size={14} color={mutedIconColor(effectiveTheme)} />
        </Pressable>
      </View>
    </Card>
  );
}
