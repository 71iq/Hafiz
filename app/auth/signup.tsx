import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock, Mail, User, UserRound } from "lucide-react-native";
import { isEmailAuthFlowsEnabled } from "@/lib/auth/config";
import { carryAuthEmail, readCarriedAuthEmail } from "@/lib/auth/form-handoff";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { strings } from "@/lib/i18n/strings";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate, useAppLanguage } from "@/lib/i18n/useStrings";
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

type SignupForm = {
  email: string;
  password: string;
  username: string;
  displayName?: string;
};

function createSignupSchema(s: UIStrings) {
  return z.object({
    email: z.string().trim().toLowerCase().email(s.authValidationInvalidEmail),
    password: z.string().min(6, s.authValidationPasswordMin),
    username: z
      .string()
      .trim()
      .min(3, s.authValidationUsernameMin)
      .max(20, s.authValidationUsernameMax)
      .regex(/^[a-zA-Z0-9_]+$/, s.authValidationUsernamePattern),
    displayName: z.string().optional(),
  });
}

export default function SignupScreen() {
  // The limited-service notice on Login explains that sign up is unavailable.
  if (!isEmailAuthFlowsEnabled()) return <Redirect href="/auth/login" />;
  return <SignupFormScreen />;
}

function SignupFormScreen() {
  const router = useRouter();
  const locale = useAppLanguage();
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const s = strings[locale];
  const schema = useMemo(() => createSignupSchema(s), [s]);
  const { signUp, resendSignupConfirmation, isLoading } = useAuthStore();
  const { acquire } = useEmailSubmission();
  const { complete, back, continueOffline } = useAuthReturn();
  const formError = useAuthFormError(s, locale, "requests");
  const resendCooldown = useCooldown();
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const configured = isSupabaseConfigured();
  const colors = useAuthIconColors();
  const reveal = useRevealOnFocus();

  const usernameRef = useRef<TextInput>(null);
  const displayNameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<SignupForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: readCarriedAuthEmail(), password: "", username: "", displayName: "" },
  });

  useFocusEffect(useCallback(() => () => setPasswordVisible(false), []));

  const onSubmit = async (data: SignupForm) => {
    setPasswordVisible(false);
    if (formError.blocked) return;
    const lease = acquire();
    if (!lease) return;
    let flow: ReturnType<typeof signUp> | null = null;
    try {
      formError.clear();
      setResendState("idle");
      if (!configured) return;
      flow = signUp(data.email, data.password, data.username, data.displayName || "");
      const result = await flow.result;
      if (!lease.isCurrent() || !flow.isCurrent() || result.status !== "completed" || !result.owner.isCurrent()) return;
      if (result.value.status === "alreadyRegistered" || result.value.status === "needsEmailConfirmation") {
        // The same neutral result either way, so the form does not reveal who has an account.
        setPendingConfirmationEmail(data.email);
        // The provider just handled a confirmation and refuses another within the same window.
        resendCooldown.start(EMAIL_RESEND_COOLDOWN_SECONDS);
        return;
      }
      // A session exists: replace auth with the captured context or Home. No profile setup step.
      complete();
    } catch (err: unknown) {
      if (!lease.isCurrent() || (flow && !flow.isCurrent())) return;
      formError.report(err);
    } finally {
      lease.release();
    }
  };
  const submit = handleSubmit(onSubmit, () => setPasswordVisible(false));

  const handleResendConfirmation = async () => {
    if (!pendingConfirmationEmail || resendCooldown.active || resendState === "sending") return;
    setResendState("sending");
    try {
      await resendSignupConfirmation(pendingConfirmationEmail);
      setResendState("sent");
      resendCooldown.start(EMAIL_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setResendState("idle");
      formError.report(err);
    }
  };

  // Leaving for another auth screen carries only the email, in memory.
  const openLogin = (email: string) => {
    carryAuthEmail(email);
    router.replace("/auth/login");
  };

  // A neutral result: a confirmed or Google address gets no email, so the panel always offers the
  // ways back in, and never says whether the address has an account.
  const confirmationPanel = pendingConfirmationEmail ? (
    <View className="w-full">
      <AuthFormNotice
        message={interpolate(resendState === "sent" ? s.authSignupConfirmationResent : s.authSignupConfirmEmail, {
          email: pendingConfirmationEmail,
        })}
        tone="success"
        dir={dir}
      />
      <AuthFormNotice message={formError.message} dir={dir} />
      <Button onPress={() => openLogin(pendingConfirmationEmail)} size="lg" dir={dir}>
        <PendingLabel pending={false} label={s.authLogin} pendingLabel={s.authLogin} dir={dir} />
      </Button>
      <View className="h-2" />
      <AuthTextLink
        label={s.authForgotPassword}
        dir={dir}
        align="center"
        onPress={() => {
          carryAuthEmail(pendingConfirmationEmail);
          router.push("/auth/forgot-password");
        }}
      />
      <AuthTextLink
        label={
          resendState === "sending"
            ? s.authSending
            : resendCooldown.active
              ? interpolate(s.authResendIn, { seconds: formatSeconds(resendCooldown.remaining, locale) })
              : s.authResendConfirmation
        }
        dir={dir}
        align="center"
        disabled={resendCooldown.active || resendState === "sending"}
        onPress={() => void handleResendConfirmation()}
      />
      <AuthTextLink
        label={s.authUseDifferentEmail}
        dir={dir}
        align="center"
        onPress={() => {
          setPendingConfirmationEmail(null);
          setResendState("idle");
        }}
      />
    </View>
  ) : null;

  const form = configured ? (
    <View className="w-full">
      <AuthFormNotice message={formError.message} dir={dir} />

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
          returnKeyType: "next",
          onSubmitEditing: () => usernameRef.current?.focus(),
          onFocus: reveal,
          blurOnSubmit: false,
          startIcon: <Mail size={18} color={colors.muted} />,
        }}
      />

      <View className="h-4" />

      <FormTextField
        control={control}
        name="username"
        label={s.authUsername}
        error={errors.username?.message}
        hint={s.authUsernameHint}
        dir={dir}
        inputRef={usernameRef}
        inputProps={{
          autoCapitalize: "none",
          autoCorrect: false,
          autoComplete: "username-new",
          textContentType: "username",
          importantForAutofill: "yes",
          returnKeyType: "next",
          onSubmitEditing: () => displayNameRef.current?.focus(),
          onFocus: reveal,
          blurOnSubmit: false,
          startIcon: <UserRound size={18} color={colors.muted} />,
        }}
      />

      <View className="h-4" />

      <FormTextField
        control={control}
        name="displayName"
        label={s.authDisplayNameOptional}
        error={errors.displayName?.message}
        hint={s.authDisplayNameHelp}
        dir={dir}
        inputRef={displayNameRef}
        inputProps={{
          autoComplete: "name",
          textContentType: "nickname",
          returnKeyType: "next",
          onSubmitEditing: () => passwordRef.current?.focus(),
          onFocus: reveal,
          blurOnSubmit: false,
          startIcon: <User size={18} color={colors.muted} />,
        }}
      />

      <View className="h-4" />

      <FormTextField
        control={control}
        name="password"
        label={s.authPassword}
        error={errors.password?.message}
        hint={s.authPasswordMinHint}
        dir={dir}
        inputRef={passwordRef}
        inputProps={{
          secureTextEntry: !passwordVisible,
          autoCapitalize: "none",
          autoCorrect: false,
          autoComplete: "new-password",
          textContentType: "newPassword",
          passwordRules: "minlength: 6;",
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
              hitSlop={12}
            >
              {passwordVisible ? <EyeOff size={20} color={colors.muted} /> : <Eye size={20} color={colors.muted} />}
            </Pressable>
          ),
        }}
      />

      <View className="h-6" />

      <Button onPress={submit} disabled={isLoading || formError.blocked} size="lg" dir={dir}>
        <PendingLabel
          pending={isLoading && resendState !== "sending"}
          label={s.authSignup}
          pendingLabel={s.authCreatingAccount}
          dir={dir}
        />
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
      <AuthRouteLink
        prompt={s.authHasAccount}
        action={s.authLogin}
        dir={dir}
        onPress={() => openLogin(pendingConfirmationEmail ?? getValues("email") ?? "")}
      />
    </>
  ) : null;

  return (
    <AuthScreenShell
      locale={locale}
      title={s.authSignup}
      subtitle={s.authSignupSubtitle}
      appName={s.appName}
      brandHeadline={s.authBrandHeadline}
      backLabel={s.authBack}
      languageLabel={s.authLanguage}
      onBack={back}
      footer={footer}
      unavailableContent={unavailableContent}
    >
      {confirmationPanel ?? form}
    </AuthScreenShell>
  );
}
