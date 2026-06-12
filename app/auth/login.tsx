import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Lock, Mail } from "lucide-react-native";
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

type LoginForm = {
  email: string;
  password: string;
};

function createLoginSchema(s: typeof strings.en) {
  return z.object({
    email: z.string().trim().toLowerCase().email(s.authValidationInvalidEmail),
    password: z.string().min(6, s.authValidationPasswordMin),
  });
}

export default function LoginScreen() {
  const router = useRouter();
  const locale = getStartupLanguage();
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const s = strings[locale];
  const schema = useMemo(() => createLoginSchema(s), [s]);
  const { signIn, isLoading, error } = useAuthStore();
  const [showError, setShowError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const configured = isSupabaseConfigured();
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginForm) => {
    if (!configured) {
      setShowError(s.authUnavailableSubtitle);
      return;
    }
    try {
      setShowError(null);
      await signIn(data.email, data.password);
      router.replace("/(tabs)/home");
    } catch (err: any) {
      setShowError(err.message === "Invalid login credentials" ? s.authInvalidCredentials : err.message);
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
          onSubmitEditing: () => passwordRef.current?.focus(),
          blurOnSubmit: false,
          startIcon: <Mail size={18} color="#8B8178" />,
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

      <Pressable
        onPress={() => router.push("/auth/forgot-password" as any)}
        className="mt-2 self-end"
        hitSlop={8}
      >
        <Text
          className="text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, writingDirection: dir }}
        >
          {s.authForgotPassword}
        </Text>
      </Pressable>

      <View className="h-7" />

      <Button onPress={handleSubmit(onSubmit)} disabled={isLoading} size="lg" dir={dir}>
        {isLoading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text
            className="text-center text-white"
            style={{ fontFamily: "Manrope_700Bold", fontSize: 16, writingDirection: dir }}
          >
            {s.authLogin}
          </Text>
        )}
      </Button>
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
        prompt={s.authNoAccount}
        action={s.authSignup}
        dir={dir}
        onPress={() => router.replace("/auth/signup")}
      />
    </>
  ) : null;

  return (
    <AuthScreenShell
      locale={locale}
      title={s.authLogin}
      subtitle={configured ? s.authLoginSubtitle : s.authUnavailableSubtitle}
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
