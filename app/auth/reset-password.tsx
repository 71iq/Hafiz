import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
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
import { classifyAuthError } from "@/lib/auth/errors";
import { Button } from "@/components/ui/Button";
import { FormTextField } from "@/components/ui/FormTextField";
import {
  AuthFormNotice,
  AuthScreenShell,
  AuthUnavailableState,
  useAuthIconColors,
  useRevealOnFocus,
} from "@/components/auth/AuthScreenShell";
import { PendingLabel } from "@/components/auth/auth-messages";
import { useAuthReturn } from "@/components/auth/use-auth-return";
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

// Provider messages stay out of the notice; each known failure has localized copy.
function passwordResetErrorMessage(error: unknown, strings: UIStrings): string {
  switch (classifyAuthError(error).kind) {
    case "browser-unsupported":
      return strings.authResetBrowserUnsupported;
    case "rate-limited":
      return strings.authErrorRequestsLimited;
    case "offline":
      return strings.authErrorOffline;
    case "weak-password":
      return strings.authErrorWeakPassword;
    default:
      return strings.authErrorGeneric;
  }
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
  const { back, continueOffline } = useAuthReturn({ ownsReturn: false });
  const colors = useAuthIconColors();
  const reveal = useRevealOnFocus();
  const ready = recovery.state.kind === "ready";
  const checking = recovery.state.kind === "idle" || recovery.state.kind === "preparing";
  const passwordBusy = ["saving", "signing-out", "finished"].includes(recovery.state.kind);
  const success = recovery.state.kind === "signing-out" || recovery.state.kind === "finished";
  const invalid = recovery.state.kind === "invalid";
  const message =
    recovery.state.kind === "failed"
      ? passwordResetErrorMessage(recovery.state.error, s)
      : recovery.state.kind === "ready" && recovery.state.error
        ? passwordResetErrorMessage(recovery.state.error, s)
        : invalid
          ? s.authResetLinkInvalid
          : success
            ? s.authPasswordUpdated
            : checking
              ? s.authResetChecking
              : null;
  const messageType = success ? "success" : checking ? "info" : "error";
  // An expired or invalid link offers a new one instead of a dead end.
  const requestNewLink =
    invalid || recovery.state.kind === "failed"
      ? { label: s.authResetRequestNew, onPress: () => router.replace("/auth/forgot-password") }
      : null;
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
    setPasswordVisible(false);
    setConfirmPasswordVisible(false);
    await recovery.submit(data.password);
  };

  const unavailableContent = !configured ? (
    <AuthUnavailableState
      title={s.authUnavailableTitle}
      subtitle={s.authUnavailableSubtitle}
      dir={dir}
      continueLabel={s.authContinueOffline}
      onContinue={continueOffline}
    />
  ) : undefined;

  return (
    <AuthScreenShell
      locale={locale}
      title={s.authResetPasswordTitle}
      subtitle={configured ? s.authResetPasswordSubtitle : s.authUnavailableSubtitle}
      appName={s.appName}
      brandHeadline={s.authBrandHeadline}
      backLabel={s.authBack}
      languageLabel={s.authLanguage}
      onBack={back}
      unavailableContent={unavailableContent}
    >
      <View className="w-full">
        <AuthFormNotice message={message} tone={messageType} dir={dir} action={requestNewLink} />

        <FormTextField
          control={control}
          name="password"
          label={s.authNewPassword}
          error={errors.password?.message}
          hint={s.authPasswordMinHint}
          dir={dir}
          inputProps={{
            secureTextEntry: !passwordVisible,
            autoCapitalize: "none",
            autoCorrect: false,
            autoComplete: "new-password",
            textContentType: "newPassword",
            passwordRules: "minlength: 6;",
            importantForAutofill: "yes",
            returnKeyType: "next",
            onSubmitEditing: () => confirmPasswordRef.current?.focus(),
            onFocus: reveal,
            blurOnSubmit: false,
            startIcon: <Lock size={18} color={colors.muted} />,
            endIcon: (
              <Pressable
                onPress={() => setPasswordVisible((current) => !current)}
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? s.authHidePassword : s.authShowPassword}
                hitSlop={12}
              >
                {passwordVisible ? <EyeOff size={20} color={colors.muted} /> : <Eye size={20} color={colors.muted} />}
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
            secureTextEntry: !confirmPasswordVisible,
            autoCapitalize: "none",
            autoCorrect: false,
            autoComplete: "new-password",
            textContentType: "newPassword",
            importantForAutofill: "yes",
            returnKeyType: "done",
            onSubmitEditing: handleSubmit(onSubmit),
            onFocus: reveal,
            startIcon: <Lock size={18} color={colors.muted} />,
            endIcon: (
              <Pressable
                onPress={() => setConfirmPasswordVisible((current) => !current)}
                accessibilityRole="button"
                accessibilityLabel={confirmPasswordVisible ? s.authHidePassword : s.authShowPassword}
                hitSlop={12}
              >
                {confirmPasswordVisible ? (
                  <EyeOff size={20} color={colors.muted} />
                ) : (
                  <Eye size={20} color={colors.muted} />
                )}
              </Pressable>
            ),
          }}
        />

        <View className="h-7" />

        <Button onPress={handleSubmit(onSubmit)} disabled={isLoading || passwordBusy || !ready} size="lg" dir={dir}>
          <PendingLabel
            pending={isLoading || passwordBusy}
            label={s.authUpdatePassword}
            pendingLabel={s.authSaving}
            dir={dir}
          />
        </Button>
      </View>
    </AuthScreenShell>
  );
}
