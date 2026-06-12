import { useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail } from "lucide-react-native";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
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

type ForgotPasswordForm = {
  email: string;
};

function createForgotPasswordSchema(s: typeof strings.en) {
  return z.object({
    email: z.string().trim().toLowerCase().email(s.authValidationInvalidEmail),
  });
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const locale = getStartupLanguage();
  const dir: Direction = locale === "ar" ? "rtl" : "ltr";
  const s = strings[locale];
  const schema = useMemo(() => createForgotPasswordSchema(s), [s]);
  const { sendPasswordReset, isLoading, error } = useAuthStore();
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("error");
  const configured = isSupabaseConfigured();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordForm) => {
    if (!configured) {
      setMessageType("error");
      setMessage(s.authUnavailableSubtitle);
      return;
    }
    try {
      setMessage(null);
      await sendPasswordReset(data.email);
      setMessageType("success");
      setMessage(s.authPasswordResetSent);
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
      title={s.authForgotPasswordTitle}
      subtitle={configured ? s.authForgotPasswordSubtitle : s.authUnavailableSubtitle}
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
          name="email"
          label={s.authEmail}
          error={errors.email?.message}
          dir={dir}
          inputProps={{
            placeholder: s.authEmail,
            keyboardType: "email-address",
            autoCapitalize: "none",
            autoCorrect: false,
            returnKeyType: "done",
            onSubmitEditing: handleSubmit(onSubmit),
            startIcon: <Mail size={18} color="#8B8178" />,
          }}
        />

        <View className="h-7" />

        <Button onPress={handleSubmit(onSubmit)} disabled={isLoading || !configured} size="lg" dir={dir}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              className="text-center text-white"
              style={{ fontFamily: "Manrope_700Bold", fontSize: 16, writingDirection: dir }}
            >
              {s.authSendResetLink}
            </Text>
          )}
        </Button>
      </View>
    </AuthScreenShell>
  );
}
