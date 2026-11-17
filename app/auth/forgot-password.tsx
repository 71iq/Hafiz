import { useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail } from "lucide-react-native";
import { getEnabledSocialProviders, isEmailAuthFlowsEnabled } from "@/lib/auth/config";
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
  AuthScreenShell,
  AuthTextLink,
  AuthUnavailableState,
  useAuthIconColors,
  useRevealOnFocus,
} from "@/components/auth/AuthScreenShell";
import { PendingLabel, formatSeconds, useAuthFormError } from "@/components/auth/auth-messages";
import { EMAIL_RESEND_COOLDOWN_SECONDS, useCooldown } from "@/components/auth/use-cooldown";
import { useAuthReturn } from "@/components/auth/use-auth-return";
import { textStartStyle, type Direction } from "@/lib/ui/direction";

type ForgotPasswordForm = {
  email: string;
};

function createForgotPasswordSchema(s: UIStrings) {
  return z.object({
    email: z.string().trim().toLowerCase().email(s.authValidationInvalidEmail),
  });
}

export default function ForgotPasswordScreen() {
  // The limited-service notice on Login explains that password reset is unavailable.
  if (!isEmailAuthFlowsEnabled()) return <Redirect href="/auth/login" />;
  return <ForgotPasswordFormScreen />;
}

function ForgotPasswordFormScreen() {
  const router = useRouter();
  const locale = useAppLanguage();
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const s = strings[locale];
  const schema = useMemo(() => createForgotPasswordSchema(s), [s]);
  const { sendPasswordReset, isLoading } = useAuthStore();
  const { back, continueOffline } = useAuthReturn({ ownsReturn: false });
  const formError = useAuthFormError(s, locale, "requests");
  const sendCooldown = useCooldown();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const configured = isSupabaseConfigured();
  const colors = useAuthIconColors();
  const reveal = useRevealOnFocus();

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: readCarriedAuthEmail() },
  });

  const send = async (email: string) => {
    if (!configured || sending || sendCooldown.active || formError.blocked) return;
    setSending(true);
    formError.clear();
    try {
      await sendPasswordReset(email);
      setSentTo(email.trim().toLowerCase());
      // The provider limits repeated reset mail; wait before allowing another request.
      sendCooldown.start(EMAIL_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      formError.report(err);
    } finally {
      setSending(false);
    }
  };
  const onSubmit = (data: ForgotPasswordForm) => send(data.email);

  const backToLogin = () => {
    carryAuthEmail(sentTo ?? getValues("email") ?? "");
    if (router.canGoBack()) router.back();
    else router.replace("/auth/login");
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

  const cooldownLabel = sendCooldown.active
    ? interpolate(s.authSendAgainIn, { seconds: formatSeconds(sendCooldown.remaining, locale) })
    : null;
  const pending = sending || isLoading;

  // A neutral confirmation: it never says whether the address has an account.
  const sentPanel = sentTo ? (
    <View className="w-full">
      <AuthFormNotice
        message={
          interpolate(s.authForgotSent, { email: sentTo }) +
          // Native reset links open the web page; the app cannot finish the reset itself.
          (Platform.OS === "web" ? "" : ` ${s.authForgotSentBrowser}`)
        }
        tone="success"
        dir={dir}
      />
      <AuthFormNotice message={formError.message} dir={dir} />
      <Button onPress={backToLogin} size="lg" dir={dir}>
        <PendingLabel pending={false} label={s.authBackToLogin} pendingLabel={s.authBackToLogin} dir={dir} />
      </Button>
      <View className="h-2" />
      <AuthTextLink
        label={cooldownLabel ?? s.authSendAgain}
        dir={dir}
        align="center"
        disabled={sendCooldown.active || pending}
        onPress={() => void send(sentTo)}
      />
    </View>
  ) : null;

  const form = (
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
          returnKeyType: "done",
          onSubmitEditing: handleSubmit(onSubmit),
          onFocus: reveal,
          startIcon: <Mail size={18} color={colors.muted} />,
        }}
      />

      <View className="h-6" />

      <Button
        onPress={handleSubmit(onSubmit)}
        disabled={pending || !configured || sendCooldown.active || formError.blocked}
        size="lg"
        dir={dir}
      >
        <PendingLabel
          pending={pending}
          label={cooldownLabel ?? s.authSendResetLink}
          pendingLabel={s.authSending}
          dir={dir}
        />
      </Button>

      <AuthTextLink label={s.authBackToLogin} dir={dir} align="center" onPress={backToLogin} />

      {getEnabledSocialProviders().length > 0 ? (
        <Text
          className="mt-2 text-warm-600 dark:text-neutral-400"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 13,
            lineHeight: 20,
            ...textStartStyle(dir === "rtl"),
            writingDirection: dir,
          }}
        >
          {s.authForgotSocialNote}
        </Text>
      ) : null}
    </View>
  );

  return (
    <AuthScreenShell
      locale={locale}
      title={s.authForgotPasswordTitle}
      subtitle={s.authForgotPasswordSubtitle}
      appName={s.appName}
      brandHeadline={s.authBrandHeadline}
      backLabel={s.authBack}
      languageLabel={s.authLanguage}
      onBack={back}
      unavailableContent={unavailableContent}
    >
      {sentPanel ?? form}
    </AuthScreenShell>
  );
}
