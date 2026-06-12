import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock, Mail, User, UserRound } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { strings } from "@/lib/i18n/strings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { Button } from "@/components/ui/Button";
import { FormTextField } from "@/components/ui/FormTextField";
import {
  AuthFormNotice,
  AuthRouteLink,
  AuthScreenShell,
  AuthUnavailableState,
} from "@/components/auth/AuthScreenShell";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import type { Direction } from "@/lib/ui/direction";

type SignupForm = {
  email: string;
  password: string;
  username: string;
  displayName?: string;
};

function createSignupSchema(s: typeof strings.en) {
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
  const router = useRouter();
  const locale = getStartupLanguage();
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const s = strings[locale];
  const schema = useMemo(() => createSignupSchema(s), [s]);
  const { signUp, resendSignupConfirmation, isLoading, error } = useAuthStore();
  const [showError, setShowError] = useState<string | null>(null);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const configured = isSupabaseConfigured();

  const usernameRef = useRef<TextInput>(null);
  const displayNameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupForm>({
    resolver: zodResolver(schema),
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
        setPendingConfirmationEmail(data.email);
        setShowError(s.authSignupConfirmEmail);
        return;
      }
      router.back();
    } catch (err: any) {
      setShowError(err.message);
    }
  };

  const handleResendConfirmation = async () => {
    if (!pendingConfirmationEmail) return;
    try {
      setShowError(null);
      await resendSignupConfirmation(pendingConfirmationEmail);
      setShowError(s.authConfirmationResent);
    } catch (err: any) {
      setShowError(err.message);
    }
  };

  const form = configured ? (
    <View className="w-full">
      <AuthFormNotice message={showError || error} dir={dir} />

      <FormTextField
        control={control}
        name="email"
        label={s.authEmail}
        error={errors.email?.message}
        dir={dir}
        inputProps={{
          placeholder: s.authEmail,
          keyboardType: "email-address",
          autoCapitalize: "none",
          autoCorrect: false,
          returnKeyType: "next",
          onSubmitEditing: () => usernameRef.current?.focus(),
          blurOnSubmit: false,
          startIcon: <Mail size={18} color="#8B8178" />,
        }}
      />

      <View className="h-4" />

      <FormTextField
        control={control}
        name="username"
        label={s.authUsername}
        error={errors.username?.message}
        dir={dir}
        inputRef={usernameRef}
        inputProps={{
          placeholder: s.authUsername,
          autoCapitalize: "none",
          autoCorrect: false,
          returnKeyType: "next",
          onSubmitEditing: () => displayNameRef.current?.focus(),
          blurOnSubmit: false,
          startIcon: <UserRound size={18} color="#8B8178" />,
        }}
      />

      <View className="h-4" />

      <FormTextField
        control={control}
        name="displayName"
        label={s.authDisplayName}
        error={errors.displayName?.message}
        dir={dir}
        inputRef={displayNameRef}
        inputProps={{
          placeholder: s.authDisplayName,
          returnKeyType: "next",
          onSubmitEditing: () => passwordRef.current?.focus(),
          blurOnSubmit: false,
          startIcon: <User size={18} color="#8B8178" />,
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
          placeholder: s.authPassword,
          secureTextEntry: !passwordVisible,
          returnKeyType: "done",
          onSubmitEditing: handleSubmit(onSubmit),
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

      <View className="h-6" />

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
        size="lg"
        dir={dir}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text
            className="text-center text-white"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 16, writingDirection: dir }}
          >
            {s.authSignup}
          </Text>
        )}
      </Button>

      {pendingConfirmationEmail ? (
        <Button
          variant="outline"
          onPress={handleResendConfirmation}
          disabled={isLoading}
          className="mt-3 border border-surface-high"
          dir={dir}
        >
          <Text
            className="text-center text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, writingDirection: dir }}
          >
            {s.authResendConfirmation}
          </Text>
        </Button>
      ) : null}
    </View>
  ) : null;

  const unavailableContent = !configured ? (
    <AuthUnavailableState title={s.authUnavailableTitle} subtitle={s.authUnavailableSubtitle} dir={dir} />
  ) : undefined;

  const footer = configured ? (
    <>
      <OAuthButtons
        strings={{
          authOrContinueWith: s.authOrContinueWith,
          authContinueWithQuranFoundation: s.authContinueWithQuranFoundation,
          authContinueWithGoogle: s.authContinueWithGoogle,
          authContinueWithApple: s.authContinueWithApple,
          authContinueWithFacebook: s.authContinueWithFacebook,
        }}
        onError={(msg) => setShowError(msg)}
      />
      <AuthRouteLink
        prompt={s.authHasAccount}
        action={s.authLogin}
        dir={dir}
        onPress={() => router.replace("/auth/login")}
      />
    </>
  ) : null;

  return (
    <AuthScreenShell
      locale={locale}
      title={s.authSignup}
      subtitle={configured ? s.authSignupSubtitle : s.authUnavailableSubtitle}
      appName={s.appName}
      brandHeadline={s.authBrandHeadline}
      brandBody={s.authBrandBody}
      backLabel={s.authBack}
      onBack={() => router.back()}
      footer={footer}
      unavailableContent={unavailableContent}
    >
      {form}
    </AuthScreenShell>
  );
}
