import type { ImagePickerAsset } from "expo-image-picker";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

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
  if (!contentType.startsWith("image/")) throw new Error("Avatar must be an image");

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
