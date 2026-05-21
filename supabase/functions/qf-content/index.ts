type Action = "audio-ayah" | "audio-reciter-lookup" | "hadith-ayah";
type ErrorCode = "bad_request" | "not_configured" | "rate_limited" | "upstream";

type QfEnv = "production" | "prelive";

type TokenCache = {
  accessToken: string | null;
  expiresAt: number;
  inflight: Promise<string> | null;
};

type AudioFile = {
  verse_key?: string;
  url?: string;
  duration?: number;
  format?: string;
  segments?: unknown;
  reciter_name?: string;
  reciterName?: string;
  recitation_style?: string;
  recitationStyle?: string;
  recitation?: {
    reciter_name?: string;
    reciterName?: string;
    style?: string;
    recitation_style?: string;
  };
};

type HadithPayload = {
  hadiths?: unknown[];
  page?: number;
  limit?: number;
  has_more?: boolean;
  hasMore?: boolean;
  language?: string;
  direction?: string;
};

type RecitationResource = {
  id?: number;
  reciter_name?: string;
  style?: string;
  translated_name?: {
    name?: string;
    language_name?: string;
  };
};

type RecitationsPayload = {
  recitations?: unknown[];
};

class QfContentFailure extends Error {
  constructor(
    readonly code: Exclude<ErrorCode, "bad_request">,
    readonly action: Action,
    readonly phase: "token" | "api",
    readonly status?: number,
    readonly pathGroup?: string
  ) {
    super(`QF content ${phase} failed`);
  }
}

const AUTH_BASE_BY_ENV: Record<QfEnv, string> = {
  production: "https://oauth2.quran.foundation",
  prelive: "https://prelive-oauth2.quran.foundation",
};

const API_BASE_BY_ENV: Record<QfEnv, string> = {
  production: "https://apis.quran.foundation",
  prelive: "https://apis-prelive.quran.foundation",
};

const AYAH_COUNTS = [
  0, 7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99,
  128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30,
  73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45,
  60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52,
  52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17,
  19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7,
  3, 6, 3, 5, 4, 5, 6,
];

const DEFAULT_RECITATION_ID = 6;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const tokenCache: TokenCache = {
  accessToken: null,
  expiresAt: 0,
  inflight: null,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonError("bad_request", "Use POST for qf-content requests.");
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_) {
    return jsonError("bad_request", "Request body must be valid JSON.");
  }

  const action = body.action;
  if (action !== "audio-ayah" && action !== "audio-reciter-lookup" && action !== "hadith-ayah") {
    return jsonError("bad_request", "Unsupported Quran Foundation content action.");
  }

  const config = readConfig(action, body.recitationId);
  if (!config.ok) {
    return jsonError("not_configured", config.message);
  }

  try {
    if (action === "audio-reciter-lookup") {
      return await handleRecitations(config.value, body);
    }

    const parsedAyah = parseAyah(body.surah, body.ayah);
    if (!parsedAyah.ok) {
      return jsonError("bad_request", parsedAyah.message);
    }

    if (action === "audio-ayah") {
      return await handleAudio(config.value, parsedAyah.surah, parsedAyah.ayah);
    }
    return await handleHadith(config.value, parsedAyah.surah, parsedAyah.ayah, body);
  } catch (error) {
    if (error instanceof QfContentFailure) {
      logQfContentFailure(error);
      return jsonError(error.code, contentErrorMessage(error.code));
    }
    console.warn("[qf-content] upstream failed action=unknown phase=api status=unknown");
    return jsonError("upstream", "Quran Foundation content is temporarily unavailable.");
  }
});

async function handleAudio(config: Config, surah: number, ayah: number): Promise<Response> {
  const verseKey = `${surah}:${ayah}`;
  const path =
    `/content/api/v4/recitations/${config.recitationId}/by_ayah/${encodeURIComponent(verseKey)}` +
    "?fields=verse_key,url,format,segments,duration,id&page=1&per_page=1";
  const upstream = await getQfJson(config, path, "audio-ayah", "recitations");
  if (!upstream.ok) return upstream.response;

  const files = Array.isArray((upstream.data as { audio_files?: unknown }).audio_files)
    ? ((upstream.data as { audio_files: AudioFile[] }).audio_files)
    : [];
  const audioFile = files.find((file) => file.verse_key === verseKey) ?? files[0];
  if (!audioFile?.url) {
    return jsonError("upstream", "Audio is unavailable for this ayah.");
  }

  return jsonSuccess({
    ok: true,
    recitationId: config.recitationId,
    verseKey: audioFile.verse_key ?? verseKey,
    audio: {
      url: normalizeAudioUrl(audioFile.url),
      duration: numberOrUndefined(audioFile.duration),
      format: stringOrUndefined(audioFile.format),
      segments: audioFile.segments,
      reciterName:
        stringOrUndefined(audioFile.reciter_name) ??
        stringOrUndefined(audioFile.reciterName) ??
        stringOrUndefined(audioFile.recitation?.reciter_name) ??
        stringOrUndefined(audioFile.recitation?.reciterName),
      recitationStyle:
        stringOrUndefined(audioFile.recitation_style) ??
        stringOrUndefined(audioFile.recitationStyle) ??
        stringOrUndefined(audioFile.recitation?.recitation_style) ??
        stringOrUndefined(audioFile.recitation?.style),
    },
    fetchedAt: new Date().toISOString(),
  });
}

