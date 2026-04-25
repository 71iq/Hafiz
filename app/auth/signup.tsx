import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useStrings } from "@/lib/i18n/useStrings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { ChevronLeft } from "lucide-react-native";

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  displayName: z.string().optional(),
});

type SignupForm = z.infer<typeof signupSchema>;

export default function SignupScreen() {
  const router = useRouter();
  const s = useStrings();
  const { signUp, isLoading, error, clearError } = useAuthStore();
  const [showError, setShowError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  const usernameRef = useRef<TextInput>(null);
  const displayNameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", username: "", displayName: "" },
  });

  const onSubmit = async (data: SignupForm) => {
    if (!configured) {
      setShowError(s.authUnavailableSubtitle);
      return;
    }
    try {
      setShowError(null);
      const result = await signUp(data.email, data.password, data.username, data.displayName || "");
      if (result.status === "alreadyRegistered") {
        setShowError(s.authSignupAlreadyRegistered);
        return;
      }
      if (result.status === "needsEmailConfirmation") {
        setShowError(s.authSignupConfirmEmail);
        return;
      }
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

        <ScrollView
          className="flex-1 px-6"
          contentContainerStyle={{ justifyContent: "center", flexGrow: 1, marginTop: -40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <Text
            className="text-charcoal dark:text-neutral-100 text-center mb-2"
            style={{ fontFamily: "NotoSerif_700Bold", fontSize: 28 }}
          >
            {s.authSignup}
          </Text>
          <Text
            className="text-warm-400 dark:text-neutral-500 text-center mb-8"
            style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
          >
            {configured ? s.authSignupSubtitle : s.authUnavailableSubtitle}
          </Text>

          {configured ? (
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
            <FormField label={s.authEmail} error={errors.email?.message}>
              <Controller
                control={control}
                name="email"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    className="bg-surface dark:bg-surface-dark-high rounded-2xl px-4 py-3 text-charcoal dark:text-neutral-100"
                    style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
                    placeholder={s.authEmail}
                    placeholderTextColor="#b9a085"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => usernameRef.current?.focus()}
                    blurOnSubmit={false}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                  />
                )}
              />
            </FormField>

            {/* Username */}
            <FormField label={s.authUsername} error={errors.username?.message}>
              <Controller
                control={control}
                name="username"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    ref={usernameRef}
                    className="bg-surface dark:bg-surface-dark-high rounded-2xl px-4 py-3 text-charcoal dark:text-neutral-100"
                    style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
                    placeholder={s.authUsername}
                    placeholderTextColor="#b9a085"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => displayNameRef.current?.focus()}
                    blurOnSubmit={false}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                  />
                )}
              />
            </FormField>

            {/* Display Name */}
            <FormField label={s.authDisplayName} error={errors.displayName?.message}>
              <Controller
                control={control}
                name="displayName"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    ref={displayNameRef}
                    className="bg-surface dark:bg-surface-dark-high rounded-2xl px-4 py-3 text-charcoal dark:text-neutral-100"
                    style={{ fontFamily: "Manrope_400Regular", fontSize: 15 }}
                    placeholder={s.authDisplayName}
                    placeholderTextColor="#b9a085"
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    blurOnSubmit={false}
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                  />
                )}
              />
            </FormField>

            {/* Password */}
            <FormField label={s.authPassword} error={errors.password?.message}>
              <Controller
                control={control}
                name="password"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    ref={passwordRef}
                    className="bg-surface dark:bg-surface-dark-high rounded-2xl px-4 py-3 text-charcoal dark:text-neutral-100"
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
            </FormField>

            <View className="h-2" />

            {/* Submit */}
            <Button
              onPress={handleSubmit(onSubmit, (formErrors) => {
                const firstError =
                  formErrors.email?.message ||
                  formErrors.username?.message ||
                  formErrors.displayName?.message ||
                  formErrors.password?.message;
                setShowError(firstError || s.authSignupValidationError);
              })}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text
                  className="text-white text-center"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
                >
                  {s.authSignup}
                </Text>
              )}
            </Button>
          </Card>
          ) : (
            <Card elevation="low" className="p-6 mb-6">
              <Text
                className="text-charcoal dark:text-neutral-100 text-center mb-2"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16 }}
              >
                {s.authUnavailableTitle}
              </Text>
              <Text
                className="text-warm-400 dark:text-neutral-500 text-center"
                style={{ fontFamily: "Manrope_400Regular", fontSize: 14, lineHeight: 22 }}
              >
                {s.authUnavailableSubtitle}
              </Text>
            </Card>
          )}

          {configured && <OAuthButtons onError={(msg) => setShowError(msg)} />}

          {/* Login link */}
          {configured && <View className="flex-row items-center justify-center gap-1 mb-8">
            <Text
              className="text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 14 }}
            >
              {s.authHasAccount}
            </Text>
            <Pressable onPress={() => router.replace("/auth/login")}>
              <Text
                className="text-primary-accent dark:text-primary-bright"
                style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
              >
                {s.authLogin}
              </Text>
            </Pressable>
          </View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-3">
      <Text
        className="text-charcoal dark:text-neutral-300 mb-2"
        style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
      >
        {label}
      </Text>
      {children}
      {error && (
        <Text className="text-red-500 text-xs mt-1" style={{ fontFamily: "Manrope_400Regular" }}>
          {error}
        </Text>
      )}
    </View>
  );
}
