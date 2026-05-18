import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

type QfEnv = "production" | "prelive";
type ErrorCode =
  | "bad_request"
  | "not_configured"
  | "not_authenticated"
  | "not_connected"
  | "needs_reauth"
  | "rate_limited"
  | "upstream";

type Config = {
  clientId: string;
  clientSecret: string;
  env: QfEnv;
  authBaseUrl: string;
  apiBaseUrl: string;
  allowedRedirectUris: string[];
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  encryptionKey: CryptoKey;
};

type ConnectionRow = {
  user_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  expires_at: string | null;
  status: "connected" | "needs_reauth" | "disconnected";
};

type OAuthStateRow = {
  state: string;
  user_id: string;
  code_verifier_ciphertext: string;
  redirect_uri: string;
  return_to: string | null;
  expires_at: string;
  consumed_at: string | null;
};

const AUTH_BASE_BY_ENV: Record<QfEnv, string> = {
  production: "https://oauth2.quran.foundation",
  prelive: "https://prelive-oauth2.quran.foundation",
};

const API_BASE_BY_ENV: Record<QfEnv, string> = {
  production: "https://apis.quran.foundation/auth",
  prelive: "https://apis-prelive.quran.foundation/auth",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonError("bad_request", "Use POST for qf-user requests.");
  }

  const config = await readConfig();
  if (!config.ok) return jsonError("not_configured", config.message);

  const userId = await requireUserId(req, config.value);
  if (!userId.ok) return jsonError("not_authenticated", userId.message);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_) {
    return jsonError("bad_request", "Request body must be valid JSON.");
  }

  try {
    switch (body.action) {
      case "begin-oauth":
        return await handleBeginOAuth(config.value, userId.value, body);
      case "complete-oauth":
        return await handleCompleteOAuth(config.value, userId.value, body);
      case "connect":
        return await handleConnect(config.value, userId.value, body);
      case "status":
        return await handleStatus(config.value, userId.value);
      case "disconnect":
        return await handleDisconnect(config.value, userId.value);
      case "list-bookmarks":
        return await handleListBookmarks(config.value, userId.value, body);
      case "upsert-bookmark":
        return await handleUpsertBookmark(config.value, userId.value, body);
      case "delete-bookmark":
        return await handleDeleteBookmark(config.value, userId.value, body);
      case "list-notes":
        return await handleListNotes(config.value, userId.value, body);
      case "create-note":
        return await handleCreateNote(config.value, userId.value, body);
      case "update-note":
        return await handleUpdateNote(config.value, userId.value, body);
      case "delete-note":
        return await handleDeleteNote(config.value, userId.value, body);
      default:
        return jsonError("bad_request", "Unsupported Quran Foundation user action.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "not_connected") return jsonError("not_connected", "Quran Foundation is not connected.");
    if (message === "needs_reauth") return jsonError("needs_reauth", "Reconnect Quran Foundation to continue syncing.");
    if (message === "rate_limited") return jsonError("rate_limited", "Quran Foundation rate limit reached.");
    if (message === "oauth_not_configured") return jsonError("not_configured", "Quran Foundation OAuth is not configured.");
    console.warn("[qf-user] request failed", message);
    return jsonError("upstream", "Quran Foundation sync is temporarily unavailable.");
  }
});

async function handleConnect(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const providerAccessToken = stringOrUndefined(body.providerAccessToken);
  if (!providerAccessToken) return jsonError("bad_request", "Quran Foundation access token is required.");

  const providerRefreshToken = stringOrUndefined(body.providerRefreshToken);
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  const expiresAt = stringOrUndefined(body.expiresAt) ?? expiresAtFromJwt(providerAccessToken);
  const connectedAt = await storeConnection(config, userId, {
    accessToken: providerAccessToken,
    refreshToken: providerRefreshToken,
    expiresAt,
    scopes,
  });

  return jsonSuccess({ ok: true, status: "connected", connectedAt });
}

async function handleBeginOAuth(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const redirectUri = stringOrUndefined(body.redirectUri);
  if (!redirectUri) return jsonError("bad_request", "Quran Foundation redirect URI is required.");
  if (!config.allowedRedirectUris.includes(redirectUri)) {
    return jsonError("not_configured", "Quran Foundation redirect URI is not configured.");
  }

  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const returnTo = stringOrUndefined(body.returnTo) ?? null;
  const service = serviceClient(config);
  const { error } = await service.from("qf_oauth_states").insert({
    state,
    user_id: userId,
    code_verifier_ciphertext: await encrypt(config.encryptionKey, codeVerifier),
    redirect_uri: redirectUri,
    return_to: returnTo,
    expires_at: expiresAt,
  });
  if (error) throw error;

  const authorizationUrl = new URL(`${config.authBaseUrl}/oauth2/authorize`);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("scope", "openid offline_access bookmark note");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return jsonSuccess({ ok: true, authorizationUrl: authorizationUrl.toString(), expiresAt });
}