async function handleRecitations(config: Config, body: Record<string, unknown>): Promise<Response> {
  const language = normalizeLanguage(body.language);
  const params = new URLSearchParams({ language });
  const upstream = await getQfJson(
    config,
    `/content/api/v4/resources/recitations?${params.toString()}`,
    "audio-reciter-lookup",
    "recitations"
  );
  if (!upstream.ok) return upstream.response;

  const payload = upstream.data as RecitationsPayload;
  const reciters = Array.isArray(payload.recitations)
    ? payload.recitations.map(normalizeReciter).filter((reciter): reciter is NonNullable<ReturnType<typeof normalizeReciter>> => reciter !== null)
    : [];

  return jsonSuccess({
    ok: true,
    language,
    reciters,
    fetchedAt: new Date().toISOString(),
  });
}

async function handleHadith(
  config: Config,
  surah: number,
  ayah: number,
  body: Record<string, unknown>
): Promise<Response> {
  const language = body.language;
  if (language !== "en" && language !== "ar") {
    return jsonError("bad_request", "Hadith language must be en or ar.");
  }

  const page = parsePositiveInt(body.page ?? 1);
  if (page === null) return jsonError("bad_request", "Hadith page must be a positive integer.");

  const limit = parsePositiveInt(body.limit ?? 4);
  if (limit === null || limit > 5) {
    return jsonError("bad_request", "Hadith limit must be between 1 and 5.");
  }

  const verseKey = `${surah}:${ayah}`;
  const params = new URLSearchParams({
    language,
    page: String(page),
    limit: String(limit),
  });
  const upstream = await getQfJson(
    config,
    `/content/api/v4/hadith_references/by_ayah/${encodeURIComponent(verseKey)}/hadiths?${params.toString()}`,
    "hadith-ayah",
    "hadith_references"
  );
  if (!upstream.ok) return upstream.response;

  const payload = upstream.data as HadithPayload;
  return jsonSuccess({
    ok: true,
    verseKey,
    language,
    direction: stringOrUndefined(payload.direction) ?? (language === "ar" ? "rtl" : "ltr"),
    page: numberOrUndefined(payload.page) ?? page,
    limit: numberOrUndefined(payload.limit) ?? limit,
    hasMore: Boolean(payload.has_more ?? payload.hasMore),
    hadiths: Array.isArray(payload.hadiths) ? payload.hadiths : [],
    fetchedAt: new Date().toISOString(),
  });
}

type Config = {
  clientId: string;
  clientSecret: string;
  env: QfEnv;
  authBaseUrl: string;
  apiBaseUrl: string;
  recitationId: number;
};

function readConfig(action: Action, recitationIdInput: unknown): { ok: true; value: Config } | { ok: false; message: string } {
  const clientId = Deno.env.get("QF_CONTENT_CLIENT_ID")?.trim() ?? Deno.env.get("QF_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("QF_CONTENT_CLIENT_SECRET")?.trim() ?? Deno.env.get("QF_CLIENT_SECRET")?.trim();
  const envInput = Deno.env.get("QF_CONTENT_ENV")?.trim() ?? Deno.env.get("QF_ENV")?.trim();
  if (!clientId || !clientSecret || !envInput) {
    return { ok: false, message: "Quran Foundation credentials are not configured." };
  }
  if (envInput !== "production" && envInput !== "prelive") {
    return { ok: false, message: "Quran Foundation environment is not configured." };
  }

  const recitationId =
    action === "audio-ayah"
      ? parsePositiveInt(recitationIdInput ?? Deno.env.get("QF_DEFAULT_RECITATION_ID") ?? DEFAULT_RECITATION_ID)
      : 7;
  if (recitationId === null) {
    return { ok: false, message: "Quran Foundation recitation is not configured." };
  }

  return {
    ok: true,
    value: {
      clientId,
      clientSecret,
      env: envInput,
      authBaseUrl: AUTH_BASE_BY_ENV[envInput],
      apiBaseUrl: API_BASE_BY_ENV[envInput],
      recitationId,
    },
  };
}

async function getQfJson(
  config: Config,
  path: string,
  action: Action,
  pathGroup: string,
  didRetry = false
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const token = await getAccessToken(config, action);
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: {
      "x-auth-token": token,
      "x-client-id": config.clientId,
    },
  });

  if (response.status === 401 && !didRetry) {
    clearToken();
    return getQfJson(config, path, action, pathGroup, true);
  }

  if (response.status === 429) {
    logQfContentFailure(new QfContentFailure("rate_limited", action, "api", response.status, pathGroup));
    return { ok: false, response: jsonError("rate_limited", "Quran Foundation rate limit reached.") };
  }

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "not_configured" : "upstream";
    logQfContentFailure(new QfContentFailure(code, action, "api", response.status, pathGroup));
    return { ok: false, response: jsonError(code, contentErrorMessage(code)) };
  }

  return { ok: true, data: await response.json() };
}

