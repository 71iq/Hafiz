import { useState, useRef } from "react";
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
import { useAuthStore } from "@/lib/auth/store";
import { useStrings } from "@/lib/i18n/useStrings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChevronLeft } from "lucide-react-native";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginScreen() {
  const router = useRouter();
  const s = useStrings();
  const { signIn, isLoading, error, clearError } = useAuthStore();
  const [showError, setShowError] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginForm) => {
    try {
      setShowError(null);
      await signIn(data.email, data.password);
      router.back();
    } catch (err: any) {
      setShowError(err.message);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
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
          {/* Title */}
          <Text
            className="text-charcoal dark:text-neutral-100 text-center mb-2"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
          >
            {s.authLogin}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 text-center mb-8"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
          >
            {s.authLoginSubtitle}
          </Text>

          <Card elevation="low" className="p-6 mb-6">
            {/* Error message */}
            {(showError || error) && (
              <View className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-3 mb-4">
                <Text
                  className="text-red-600 dark:text-red-400 text-center"
                  style={{ fontFamily: "Manrope_500Medium", fontSize: 13 }}
                >
                  {showError || error}
                </Text>
              </View>
            )}

            {/* Email */}
            <Text
              className="text-charcoal dark:text-neutral-300 mb-2"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            >
              {s.authEmail}
            </Text>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="bg-surface dark:bg-surface-dark-high rounded-2xl px-4 py-3 text-charcoal dark:text-neutral-100 mb-1"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
                  placeholder={s.authEmail}
                  placeholderTextColor="#b9a085"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  blurOnSubmit={false}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
              )}
            />
            {errors.email && (
              <Text className="text-red-500 text-xs mb-2" style={{ fontFamily: "Manrope_400Regular" }}>
                {errors.email.message}
              </Text>
            )}

            <View className="h-3" />

            {/* Password */}
            <Text
              className="text-charcoal dark:text-neutral-300 mb-2"
              style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
            >
              {s.authPassword}
            </Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  ref={passwordRef}
                  className="bg-surface dark:bg-surface-dark-high rounded-2xl px-4 py-3 text-charcoal dark:text-neutral-100 mb-1"
                  style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
                  placeholder={s.authPassword}
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
            {errors.password && (
              <Text className="text-red-500 text-xs mb-2" style={{ fontFamily: "Manrope_400Regular" }}>
                {errors.password.message}
              </Text>
            )}

            <View className="h-5" />

            {/* Submit */}
            <Button
              onPress={handleSubmit(onSubmit)}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text
                  className="text-white text-center"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
                >
                  {s.authLogin}
                </Text>
              )}
            </Button>
          </Card>

          {/* Sign up link */}
          <View className="flex-row items-center justify-center gap-1">
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 14 }}
            >
              {s.authNoAccount}
            </Text>
            <Pressable onPress={() => router.replace("/auth/signup")}>
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
              >
                {s.authSignup}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
