import { z } from "zod";
import { isSupabaseConfigured, supabase, supabaseAnonKey } from "@/lib/supabase";

/**
 * Halaqa and board are online features (SB-01). Each failure keeps its cause so the UI can tell
 * missing configuration, offline state, a server refusal and an invalid response apart
 * (CONVENTIONS.md, DEL-08).
 */
const SOCIAL_REJECTION_CODES = [
  "not_authenticated",
  "invalid_local_date",
  "invalid_bands",
  "invalid_name",
  "invalid_code",
  "halaqa_full",
  "halaqa_limit",
  "not_a_member",
  "not_allowed",
  "invalid_role",
  "invalid_sharing",
  "invalid_recipient",
  "free_text_invite_only",
  "invalid_template",
  "already_encouraged_today",
  "minor_not_allowed",
  "nickname_required",
  "invalid_nickname",
  "invalid_privacy",
  "invalid_week_start",
  "plan_not_shared",
  "invalid_assignment",
] as const;
/**
 * Who a request runs as. The Supabase client is shared, so a request started for one viewer could
 * otherwise run with another account's credentials after a sign-in or switch, cache that account's
 * data under the first viewer's key, or apply an old draft to it. Each request sends the viewer's own
 * bearer token, and its result is used only while the same viewer is still current. Built on the
 * auth coordinator's owner tickets, as sync is (lib/social/owner.ts).
 */
export type SocialViewer = Readonly<{
  isCurrent: () => boolean;
  /** Throws an "account_changed" failure once another account or session has taken over. */
  requireCurrent: () => void;
  /** The bearer token: the owner's session token, or the public key for a signed-out viewer. */
  accessToken: () => Promise<string>;
}>;

/** A signed-in account a halaqa or board request belongs to. */
export type SocialOwner = SocialViewer & Readonly<{ userId: string }>;

export type SocialRejectionCode = (typeof SOCIAL_REJECTION_CODES)[number];

export type SocialFailure =
  | { kind: "unconfigured" }
  | { kind: "offline" }
  // The account that started the request is no longer the signed-in one.
  | { kind: "account_changed" }
  | { kind: "rejected"; code: SocialRejectionCode }
  | { kind: "invalid_response" }
  | { kind: "failed"; message: string };

export type SocialError = Error & { failure: SocialFailure };

export function socialError(failure: SocialFailure): SocialError {
  const message = failure.kind === "rejected" ? failure.code : failure.kind === "failed" ? failure.message : failure.kind;
  return Object.assign(new Error(message), { name: "SocialError", failure });
}

export function socialFailureOf(error: unknown): SocialFailure {
  if (error instanceof Error && "failure" in error) {
    const failure = (error as SocialError).failure;
    if (failure && typeof failure === "object" && "kind" in failure) return failure;
  }
  return classifyRemoteError(error);
}

const remoteError = z.object({ message: z.string().optional(), code: z.string().optional() }).passthrough();
const rejectionCode = z.enum(SOCIAL_REJECTION_CODES);

/** Maps a PostgREST or fetch error to its cause. Server refusals carry their code as the message. */
export function classifyRemoteError(error: unknown): SocialFailure {
  const parsed = remoteError.safeParse(error);
  const message = parsed.success ? (parsed.data.message ?? "") : error instanceof Error ? error.message : String(error);
  const code = rejectionCode.safeParse(message.trim());
  if (code.success) return { kind: "rejected", code: code.data };
  if (/network request failed|failed to fetch|fetch failed|load failed|networkerror|timed? ?out/i.test(message)) {
    return { kind: "offline" };
  }
  return { kind: "failed", message: message || "Request failed" };
}

/** A remote read: the RPC, its arguments and the schema its result must pass. */
export type SocialRead<T> = Readonly<{ fn: string; args: Record<string, unknown>; schema: z.ZodType<T> }>;

/**
 * The project's public (anon) key, from the app configuration. A request that sends it as its
 * bearer runs as anon, whatever session the shared client holds.
 */
export function publicApiKey(): string {
  if (!isSupabaseConfigured()) throw socialError({ kind: "unconfigured" });
  return supabaseAnonKey();
}

/**
 * Calls a SECURITY DEFINER RPC and returns its unvalidated payload. Callers must parse it. With a
 * viewer, the request carries that viewer's token rather than whatever session the shared client
 * holds at dispatch, and its result is refused once that viewer is no longer current.
 */
export async function callSocialRpcRaw(
  fn: string,
  args: Record<string, unknown>,
  owner?: SocialViewer,
): Promise<unknown> {
  if (!isSupabaseConfigured()) throw socialError({ kind: "unconfigured" });
  const token = owner ? await owner.accessToken() : null;
  let result: { data: unknown; error: unknown };
  try {
    const request = supabase.rpc(fn, args);
    result = await (token === null ? request : request.setHeader("Authorization", `Bearer ${token}`));
  } catch (error) {
    throw socialError(classifyRemoteError(error));
  }
  owner?.requireCurrent();
  if (result.error) throw socialError(classifyRemoteError(result.error));
  return result.data;
}

export function parseSocialPayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw socialError({ kind: "invalid_response" });
  return parsed.data;
}

/** Calls a SECURITY DEFINER RPC and validates its result before any caller sees it. */
export async function callSocialRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
  owner?: SocialViewer,
): Promise<T> {
  return parseSocialPayload(schema, await callSocialRpcRaw(fn, args, owner));
}

export function readSocial<T>(read: SocialRead<T>, owner?: SocialOwner): Promise<T> {
  return callSocialRpc(read.fn, read.args, read.schema, owner);
}

export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const voidResult = z.null().or(z.undefined()).or(z.literal("")).transform(() => undefined);