async function getAccessToken(config: Config, action: Action): Promise<string> {
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }
  if (!tokenCache.inflight) {
    tokenCache.inflight = fetchToken(config, action).finally(() => {
      tokenCache.inflight = null;
    });
  }
  return tokenCache.inflight;
}

async function fetchToken(config: Config, action: Action): Promise<string> {
  const response = await fetchTokenWithClientAuth(config, {
    grant_type: "client_credentials",
    scope: "content",
  });

  if (response.status === 429) {
    throw new QfContentFailure("rate_limited", action, "token", response.status);
  }
  if (response.status === 401 || response.status === 403) {
    throw new QfContentFailure("not_configured", action, "token", response.status);
  }
  if (!response.ok) {
    throw new QfContentFailure("upstream", action, "token", response.status);
  }

  const token = await response.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token || typeof token.expires_in !== "number") {
    throw new QfContentFailure("upstream", action, "token");
  }
  tokenCache.accessToken = token.access_token;
  tokenCache.expiresAt = Date.now() + token.expires_in * 1000;
  return token.access_token;
}

async function fetchTokenWithClientAuth(config: Config, params: Record<string, string>): Promise<Response> {
  const basicAuth = btoa(`${config.clientId}:${config.clientSecret}`);
  const basicResponse = await fetch(`${config.authBaseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });

  if (![400, 401, 403].includes(basicResponse.status)) {
    return basicResponse;
  }

  return fetch(`${config.authBaseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      ...params,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
}

function clearToken() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt = 0;
}

function logQfContentFailure(error: QfContentFailure) {
  console.warn(
    `[qf-content] upstream failed action=${error.action} phase=${error.phase} status=${error.status ?? "unknown"} path=${error.pathGroup ?? "token"}`
  );
}

function contentErrorMessage(code: Exclude<ErrorCode, "bad_request">): string {
  if (code === "not_configured") return "Quran Foundation content is not configured.";
  if (code === "rate_limited") return "Quran Foundation rate limit reached.";
  return "Quran Foundation content is temporarily unavailable.";
}

function parseAyah(
  surahInput: unknown,
  ayahInput: unknown
): { ok: true; surah: number; ayah: number } | { ok: false; message: string } {
  const surah = parsePositiveInt(surahInput);
  const ayah = parsePositiveInt(ayahInput);
  if (surah === null || ayah === null) {
    return { ok: false, message: "Surah and ayah must be positive integers." };
  }
  if (surah < 1 || surah > 114) {
    return { ok: false, message: "Surah must be between 1 and 114." };
  }
  if (ayah < 1 || ayah > AYAH_COUNTS[surah]) {
    return { ok: false, message: "Ayah is outside the selected surah." };
  }
  return { ok: true, surah, ayah };
}

function parsePositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function normalizeAudioUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://verses.quran.foundation/${url.replace(/^\/+/, "")}`;
}

function normalizeLanguage(value: unknown): string {
  if (typeof value !== "string") return "en";
  const normalized = value.trim().toLowerCase();
  return /^[a-z]{2,3}(-[a-z]{2})?$/.test(normalized) ? normalized : "en";
}

function normalizeReciter(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as RecitationResource;
  const id = numberOrUndefined(row.id);
  if (!id || id < 1) return null;
  const translatedName = stringOrUndefined(row.translated_name?.name);
  const reciterName = stringOrUndefined(row.reciter_name) ?? translatedName;
  if (!reciterName) return null;
  return {
    id,
    reciterName,
    translatedName,
    translatedLanguageName: stringOrUndefined(row.translated_name?.language_name),
    style: stringOrUndefined(row.style) ?? "",
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function jsonSuccess(body: unknown): Response {
  return json(body, 200);
}

function jsonError(code: ErrorCode, message: string): Response {
  const statusByCode: Record<ErrorCode, number> = {
    bad_request: 400,
    not_configured: 503,
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
