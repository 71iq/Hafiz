import type { ImagePickerAsset } from "expo-image-picker";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const AVATAR_BUCKET = "avatars";
/** The avatars bucket's configured file_size_limit (supabase/schema.sql), checked before upload. */
export const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The avatars bucket's allowed_mime_types, plus the common image/jpg alias. */
const ALLOWED_AVATAR_TYPES = new Set(Object.keys(EXTENSION_BY_MIME));

export type AvatarProblem = "type" | "size" | "unreadable";

/** A stored photo's path inside the bucket, exactly as uploadProfileAvatar names it. */
const AVATAR_OBJECT_PATH = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[0-9]+\.(?:jpg|png|webp|gif)$/i;
let avatarBucketUrl: string | null = null;

/**
 * The profile photo address to load, or null when it is not a file in this project's avatars bucket.
 * profiles.avatar_url is text its owner can set to any address through the API, and the feed,
 * comments, the Board and profiles show it to other people. Loading it as given would send each
 * reader's device to a server the author chose.
 */
export function trustedAvatarUrl(url: string | null | undefined): string | null {
  if (!url || !isSupabaseConfigured()) return null;
  avatarBucketUrl ??= supabase.storage.from(AVATAR_BUCKET).getPublicUrl("").data.publicUrl;
  if (!url.startsWith(avatarBucketUrl)) return null;
  return AVATAR_OBJECT_PATH.test(url.slice(avatarBucketUrl.length)) ? url : null;
}

function avatarTypeOf(asset: Pick<ImagePickerAsset, "mimeType" | "fileName">): string | null {
  if (asset.mimeType) return asset.mimeType.toLowerCase();
  const extension = asset.fileName?.split(".").pop()?.toLowerCase();
  if (!extension) return null;
  return extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
}

/**
 * Checks a picked image before any upload: a supported type, decoded pixel dimensions and the bucket's
 * size cap. An unknown type or size is checked again on the bytes at upload time.
 */
export function validateAvatarAsset(
  asset: Pick<ImagePickerAsset, "mimeType" | "fileName" | "fileSize" | "width" | "height">,
): AvatarProblem | null {
  const type = avatarTypeOf(asset);
  if (type !== null && !ALLOWED_AVATAR_TYPES.has(type)) return "type";
  if (!(Number.isFinite(asset.width) && asset.width > 0 && Number.isFinite(asset.height) && asset.height > 0)) {
    return "unreadable";
  }
  if (typeof asset.fileSize === "number" && asset.fileSize > MAX_AVATAR_BYTES) return "size";
  return null;
}

function getAvatarExtension(asset: ImagePickerAsset, contentType: string): string {
  const fromMime = EXTENSION_BY_MIME[contentType.toLowerCase()];
  if (fromMime) return fromMime;
  const fromName = asset.fileName?.split(".").pop()?.toLowerCase();
  if (fromName === "jpeg") return "jpg";
  if (fromName && ["jpg", "png", "webp", "gif"].includes(fromName)) return fromName;
  return "jpg";
}

export async function uploadProfileAvatar(userId: string, asset: ImagePickerAsset): Promise<string> {
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured");
  if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
    throw new Error("Avatar image is too large");
  }

  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error("Could not read avatar image");

  const blob = await response.blob();
  if (blob.size > MAX_AVATAR_BYTES) throw new Error("Avatar image is too large");

  const contentType = asset.mimeType || blob.type || "image/jpeg";
  if (!ALLOWED_AVATAR_TYPES.has(contentType.toLowerCase())) throw new Error("Avatar must be a supported image");

  const extension = getAvatarExtension(asset, contentType);
  const path = `${userId}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    cacheControl: "31536000",
    contentType,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
