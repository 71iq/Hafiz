import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  QfBeginOAuthResponse,
  QfConnectionStatusResponse,
  QfCompleteOAuthResponse,
  QfUserAction,
  QfUserError,
  QfUserResponse,
} from "./user-types";
import { QF_OAUTH_PROVIDER, QF_OAUTH_SCOPES } from "./user-types";

export async function invokeQfUser(action: QfUserAction): Promise<QfUserResponse> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      code: "not_configured",
      message: "Cloud sync is not configured.",
    };
  }

  const { data, error } = await supabase.functions.invoke<QfUserResponse>("qf-user", {
    body: action,
  });

  if (data?.ok === true || data?.ok === false) return data;

  if (error) {
    const errorBody = await readFunctionError(error);
    if (errorBody) return errorBody;
    return {
      ok: false,
      code: "upstream",
      message: "Quran Foundation sync is unavailable.",
    };
  }

  return {
    ok: false,
    code: "upstream",
    message: "Quran Foundation sync is unavailable.",
  };
}

export async function connectQfFromSession(session: Session | null): Promise<QfUserResponse> {
  const providerAccessToken = stringOrUndefined((session as any)?.provider_token);
  if (!providerAccessToken) {
    return {
      ok: false,
      code: "bad_request",
      message: "Quran Foundation did not return an access token.",
    };
  }

  const providerRefreshToken = stringOrUndefined((session as any)?.provider_refresh_token);
  return connectQfProviderTokens(providerAccessToken, providerRefreshToken);
}

export async function connectQfProviderTokens(
  providerAccessToken: string,
  providerRefreshToken?: string
): Promise<QfUserResponse> {
  return invokeQfUser({
    action: "connect",
    providerAccessToken,
    providerRefreshToken,
    scopes: QF_OAUTH_SCOPES.split(" "),
  });
}

export async function getQfConnectionStatus(): Promise<QfConnectionStatusResponse | QfUserError> {
  const response = await invokeQfUser({ action: "status" });
  if (response.ok && "status" in response) return response as QfConnectionStatusResponse;
  return response as QfUserError;
}

export async function beginQfOAuthConnection(
  redirectUri: string,
  returnTo?: string
): Promise<QfBeginOAuthResponse | QfUserError> {
  const response = await invokeQfUser({ action: "begin-oauth", redirectUri, returnTo });
  if (response.ok && "authorizationUrl" in response) return response as QfBeginOAuthResponse;
  return response as QfUserError;
}

export async function completeQfOAuthConnection(
  code: string,
  state: string,
  redirectUri: string
): Promise<QfCompleteOAuthResponse | QfUserError> {
  const response = await invokeQfUser({ action: "complete-oauth", code, state, redirectUri });
  if (response.ok && "status" in response && response.status === "connected") return response as QfCompleteOAuthResponse;
  return response as QfUserError;
}

export async function getQfLinkedIdentityState(): Promise<{ linked: boolean }> {
  if (!isSupabaseConfigured()) return { linked: false };
  const getUserIdentities = (supabase.auth as any).getUserIdentities;
  if (typeof getUserIdentities !== "function") return { linked: false };
  const { data, error } = await getUserIdentities.call(supabase.auth);
  if (error) return { linked: false };
  const identities = Array.isArray(data?.identities) ? data.identities : [];
  return { linked: identities.some((identity: any) => identity?.provider === QF_OAUTH_PROVIDER) };
}

export async function disconnectQfUser(): Promise<QfUserResponse> {
  return invokeQfUser({ action: "disconnect" });
}

async function readFunctionError(error: unknown): Promise<QfUserError | null> {
  const context = (error as { context?: unknown }).context;
  if (!context || typeof (context as Response).json !== "function") return null;
  try {
    const body = await (context as Response).json();
    if (body?.ok === false) return body as QfUserError;
  } catch (_) {}
  return null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
