import type { Session } from "@supabase/supabase-js";
import { z } from "zod";
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

// Edge-function replies are checked before use. Success payloads for bookmarks and notes are
// validated in user-payloads.ts; the error body and the connection replies are checked here, and
// a malformed one becomes the same "unavailable" error as a failed call (RF193).
const UNAVAILABLE: QfUserError = {
  ok: false,
  code: "upstream",
  message: "Quran Foundation sync is unavailable.",
};
const optionalTime = z.string().nullish();
const errorReply = z.object({
  ok: z.literal(false),
  code: z.enum([
    "bad_request",
    "not_configured",
    "not_authenticated",
    "not_connected",
    "needs_reauth",
    "forbidden",
    "rate_limited",
    "upstream",
  ]),
  message: z.string(),
});
const statusReply = z.object({
  ok: z.literal(true),
  status: z.enum(["connected", "needs_reauth", "disconnected"]),
  env: z.enum(["prelive", "production"]).optional(),
  connectedAt: optionalTime,
  updatedAt: optionalTime,
});
const beginReply = z.object({ ok: z.literal(true), authorizationUrl: z.string(), expiresAt: z.string() });
const completeReply = z.object({ ok: z.literal(true), status: z.literal("connected"), connectedAt: z.string() });

function readReply<T>(schema: z.ZodType<T>, response: QfUserResponse): T | QfUserError {
  if (!response.ok) return response;
  const parsed = schema.safeParse(response);
  return parsed.success ? parsed.data : UNAVAILABLE;
}

function readErrorBody(body: unknown): QfUserError {
  const parsed = errorReply.safeParse(body);
  return parsed.success ? parsed.data : UNAVAILABLE;
}

export type QfRequestOwner = Readonly<{
  requireCurrent: () => void;
  getAccessToken: () => Promise<string>;
}>;

export async function invokeQfUser(action: QfUserAction, owner?: QfRequestOwner): Promise<QfUserResponse> {
  owner?.requireCurrent();
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      code: "not_configured",
      message: "Cloud sync is not configured.",
    };
  }

  const headers = owner ? { Authorization: "Bearer " + (await owner.getAccessToken()) } : undefined;
  owner?.requireCurrent();
  const { data, error } = await supabase.functions.invoke<QfUserResponse>("qf-user", {
    body: action,
    ...(headers ? { headers } : {}),
  });
  owner?.requireCurrent();

  if (data?.ok === true) return data;
  if (data?.ok === false) return readErrorBody(data);

  if (error) {
    const errorBody = await readFunctionError(error);
    owner?.requireCurrent();
    return errorBody ?? UNAVAILABLE;
  }

  return UNAVAILABLE;
}

export async function connectQfFromSession(session: Session | null, owner?: QfRequestOwner): Promise<QfUserResponse> {
  owner?.requireCurrent();
  const providerAccessToken = stringOrUndefined(session?.provider_token);
  if (!providerAccessToken) {
    return {
      ok: false,
      code: "bad_request",
      message: "Quran Foundation did not return an access token.",
    };
  }

  const providerRefreshToken = stringOrUndefined(session?.provider_refresh_token);
  return connectQfProviderTokens(providerAccessToken, providerRefreshToken, owner);
}

export async function connectQfProviderTokens(
  providerAccessToken: string,
  providerRefreshToken?: string,
  owner?: QfRequestOwner,
): Promise<QfUserResponse> {
  return invokeQfUser(
    {
      action: "connect",
      providerAccessToken,
      providerRefreshToken,
      scopes: QF_OAUTH_SCOPES.split(" "),
    },
    owner,
  );
}

export async function getQfConnectionStatus(owner?: QfRequestOwner): Promise<QfConnectionStatusResponse | QfUserError> {
  return readReply<QfConnectionStatusResponse>(statusReply, await invokeQfUser({ action: "status" }, owner));
}

export async function beginQfOAuthConnection(
  redirectUri: string,
  returnTo?: string,
): Promise<QfBeginOAuthResponse | QfUserError> {
  return readReply<QfBeginOAuthResponse>(
    beginReply,
    await invokeQfUser({ action: "begin-oauth", redirectUri, returnTo }),
  );
}

export async function completeQfOAuthConnection(
  code: string,
  state: string,
  redirectUri: string,
): Promise<QfCompleteOAuthResponse | QfUserError> {
  return readReply<QfCompleteOAuthResponse>(
    completeReply,
    await invokeQfUser({ action: "complete-oauth", code, state, redirectUri }),
  );
}

export async function getQfLinkedIdentityState(): Promise<{ linked: boolean }> {
  if (!isSupabaseConfigured()) return { linked: false };
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) return { linked: false };
  const identities = Array.isArray(data?.identities) ? data.identities : [];
  return { linked: identities.some((identity) => identity?.provider === QF_OAUTH_PROVIDER) };
}

export async function disconnectQfUser(): Promise<QfUserResponse> {
  return invokeQfUser({ action: "disconnect" });
}

async function readFunctionError(error: unknown): Promise<QfUserError | null> {
  const context = (error as { context?: unknown }).context;
  if (!context || typeof (context as Response).json !== "function") return null;
  try {
    const body: unknown = await (context as Response).json();
    if (body && typeof body === "object" && "ok" in body && body.ok === false) return readErrorBody(body);
  } catch {}
  return null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
