import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type QfContentErrorCode = "bad_request" | "not_configured" | "rate_limited" | "upstream";

export type QfContentError = {
  ok: false;
  code: QfContentErrorCode;
  message: string;
};

export type QfAudio = {
  url: string;
  duration?: number;
  format?: string;
  segments?: unknown;
  reciterName?: string;
  recitationStyle?: string;
};

export type QfAudioResponse = {
  ok: true;
  recitationId: number;
  verseKey: string;
  audio: QfAudio;
  fetchedAt: string;
};

export type QfHadithGrade = {
  graded_by?: string;
  grade?: string;
};

export type QfHadithText = {
  lang?: string;
  chapterNumber?: string;
  chapterTitle?: string;
  body?: string;
  urn?: number;
  grades?: QfHadithGrade[];
};

export type QfHadith = {
  urn?: number;
  collection?: string;
  bookNumber?: string;
  chapterId?: string;
  hadithNumber?: string;
  name?: string;
  hadith?: QfHadithText[];
};

export type QfHadithResponse = {
  ok: true;
  verseKey: string;
  language: "en" | "ar";
  direction: "ltr" | "rtl" | string;
  page: number;
  limit: number;
  hasMore: boolean;
  hadiths: QfHadith[];
  fetchedAt: string;
};

export type QfContentResponse = QfAudioResponse | QfHadithResponse | QfContentError;

type AudioRequest = {
  action: "audio-ayah";
  surah: number;
  ayah: number;
  recitationId?: number;
};

type HadithRequest = {
  action: "hadith-ayah";
  surah: number;
  ayah: number;
  language: "en" | "ar";
  page?: number;
  limit?: number;
};

export const QF_DEFAULT_RECITATION_ID = parsePositiveInt(
  process.env.EXPO_PUBLIC_QF_DEFAULT_RECITATION_ID ?? process.env.QF_DEFAULT_RECITATION_ID
) ?? 7;

export async function fetchQfAyahAudio(
  surah: number,
  ayah: number,
  recitationId = QF_DEFAULT_RECITATION_ID
): Promise<QfAudioResponse | QfContentError> {
  return invokeQfContent<QfAudioResponse>({
    action: "audio-ayah",
    surah,
    ayah,
    recitationId,
  });
}

export async function fetchQfAyahHadiths(
  surah: number,
  ayah: number,
  language: "en" | "ar",
  page = 1,
  limit = 4
): Promise<QfHadithResponse | QfContentError> {
  return invokeQfContent<QfHadithResponse>({
    action: "hadith-ayah",
    surah,
    ayah,
    language,
    page,
    limit,
  });
}

async function invokeQfContent<T extends QfAudioResponse | QfHadithResponse>(
  body: AudioRequest | HadithRequest
): Promise<T | QfContentError> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      code: "not_configured",
      message: "Cloud content is not configured.",
    };
  }

  const { data, error } = await supabase.functions.invoke<QfContentResponse>("qf-content", {
    body,
  });

  if (data?.ok === true) return data as T;
  if (data?.ok === false) return data;

  if (error) {
    const errorBody = await readFunctionError(error);
    if (errorBody) return errorBody;
    return {
      ok: false,
      code: "upstream",
      message: "Quran Foundation content is unavailable.",
    };
  }

  return {
    ok: false,
    code: "upstream",
    message: "Quran Foundation content is unavailable.",
  };
}

async function readFunctionError(error: unknown): Promise<QfContentError | null> {
  const context = (error as { context?: unknown }).context;
  if (!context || typeof (context as Response).json !== "function") return null;
  try {
    const body = await (context as Response).json();
    if (
      body &&
      body.ok === false &&
      (body.code === "bad_request" ||
        body.code === "not_configured" ||
        body.code === "rate_limited" ||
        body.code === "upstream") &&
      typeof body.message === "string"
    ) {
      return body;
    }
  } catch (_) {}
  return null;
}

function parsePositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
