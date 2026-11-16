export type AuthErrorKind =
  | "invalid-credentials"
  | "email-not-confirmed"
  | "rate-limited"
  | "offline"
  | "weak-password"
  | "browser-unsupported"
  | "unknown";

export type AuthErrorInfo = {
  kind: AuthErrorKind;
  retryAfterSeconds: number | null;
};

const RATE_LIMIT_CODES = new Set([
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "over_sms_send_rate_limit",
  "too_many_requests",
]);

function field(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

function headerValue(error: unknown, name: string): string | null {
  const headers = field(error, "headers") ?? field(field(error, "response"), "headers");
  if (!headers || typeof headers !== "object") return null;
  const get = (headers as { get?: unknown }).get;
  if (typeof get === "function") {
    const value = (get as (key: string) => unknown).call(headers, name);
    return typeof value === "string" ? value : null;
  }
  const value = (headers as Record<string, unknown>)[name] ?? (headers as Record<string, unknown>)[name.toLowerCase()];
  return typeof value === "string" ? value : null;
}

export function readRetryAfterSeconds(error: unknown, now = Date.now()): number | null {
  const explicit = field(error, "retryAfter") ?? field(error, "retry_after");
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return Math.ceil(explicit);
  const header = headerValue(error, "Retry-After");
  if (header) {
    if (/^\d+$/.test(header.trim())) {
      const seconds = Number(header.trim());
      if (seconds > 0) return seconds;
    } else {
      const date = Date.parse(header);
      if (Number.isFinite(date) && date > now) return Math.ceil((date - now) / 1000);
    }
  }
  const message = field(error, "message");
  if (typeof message === "string") {
    const match = /after (\d{1,4}) seconds?/i.exec(message);
    if (match && Number(match[1]) > 0) return Number(match[1]);
  }
  return null;
}

export function classifyAuthError(error: unknown): AuthErrorInfo {
  const code = field(error, "code");
  const status = field(error, "status");
  const name = field(error, "name");
  const message = String(field(error, "message") ?? (typeof error === "string" ? error : ""));
  const info = (kind: AuthErrorKind): AuthErrorInfo => ({
    kind,
    retryAfterSeconds: kind === "rate-limited" ? readRetryAfterSeconds(error) : null,
  });

  if (code === "auth_storage_lock_unavailable") return info("browser-unsupported");
  if ((typeof code === "string" && RATE_LIMIT_CODES.has(code)) || status === 429) return info("rate-limited");
  if (/rate limit|too many requests|for security purposes, you can only request this/i.test(message))
    return info("rate-limited");
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) return info("email-not-confirmed");
  if (code === "invalid_credentials" || message === "Invalid login credentials") return info("invalid-credentials");
  if (code === "weak_password") return info("weak-password");
  if (
    name === "AuthRetryableFetchError" ||
    (status === 0 && name !== "AuthApiError") ||
    /network request failed|failed to fetch|networkerror|load failed|fetch failed/i.test(message)
  )
    return info("offline");
  return info("unknown");
}
