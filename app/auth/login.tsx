import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, TextInput, useWindowDimensions, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock, Mail } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { getEnabledSocialProviders, isEmailAuthFlowsEnabled } from "@/lib/auth/config";
import {
  carryAuthEmail,
  peekAuthHandoffNotice,
  readCarriedAuthEmail,
  takeAuthHandoffNotice,
} from "@/lib/auth/form-handoff";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isQfLoginEnabled } from "@/lib/quran-foundation/config";
import { strings } from "@/lib/i18n/strings";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useAppLanguage } from "@/lib/i18n/useStrings";
import { PERSISTENT_SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { Button } from "@/components/ui/Button";
import { FormTextField } from "@/components/ui/FormTextField";
import {
  AuthFormNotice,
  AuthRouteLink,
  AuthScreenShell,
  AuthTextLink,
  AuthUnavailableState,
  useAuthIconColors,
  useRevealOnFocus,
} from "@/components/auth/AuthScreenShell";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { PendingLabel, formatSeconds, useAuthFormError } from "@/components/auth/auth-messages";
import { EMAIL_RESEND_COOLDOWN_SECONDS, useCooldown } from "@/components/auth/use-cooldown";
import { useAuthReturn } from "@/components/auth/use-auth-return";
import { useEmailSubmission } from "@/components/auth/use-email-submission";
import type { Direction } from "@/lib/ui/direction";

type LoginForm = {
  email: string;
  password: string;
};

// Login checks only that a password was entered; the server decides whether it is right.
// Signup and reset keep the account's password rules.
function createLoginSchema(s: UIStrings) {
  return z.object({
    email: z.string().trim().toLowerCase().email(s.authValidationInvalidEmail),
    password: z.string().min(1, s.authValidationPasswordRequired),
  });
}

export default function LoginScreen() {
  const router = useRouter();
  const locale = useAppLanguage();
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const s = strings[locale];
  const schema = useMemo(() => createLoginSchema(s), [s]);
  const { signIn, resendSignupConfirmation, isLoading, sessionEnded } = useAuthStore();
  const { acquire } = useEmailSubmission();
  const { complete, back, continueOffline } = useAuthReturn();
  const formError = useAuthFormError(s, locale, "attempts");
  const resendCooldown = useCooldown();
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [passwordVisible, setPasswordVisible] = useState(false);
  // A result from the previous auth screen (a saved password) is shown once.
  const [handoffNotice] = useState(peekAuthHandoffNotice);
  useEffect(() => {
    takeAuthHandoffNotice();
  }, []);
  const configured = isSupabaseConfigured();
  const emailFlowsEnabled = isEmailAuthFlowsEnabled();
  // Matches OAuthButtons: the notice shows only when no provider button does.
  const oauthAvailable = getEnabledSocialProviders().length > 0 || isQfLoginEnabled();
  const { width } = useWindowDimensions();
  const colors = useAuthIconColors();
  const reveal = useRevealOnFocus();
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: readCarriedAuthEmail(), password: "" },
  });

  // The password is hidden again whenever the screen loses focus.
  useFocusEffect(useCallback(() => () => setPasswordVisible(false), []));

  // Leaving for another auth screen carries only the typed email, in memory.
  const carryEmail = () => carryAuthEmail(getValues("email") ?? "");

  const onSubmit = async (data: LoginForm) => {
    setPasswordVisible(false);
    if (formError.blocked) return;
    const lease = acquire();
    if (!lease) return;
    let flow: ReturnType<typeof signIn> | null = null;
    try {
      formError.clear();
      setResendState("idle");
      if (!configured) return;
      flow = signIn(data.email, data.password);
      const result = await flow.result;
      if (!lease.isCurrent() || !flow.isCurrent() || result.status !== "completed" || !result.owner.isCurrent()) return;
      // A verified session for this screen: replace auth history with the captured context or Home.
      // Restore consent and sync stay with the sync owner; signing in is not synced progress.
      complete();
    } catch (err: unknown) {
      if (!lease.isCurrent() || (flow && !flow.isCurrent())) return;
      formError.report(err);
    } finally {
      lease.release();
    }
  };
  const submit = handleSubmit(onSubmit, () => setPasswordVisible(false));

  const resendConfirmation = async () => {
    if (resendCooldown.active || resendState === "sending") return;
    const email = getValues("email")?.trim();
    if (!email) return;
    setResendState("sending");
    try {
      await resendSignupConfirmation(email);
      setResendState("sent");
      resendCooldown.start(EMAIL_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setResendState("idle");
      formError.report(err);
    }
  };

  const serverNotice = formError.message;
  const resendAction =
    formError.kind === "email-not-confirmed" && emailFlowsEnabled
      ? {
          label: resendCooldown.active
            ? interpolate(s.authResendIn, { seconds: formatSeconds(resendCooldown.remaining, locale) })
            : s.authResendConfirmation,
          onPress: resendConfirmation,
          disabled: resendCooldown.active,
          busy: resendState === "sending",
        }
      : null;

  const form = configured ? (
    <View className="w-full">
      {handoffNotice === "password-updated" ? (
        <AuthFormNotice message={s.authPasswordUpdated} tone="success" dir={dir} />
      ) : sessionEnded ? (
        <AuthFormNotice message={s.authSessionEnded} tone="info" dir={dir} />
      ) : null}
      {!emailFlowsEnabled ? <AuthFormNotice message={s.authTemporarilyLimited} tone="info" dir={dir} /> : null}
      {!oauthAvailable ? <AuthFormNotice message={s.authSocialOff} tone="info" dir={dir} /> : null}
      <AuthFormNotice message={serverNotice} dir={dir} action={resendAction} />
      {resendState === "sent" ? <AuthFormNotice message={s.authConfirmationResent} tone="success" dir={dir} /> : null}

      <FormTextField
        control={control}
        name="email"
        label={s.authEmail}
        error={errors.email?.message}
        dir={dir}
        inputProps={{
          placeholder: s.authEmailPlaceholder,
          keyboardType: "email-address",
          autoCapitalize: "none",
          autoCorrect: false,
          autoComplete: "email",
          textContentType: "emailAddress",
          importantForAutofill: "yes",
          // Desktop browsers start in Email; phones wait for a tap so the keyboard does not cover the form.
          autoFocus: Platform.OS === "web" && width >= PERSISTENT_SIDEBAR_BREAKPOINT,
          returnKeyType: "next",
          onSubmitEditing: () => passwordRef.current?.focus(),
          onFocus: reveal,
          blurOnSubmit: false,
          startIcon: <Mail size={18} color={colors.muted} />,
        }}
      />

      <View className="h-4" />

      <FormTextField
        control={control}
        name="password"
        label={s.authPassword}
        error={errors.password?.message}
        dir={dir}
        inputRef={passwordRef}
        inputProps={{
          placeholder: s.authPasswordPlaceholder,
          secureTextEntry: !passwordVisible,
          autoCapitalize: "none",
          autoCorrect: false,
          autoComplete: "current-password",
          textContentType: "password",
          importantForAutofill: "yes",
          returnKeyType: "done",
          onSubmitEditing: submit,
          onFocus: reveal,
          startIcon: <Lock size={18} color={colors.muted} />,
          endIcon: (
            <Pressable
              onPress={() => setPasswordVisible((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={passwordVisible ? s.authHidePassword : s.authShowPassword}
              // 20px icon plus 12px on each side reaches the 44px target.
              hitSlop={12}
            >
              {passwordVisible ? <EyeOff size={20} color={colors.muted} /> : <Eye size={20} color={colors.muted} />}
            </Pressable>
          ),
        }}
      />

      {emailFlowsEnabled ? (
        <AuthTextLink
          label={s.authForgotPassword}
          dir={dir}
          onPress={() => {
            carryEmail();
            router.push("/auth/forgot-password");
          }}
        />
      ) : (
        <View className="h-3" />
      )}

      <View className="h-4" />

      <Button onPress={submit} disabled={isLoading || formError.blocked} size="lg" dir={dir}>
        <PendingLabel pending={isLoading} label={s.authLogin} pendingLabel={s.authLoggingIn} dir={dir} />
      </Button>
    </View>
  ) : null;

  const unavailableContent = !configured ? (
    <AuthUnavailableState
      title={s.authUnavailableTitle}
      subtitle={s.authUnavailableSubtitle}
      dir={dir}
      continueLabel={s.authContinueOffline}
      onContinue={continueOffline}
    />
  ) : undefined;

  const footer = configured ? (
    <>
      <OAuthButtons strings={s} onSignedIn={complete} />
      {emailFlowsEnabled && (
        <AuthRouteLink
          prompt={s.authNoAccount}
          action={s.authSignup}
          dir={dir}
          onPress={() => {
            carryEmail();
            router.replace("/auth/signup");
          }}
        />
      )}
    </>
  ) : null;

  return (
    <AuthScreenShell
      locale={locale}
      title={s.authLogin}
      subtitle={s.authLoginSubtitle}
      appName={s.appName}
      brandHeadline={s.authBrandHeadline}
      backLabel={s.authBack}
      languageLabel={s.authLanguage}
      onBack={back}
      footer={footer}
      unavailableContent={unavailableContent}
    >
      {form}
    </AuthScreenShell>
  );
}
