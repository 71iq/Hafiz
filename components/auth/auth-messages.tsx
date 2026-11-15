import { useCallback, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { classifyAuthError, type AuthErrorInfo } from "@/lib/auth/errors";
import { formatNumber } from "@/lib/i18n/count";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import type { Direction } from "@/lib/ui/direction";
import { useCooldown } from "@/components/auth/use-cooldown";

type Locale = "en" | "ar";

/** Seconds in the interface's digits. */
export function formatSeconds(seconds: number, locale: Locale): string {
  return formatNumber(seconds, locale);
}

/**
 * A screen's current server error, mapped to localized copy. Rate limits with an actual retry delay
 * count down and block submission until it ends; without one, the copy says to try again shortly.
 * Raw provider messages never reach the screen.
 */
export function useAuthFormError(s: UIStrings, locale: Locale, scope: "attempts" | "requests") {
  const [info, setInfo] = useState<AuthErrorInfo | null>(null);
  const retry = useCooldown();
  const startRetry = retry.start;

  const report = useCallback(
    (error: unknown) => {
      const next = classifyAuthError(error);
      setInfo(next);
      if (next.kind === "rate-limited" && next.retryAfterSeconds) startRetry(next.retryAfterSeconds);
      return next;
    },
    [startRetry],
  );
  const clear = useCallback(() => setInfo(null), []);

  let message: string | null = null;
  if (info) {
    switch (info.kind) {
      case "rate-limited":
        if (info.retryAfterSeconds === null)
          message = scope === "attempts" ? s.authErrorRateLimited : s.authErrorRequestsLimited;
        else if (retry.active)
          message = interpolate(scope === "attempts" ? s.authErrorRateLimitedIn : s.authErrorRequestsLimitedIn, {
            seconds: formatSeconds(retry.remaining, locale),
          });
        break;
      case "invalid-credentials":
        message = s.authInvalidCredentials;
        break;
      case "email-not-confirmed":
        message = s.authErrorEmailNotConfirmed;
        break;
      case "offline":
        message = s.authErrorOffline;
        break;
      case "weak-password":
        message = s.authErrorWeakPassword;
        break;
      case "browser-unsupported":
        message = s.authResetBrowserUnsupported;
        break;
      default:
        message = s.authErrorGeneric;
    }
  }

  return { kind: info?.kind ?? null, message, report, clear, blocked: retry.active };
}

/** Submit button content: a spinner beside a readable pending label. */
export function PendingLabel({
  pending,
  label,
  pendingLabel,
  dir,
  color = "#FFFFFF",
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  dir: Direction;
  color?: string;
}) {
  return (
    <>
      {pending ? <ActivityIndicator size="small" color={color} /> : null}
      <Text
        className="text-center text-white"
        style={{ fontFamily: "Manrope_700Bold", fontSize: 16, writingDirection: dir }}
      >
        {pending ? pendingLabel : label}
      </Text>
    </>
  );
}