async function handleCompleteOAuth(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const code = stringOrUndefined(body.code);
  const state = stringOrUndefined(body.state);
  const redirectUri = stringOrUndefined(body.redirectUri);
  if (!code || !state || !redirectUri) {
    return jsonError("bad_request", "Quran Foundation callback is missing required parameters.");
  }
  if (!config.allowedRedirectUris.includes(redirectUri)) {
    return jsonError("not_configured", "Quran Foundation redirect URI is not configured.");
  }

  const service = serviceClient(config);
  const { data, error } = await service
    .from("qf_oauth_states")
    .select("state, user_id, code_verifier_ciphertext, redirect_uri, return_to, expires_at, consumed_at")
    .eq("state", state)
    .maybeSingle();
  if (error) throw error;
  const oauthState = data as OAuthStateRow | null;
  if (!oauthState || oauthState.user_id !== userId || oauthState.redirect_uri !== redirectUri) {
    return jsonError("bad_request", "Quran Foundation connection state is invalid.");
  }
  if (oauthState.consumed_at) {
    return jsonError("bad_request", "Quran Foundation connection state was already used.");
  }
  if (Date.parse(oauthState.expires_at) <= Date.now()) {
    return jsonError("bad_request", "Quran Foundation connection state expired.");
  }

  const token = await exchangeAuthorizationCode(
    config,
    code,
    redirectUri,
    await decrypt(config.encryptionKey, oauthState.code_verifier_ciphertext)
  );
  const connectedAt = await storeConnection(config, userId, {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : ["openid", "offline_access", "bookmark", "note"],
    idToken: token.idToken,
  });

  const { error: stateError } = await service
    .from("qf_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state", state);
  if (stateError) throw stateError;

  return jsonSuccess({ ok: true, status: "connected", connectedAt });
}

async function handleStatus(config: Config, userId: string): Promise<Response> {
  const service = serviceClient(config);
  const { data, error } = await service
    .from("qf_user_connections")
    .select("status, env, connected_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return jsonSuccess({ ok: true, status: "disconnected" });
  return jsonSuccess({
    ok: true,
    status: data.status,
    env: data.env,
    connectedAt: data.connected_at,
    updatedAt: data.updated_at,
  });
}

async function handleDisconnect(config: Config, userId: string): Promise<Response> {
  const service = serviceClient(config);
  const { error } = await service.from("qf_user_connections").delete().eq("user_id", userId);
  if (error) throw error;
  return jsonSuccess({ ok: true, status: "disconnected" });
}

async function handleListBookmarks(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const params = new URLSearchParams();
  const after = stringOrUndefined(body.after);
  if (after) params.set("after", after);
  const result = await qfJson(config, userId, `/v1/bookmarks${params.size ? `?${params.toString()}` : ""}`);
  return jsonSuccess({
    ok: true,
    bookmarks: extractArray(result, "bookmarks").map(normalizeBookmark).filter(Boolean),
    nextCursor: nextCursor(result),
  });
}

async function handleUpsertBookmark(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const bookmark = body.bookmark as Record<string, unknown> | undefined;
  const surah = positiveInt(bookmark?.surah);
  const ayah = positiveInt(bookmark?.ayah);
  if (!surah || !ayah) return jsonError("bad_request", "Bookmark surah and ayah are required.");

  const result = await qfJson(config, userId, "/v1/bookmarks", {
    method: "POST",
    body: {
      type: "ayah",
      key: surah,
      verseNumber: ayah,
      mushafId: positiveInt(bookmark?.mushafId) ?? 1,
    },
  });
  const normalized = normalizeBookmark((result as any).data ?? (result as any).bookmark ?? result);
  if (!normalized) return jsonError("upstream", "Quran Foundation bookmark response was invalid.");
  return jsonSuccess({ ok: true, bookmark: normalized });
}

async function handleDeleteBookmark(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const qfBookmarkId = stringOrUndefined(body.qfBookmarkId);
  if (!qfBookmarkId) return jsonError("bad_request", "Quran Foundation bookmark id is required.");
  await qfJson(config, userId, `/v1/bookmarks/${encodeURIComponent(qfBookmarkId)}`, { method: "DELETE" });
  return jsonSuccess({ ok: true, deleted: true });
}

async function handleListNotes(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const params = new URLSearchParams();
  const cursor = stringOrUndefined(body.cursor);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(Math.min(50, positiveInt(body.limit) ?? 20)));
  params.set("sortBy", body.sortBy === "oldest" ? "oldest" : "newest");

  const result = await qfJson(config, userId, `/v1/notes?${params.toString()}`);
  return jsonSuccess({
    ok: true,
    notes: extractArray(result, "notes").map(normalizeNote).filter(Boolean),
    nextCursor: nextCursor(result),
  });
}

