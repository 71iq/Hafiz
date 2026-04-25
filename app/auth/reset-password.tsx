import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronLeft } from "lucide-react-native";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import { useStrings } from "@/lib/i18n/useStrings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const resetPasswordSchema = z
  .object({
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const s = useStrings();
  const { updatePassword, isLoading, error } = useAuthStore();
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const configured = isSupabaseConfigured();
  const confirmPasswordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (!configured || Platform.OS !== "web") {
      setReady(configured);
      return;
    }

    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      setMessage(s.authResetLinkInvalid);
      setReady(false);
      return;
    }

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setMessage(sessionError.message);
          setReady(false);
          return;
        }
        setReady(true);
      });
  }, [configured, s.authResetLinkInvalid]);

  const onSubmit = async (data: ResetPasswordForm) => {
    try {
      setMessage(null);
      await updatePassword(data.password);
      setMessage(s.authPasswordUpdated);
      router.replace("/auth/login");
    } catch (err: any) {
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
            <ChevronLeft size={20} color="#6e5a47" />
          </Pressable>
        </View>

        <View className="flex-1 px-6 justify-center" style={{ marginTop: -60 }}>
          <Text
            className="text-charcoal dark:text-neutral-100 text-center mb-2"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
          >
            {s.authResetPasswordTitle}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 text-center mb-8"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 15, lineHeight: 22 }}
          >
            {configured ? s.authResetPasswordSubtitle : s.authUnavailableSubtitle}
          </Text>

          <Card elevation="low" className="p-6 mb-6">
            {(message || error) && (
              <View className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-3 mb-4">
                <Text
                  className="text-red-600 dark:text-red-400 text-center"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
                >
                  {message || error}
                </Text>
              </View>
            )}

            <Text
              className="text-charcoal dark:text-neutral-300 mb-2"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            >
              {s.authNewPassword}
            </Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="bg-surface dark:bg-surface-dark-high rounded-2xl px-4 py-3 text-charcoal dark:text-neutral-100 mb-1"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
                  placeholder={s.authNewPassword}
                  placeholderTextColor="#b9a085"
                  secureTextEntry
                  returnKeyType="next"
                  onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                  blurOnSubmit={false}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
              )}
            />
            {errors.password && (
              <Text className="text-red-500 text-xs mb-2" style={{ fontFamily: "Manrope_400Regular" }}>
                {errors.password.message}
              </Text>
            )}

            <View className="h-3" />
            <Text
              className="text-charcoal dark:text-neutral-300 mb-2"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            >
              {s.authConfirmPassword}
            </Text>
            <Controller
              control={control}
              name="confirmPassword"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  ref={confirmPasswordRef}
                  className="bg-surface dark:bg-surface-dark-high rounded-2xl px-4 py-3 text-charcoal dark:text-neutral-100 mb-1"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
                  placeholder={s.authConfirmPassword}
                  placeholderTextColor="#b9a085"
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit(onSubmit)}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
              )}
            />
            {errors.confirmPassword && (
              <Text className="text-red-500 text-xs mb-2" style={{ fontFamily: "Manrope_400Regular" }}>
                {errors.confirmPassword.message}
              </Text>
            )}

            <View className="h-5" />
            <Button onPress={handleSubmit(onSubmit)} disabled={isLoading || !ready}>
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text className="text-white text-center" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}>
                  {s.authUpdatePassword}
                </Text>
              )}
            </Button>
          </Card>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
