import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Redirect, useRouter, useNavigation } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock } from "lucide-react-native";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isEmailAuthFlowsEnabled } from "@/lib/auth/config";
import { useAuthStore } from "@/lib/auth/store";
import { usePasswordRecovery } from "@/lib/auth/password-recovery";
import { strings } from "@/lib/i18n/strings";
import type { UIStrings } from "@/lib/i18n/strings";
import { useAppLanguage } from "@/lib/i18n/useStrings";
import { Button } from "@/components/ui/Button";
import { FormTextField } from "@/components/ui/FormTextField";
import { AuthFormNotice, AuthScreenShell, AuthUnavailableState } from "@/components/auth/AuthScreenShell";
import type { Direction } from "@/lib/ui/direction";

type ResetPasswordForm = {
  password: string;
  confirmPassword: string;
};

function createResetPasswordSchema(s: UIStrings) {
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

function passwordResetErrorMessage(error: unknown, strings: UIStrings): string {
  if (typeof error === "object" && error !== null) {
    if ("code" in error && error.code === "auth_storage_lock_unavailable") return strings.authResetBrowserUnsupported;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return String(error);
}

export default function ResetPasswordScreen() {
  if (!isEmailAuthFlowsEnabled()) return <Redirect href="/auth/login" />;
  return <RecoveryForm />;
}

function RecoveryForm() {
  const { formKey } = usePasswordRecovery();
  return <ResetPasswordFormScreen key={formKey} />;
}

function ResetPasswordFormScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const locale = useAppLanguage();
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const s = strings[locale];
  const schema = useMemo(() => createResetPasswordSchema(s), [s]);
  const isLoading = useAuthStore((value) => value.isLoading);
  const recovery = usePasswordRecovery();
  const { attach, leave } = recovery;
  useEffect(() => {
    attach();
    return navigation.addListener("beforeRemove", leave);
  }, [navigation, attach, leave]);
  const ready = recovery.state.kind === "ready";
  const passwordBusy = ["saving", "signing-out", "finished"].includes(recovery.state.kind);
  const success = recovery.state.kind === "signing-out" || recovery.state.kind === "finished";
  const message =
    recovery.state.kind === "failed"
      ? passwordResetErrorMessage(recovery.state.error, s)
      : recovery.state.kind === "ready" && recovery.state.error
        ? passwordResetErrorMessage(recovery.state.error, s)
        : recovery.state.kind === "invalid"
          ? s.authResetLinkInvalid
          : success
            ? s.authPasswordUpdated
            : null;
  const messageType = success ? "success" : "error";
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

  const onSubmit = async (data: ResetPasswordForm) => {
    await recovery.submit(data.password);
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
        <AuthFormNotice message={message} tone={messageType} dir={dir} />

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

        <Button onPress={handleSubmit(onSubmit)} disabled={isLoading || passwordBusy || !ready} size="lg" dir={dir}>
          {isLoading || passwordBusy ? (
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
