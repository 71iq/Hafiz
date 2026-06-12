import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock } from "lucide-react-native";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuthStore } from "@/lib/auth/store";
import { strings } from "@/lib/i18n/strings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { Button } from "@/components/ui/Button";
import { FormTextField } from "@/components/ui/FormTextField";
import {
  AuthFormNotice,
  AuthScreenShell,
  AuthUnavailableState,
} from "@/components/auth/AuthScreenShell";
import type { Direction } from "@/lib/ui/direction";

type ResetPasswordForm = {
  password: string;
  confirmPassword: string;
};

function createResetPasswordSchema(s: typeof strings.en) {
  return z
    .object({
      password: z.string().min(6, s.authValidationPasswordMin),
      confirmPassword: z.string().min(6, s.authValidationPasswordMin),
    })
    .refine((data) => data.password === data.confirmPassword, {
      path: ["confirmPassword"],
      message: s.authValidationPasswordsMismatch,
    });
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const locale = getStartupLanguage();
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const s = strings[locale];
  const schema = useMemo(() => createResetPasswordSchema(s), [s]);
  const { updatePassword, isLoading, error } = useAuthStore();
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("error");
  const [ready, setReady] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const configured = isSupabaseConfigured();
  const confirmPasswordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(schema),
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
      setMessageType("error");
      setMessage(s.authResetLinkInvalid);
      setReady(false);
      return;
    }

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setMessageType("error");
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
      setMessageType("success");
      setMessage(s.authPasswordUpdated);
      await supabase.auth.signOut();
      router.replace("/auth/login");
    } catch (err: any) {
      setMessageType("error");
      setMessage(err.message);
    }
  };

  const unavailableContent = !configured ? (
    <AuthUnavailableState title={s.authUnavailableTitle} subtitle={s.authUnavailableSubtitle} dir={dir} />
  ) : undefined;

  return (
    <AuthScreenShell
      locale={locale}
      title={s.authResetPasswordTitle}
      subtitle={configured ? s.authResetPasswordSubtitle : s.authUnavailableSubtitle}
      appName={s.appName}
      brandHeadline={s.authBrandHeadline}
      brandBody={s.authBrandBody}
      backLabel={s.authBack}
      onBack={() => router.back()}
      unavailableContent={unavailableContent}
    >
      <View className="w-full">
        <AuthFormNotice message={message || error} tone={messageType} dir={dir} />

        <FormTextField
          control={control}
          name="password"
          label={s.authNewPassword}
          error={errors.password?.message}
          dir={dir}
          inputProps={{
            placeholder: s.authNewPassword,
            secureTextEntry: !passwordVisible,
            returnKeyType: "next",
            onSubmitEditing: () => confirmPasswordRef.current?.focus(),
            blurOnSubmit: false,
            startIcon: <Lock size={18} color="#8B8178" />,
            endIcon: (
              <Pressable
                onPress={() => setPasswordVisible((current) => !current)}
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? s.authHidePassword : s.authShowPassword}
                hitSlop={8}
              >
                {passwordVisible ? <EyeOff size={18} color="#8B8178" /> : <Eye size={18} color="#8B8178" />}
              </Pressable>
            ),
          }}
        />

        <View className="h-4" />

        <FormTextField
          control={control}
          name="confirmPassword"
          label={s.authConfirmPassword}
          error={errors.confirmPassword?.message}
          dir={dir}
          inputRef={confirmPasswordRef}
          inputProps={{
            placeholder: s.authConfirmPassword,
            secureTextEntry: !confirmPasswordVisible,
            returnKeyType: "done",
            onSubmitEditing: handleSubmit(onSubmit),
            startIcon: <Lock size={18} color="#8B8178" />,
            endIcon: (
              <Pressable
                onPress={() => setConfirmPasswordVisible((current) => !current)}
                accessibilityRole="button"
                accessibilityLabel={confirmPasswordVisible ? s.authHidePassword : s.authShowPassword}
                hitSlop={8}
              >
                {confirmPasswordVisible ? <EyeOff size={18} color="#8B8178" /> : <Eye size={18} color="#8B8178" />}
              </Pressable>
            ),
          }}
        />

        <View className="h-7" />

        <Button onPress={handleSubmit(onSubmit)} disabled={isLoading || !ready} size="lg" dir={dir}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              className="text-center text-white"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 16, writingDirection: dir }}
            >
              {s.authUpdatePassword}
            </Text>
          )}
        </Button>
      </View>
    </AuthScreenShell>
  );
}
