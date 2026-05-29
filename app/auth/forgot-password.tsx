import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  I18nManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { strings } from "@/lib/i18n/strings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormTextField } from "@/components/ui/FormTextField";

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
});

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const s = strings[getStartupLanguage()];
  const { sendPasswordReset, isLoading, error } = useAuthStore();
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("error");
  const configured = isSupabaseConfigured();
  const BackIcon = I18nManager.isRTL ? ChevronRight : ChevronLeft;

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordForm) => {
    if (!configured) {
      setMessageType("error");
      setMessage(s.authUnavailableSubtitle);
      return;
    }
    try {
      setMessage(null);
      await sendPasswordReset(data.email);
      setMessageType("success");
      setMessage(s.authPasswordResetSent);
    } catch (err: any) {
      setMessageType("error");
      setMessage(err.message);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-row items-center px-4 pt-4 pb-2">
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full bg-surface-low dark:bg-surface-dark-low items-center justify-center"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <BackIcon size={20} color="#6e5a47" />
          </Pressable>
        </View>

        <View className="flex-1 px-6 justify-center" style={{ marginTop: -60 }}>
          <Text
            className="text-charcoal dark:text-neutral-100 text-center mb-2"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
          >
            {s.authForgotPasswordTitle}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 text-center mb-8"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 22 }}
          >
            {configured ? s.authForgotPasswordSubtitle : s.authUnavailableSubtitle}
          </Text>

          <Card elevation="low" className="p-6 mb-6">
            {(message || error) && (
              <View
                className={`rounded-2xl p-3 mb-4 ${
                  messageType === "success"
                    ? "bg-primary-accent/10 dark:bg-primary-bright/10"
                    : "bg-red-50 dark:bg-red-900/20"
                }`}
              >
                <Text
                  className={`text-center ${
                    messageType === "success"
                      ? "text-primary-accent dark:text-primary-bright"
                      : "text-red-600 dark:text-red-400"
                  }`}
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
                >
                  {message || error}
                </Text>
              </View>
            )}

            <FormTextField
              control={control}
              name="email"
              label={s.authEmail}
              error={errors.email?.message}
              inputProps={{
                placeholder: s.authEmail,
                keyboardType: "email-address",
                autoCapitalize: "none",
                autoCorrect: false,
                returnKeyType: "done",
                onSubmitEditing: handleSubmit(onSubmit),
              }}
            />

            <View className="h-5" />
            <Button onPress={handleSubmit(onSubmit)} disabled={isLoading || !configured}>
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white text-center" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}>
                  {s.authSendResetLink}
                </Text>
              )}
            </Button>
          </Card>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