async function handleCreateNote(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const note = body.note as Record<string, unknown> | undefined;
  const noteBody = stringOrUndefined(note?.body);
  const ranges = Array.isArray(note?.ranges) ? note.ranges.filter((range): range is string => typeof range === "string") : [];
  if (!noteBody || noteBody.length < 6 || noteBody.length > 10000) {
    return jsonError("bad_request", "Quran Foundation notes must be 6 to 10000 characters.");
  }
  if (ranges.length === 0) return jsonError("bad_request", "At least one Quran range is required.");

  const result = await qfJson(config, userId, "/v1/notes", {
    method: "POST",
    body: { body: noteBody, saveToQR: false, ranges },
  });
  const normalized = normalizeNote((result as any).data ?? (result as any).note ?? result, ranges);
  if (!normalized) return jsonError("upstream", "Quran Foundation note response was invalid.");
  return jsonSuccess({ ok: true, note: normalized });
}

async function handleUpdateNote(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const qfNoteId = stringOrUndefined(body.qfNoteId);
  const noteBody = stringOrUndefined(body.body);
  if (!qfNoteId) return jsonError("bad_request", "Quran Foundation note id is required.");
  if (!noteBody || noteBody.length < 6 || noteBody.length > 10000) {
    return jsonError("bad_request", "Quran Foundation notes must be 6 to 10000 characters.");
  }

  const result = await qfJson(config, userId, `/v1/notes/${encodeURIComponent(qfNoteId)}`, {
    method: "PATCH",
    body: { body: noteBody, saveToQR: false },
  });
  const normalized = normalizeNote((result as any).data ?? (result as any).note ?? result);
  if (!normalized) {
    return jsonSuccess({
      ok: true,
      note: {
        id: qfNoteId,
        body: noteBody,
        ranges: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return jsonSuccess({ ok: true, note: normalized });
}

async function handleDeleteNote(config: Config, userId: string, body: Record<string, unknown>): Promise<Response> {
  const qfNoteId = stringOrUndefined(body.qfNoteId);
  if (!qfNoteId) return jsonError("bad_request", "Quran Foundation note id is required.");
  await qfJson(config, userId, `/v1/notes/${encodeURIComponent(qfNoteId)}`, { method: "DELETE" });
  return jsonSuccess({ ok: true, deleted: true });
}

async function qfJson(
  config: Config,
  userId: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
  didRetry = false
): Promise<unknown> {
  const token = await getAccessToken(config, userId, false);
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "x-auth-token": token,
      "x-client-id": config.clientId,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && !didRetry) {
    await getAccessToken(config, userId, true);
    return qfJson(config, userId, path, options, true);
  }
  if (response.status === 429) throw new Error("rate_limited");
  if (response.status === 204) return {};
  if (!response.ok) throw new Error(`QF user API failed: ${response.status}`);
  return response.json();
}

async function getAccessToken(config: Config, userId: string, forceRefresh: boolean): Promise<string> {
  const row = await getConnection(config, userId);
  if (!row || row.status === "disconnected") throw new Error("not_connected");
  if (row.status === "needs_reauth") throw new Error("needs_reauth");

  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : 0;
  if (!forceRefresh && expiresAt > Date.now() + 60_000) {
    return decrypt(config.encryptionKey, row.access_token_ciphertext);
  }

  if (!row.refresh_token_ciphertext) {
    await markNeedsReauth(config, userId);
    throw new Error("needs_reauth");
  }

  const refreshToken = await decrypt(config.encryptionKey, row.refresh_token_ciphertext);
  const refreshed = await refreshAccessToken(config, refreshToken).catch(async () => {
    await markNeedsReauth(config, userId);
    throw new Error("needs_reauth");
  });

  const service = serviceClient(config);
  const { error } = await service
    .from("qf_user_connections")
    .update({
      access_token_ciphertext: await encrypt(config.encryptionKey, refreshed.accessToken),
      refresh_token_ciphertext: refreshed.refreshToken
        ? await encrypt(config.encryptionKey, refreshed.refreshToken)
        : row.refresh_token_ciphertext,
      expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
      status: "connected",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw error;
  return refreshed.accessToken;
}

async function refreshAccessToken(
  config: Config,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }> {
  const basicAuth = btoa(`${config.clientId}:${config.clientSecret}`);
  const response = await fetch(`${config.authBaseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (response.status === 429) throw new Error("rate_limited");
  if (!response.ok) throw new Error(`QF refresh failed: ${response.status}`);
  const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token || typeof body.expires_in !== "number") {
    throw new Error("QF refresh response was invalid.");
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in };
}

async function exchangeAuthorizationCode(
  config: Config,
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scope?: string; idToken?: string }> {
  const basicAuth = btoa(`${config.clientId}:${config.clientSecret}`);
  const response = await fetch(`${config.authBaseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (response.status === 429) throw new Error("rate_limited");
  if (response.status === 401 || response.status === 403) {
    throw new Error("oauth_not_configured");
  }
  if (!response.ok) throw new Error(`QF authorization code exchange failed: ${response.status}`);

  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  };
  if (!body.access_token || typeof body.expires_in !== "number") {
    throw new Error("QF authorization code response was invalid.");
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    scope: body.scope,
    idToken: body.id_token,
  };
}

async function storeConnection(
  config: Config,
  userId: string,
  token: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string | null;
    scopes: string[];
    idToken?: string;
  }
): Promise<string> {
  const connectedAt = new Date().toISOString();
  const service = serviceClient(config);
  const { error } = await service.from("qf_user_connections").upsert(
    {
      user_id: userId,
      qf_subject: subjectFromJwt(token.accessToken) ?? (token.idToken ? subjectFromJwt(token.idToken) : null),
      access_token_ciphertext: await encrypt(config.encryptionKey, token.accessToken),
      refresh_token_ciphertext: token.refreshToken
        ? await encrypt(config.encryptionKey, token.refreshToken)
        : null,
      expires_at: token.expiresAt ?? expiresAtFromJwt(token.accessToken) ?? new Date(Date.now() + 50 * 60 * 1000).toISOString(),
      scope: token.scopes,
      env: config.env,
      status: "connected",
      connected_at: connectedAt,
      updated_at: connectedAt,
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
  return connectedAt;
}

async function getConnection(config: Config, userId: string): Promise<ConnectionRow | null> {
  const service = serviceClient(config);
  const { data, error } = await service
    .from("qf_user_connections")
    .select("user_id, access_token_ciphertext, refresh_token_ciphertext, expires_at, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as ConnectionRow | null;
}

async function markNeedsReauth(config: Config, userId: string): Promise<void> {
  const service = serviceClient(config);
  await service
    .from("qf_user_connections")
    .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

async function requireUserId(
  req: Request,
  config: Config
): Promise<{ ok: true; value: string } | { ok: false; message: string }> {
  const authorization = req.headers.get("Authorization");
  if (!authorization) return { ok: false, message: "Authentication is required." };
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false, message: "Authentication is required." };
  return { ok: true, value: data.user.id };
}

function serviceClient(config: Config) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readConfig(): Promise<{ ok: true; value: Config } | { ok: false; message: string }> {
  const clientId = Deno.env.get("QF_USER_CLIENT_ID")?.trim() ?? Deno.env.get("QF_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("QF_USER_CLIENT_SECRET")?.trim() ?? Deno.env.get("QF_CLIENT_SECRET")?.trim();
  const env = Deno.env.get("QF_USER_ENV")?.trim() ?? Deno.env.get("QF_ENV")?.trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const rawEncryptionKey = Deno.env.get("QF_TOKEN_ENCRYPTION_KEY")?.trim();
  const allowedRedirectUris = parseCsvEnv(Deno.env.get("QF_USER_REDIRECT_URIS"));
  if (!clientId || !clientSecret || !env || !supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !rawEncryptionKey) {
    return { ok: false, message: "Quran Foundation user sync is not configured." };
  }
  if (env !== "production" && env !== "prelive") {
    return { ok: false, message: "Quran Foundation environment is not configured." };
  }
  let encryptionKey: CryptoKey;
  try {
    encryptionKey = await importEncryptionKey(rawEncryptionKey);
  } catch (_) {
    return { ok: false, message: "Quran Foundation token encryption is not configured." };
  }
  return {
    ok: true,
    value: {
      clientId,
      clientSecret,
      env,
      authBaseUrl: AUTH_BASE_BY_ENV[env],
      apiBaseUrl: API_BASE_BY_ENV[env],
      allowedRedirectUris,
      supabaseUrl,
      supabaseAnonKey,
      supabaseServiceRoleKey,
      encryptionKey,
    },
  };
}

function parseCsvEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function importEncryptionKey(raw: string): Promise<CryptoKey> {
  const bytes = decodeBase64(raw);
  if (bytes.byteLength !== 32) {
    throw new Error("QF_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 value.");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(key: CryptoKey, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  return `v1:${encodeBase64(iv)}:${encodeBase64(ciphertext)}`;
}

async function decrypt(key: CryptoKey, value: string): Promise<string> {
  const [version, ivBase64, ciphertextBase64] = value.split(":");
  if (version !== "v1" || !ivBase64 || !ciphertextBase64) throw new Error("Encrypted token is invalid.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(ivBase64) },
    key,
    decodeBase64(ciphertextBase64)
  );
  return new TextDecoder().decode(plaintext);
}

function normalizeBookmark(value: unknown): {
  id: string;
  surah: number;
  ayah: number;
  type: "ayah";
  createdAt: string;
  isInDefaultCollection: boolean;
  collectionsCount: number;
} | null {
  const row = value as Record<string, unknown> | null;
  if (!row) return null;
  const id = stringOrUndefined(row.id);
  const type = row.type === "ayah" ? "ayah" : null;
  const surah = positiveInt(row.key ?? row.surah);
  const ayah = positiveInt(row.verseNumber ?? row.verse_number ?? row.ayah);
  if (!id || !type || !surah || !ayah) return null;
  return {
    id,
    surah,
    ayah,
    type,
    createdAt: stringOrUndefined(row.createdAt ?? row.created_at) ?? new Date().toISOString(),
    isInDefaultCollection: Boolean(row.isInDefaultCollection ?? row.is_in_default_collection),
    collectionsCount: positiveInt(row.collectionsCount ?? row.collections_count) ?? 0,
  };
}

function normalizeNote(value: unknown, fallbackRanges: string[] = []): {
  id: string;
  body: string;
  ranges: string[];
  createdAt: string;
  updatedAt: string;
} | null {
  const row = value as Record<string, unknown> | null;
  if (!row) return null;
  const id = stringOrUndefined(row.id);
  const body = stringOrUndefined(row.body ?? row.content);
  if (!id || !body) return null;
  const createdAt = stringOrUndefined(row.createdAt ?? row.created_at) ?? new Date().toISOString();
  return {
    id,
    body,
    ranges: normalizeRanges(row.ranges).length > 0 ? normalizeRanges(row.ranges) : fallbackRanges,
    createdAt,
    updatedAt: stringOrUndefined(row.updatedAt ?? row.updated_at) ?? createdAt,
  };
}

function normalizeRanges(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const range = stringOrUndefined(row.range);
    if (range) return [range];
    const start = stringOrUndefined(row.startVerseKey ?? row.start_verse_key);
    const end = stringOrUndefined(row.endVerseKey ?? row.end_verse_key);
    return start && end ? [`${start}-${end}`] : [];
  });
}

function extractArray(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  const row = value as Record<string, unknown> | null;
  const data = row?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>)[key])) {
    return (data as Record<string, unknown>)[key] as unknown[];
  }
  if (row && Array.isArray(row[key])) return row[key] as unknown[];
  return [];
}

function nextCursor(value: unknown): string | null {
  const row = value as Record<string, unknown> | null;
  const data = row?.data as Record<string, unknown> | undefined;
  const pagination = row?.pagination as Record<string, unknown> | undefined;
  return (
    stringOrUndefined(row?.nextCursor ?? row?.next_cursor ?? row?.cursor) ??
    stringOrUndefined(data?.nextCursor ?? data?.next_cursor ?? data?.cursor) ??
    stringOrUndefined(pagination?.nextCursor ?? pagination?.next_cursor) ??
    null
  );
}

function subjectFromJwt(token: string): string | null {
  return jwtPayload(token)?.sub ?? null;
}

function expiresAtFromJwt(token: string): string | null {
  const exp = jwtPayload(token)?.exp;
  return typeof exp === "number" ? new Date(exp * 1000).toISOString() : null;
}

function jwtPayload(token: string): Record<string, any> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(part)));
  } catch (_) {
    return null;
  }
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return encodeBase64Url(bytes);
}

async function pkceChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return encodeBase64Url(new Uint8Array(digest));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - value.length % 4) % 4)}`;
  return decodeBase64(padded);
}

function jsonSuccess(body: unknown): Response {
  return json(body, 200);
}

function jsonError(code: ErrorCode, message: string): Response {
  const statusByCode: Record<ErrorCode, number> = {
    bad_request: 400,
    not_configured: 503,
    not_authenticated: 401,
    not_connected: 409,
    needs_reauth: 401,
    rate_limited: 429,
    upstream: 502,
  };
  return json({ ok: false, code, message }, statusByCode[code]);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}
