import { z } from "zod";

// Sideloaded Android releases are published next to the website (scripts/release-android.sh).
// latest.json names the newest APK; the app compares its own version code against it.
const DOWNLOADS_ORIGIN = "https://hafizquran.app";
export const ANDROID_RELEASE_MANIFEST_URL = `${DOWNLOADS_ORIGIN}/downloads/android/latest.json`;
export const ANDROID_LATEST_APK_URL = `${DOWNLOADS_ORIGIN}/downloads/android/hafiz.apk`;

const androidReleaseSchema = z.object({
  versionCode: z.number().int().positive(),
  versionName: z.string().min(1),
  // Same-origin path only, so a tampered manifest cannot send users elsewhere.
  apk: z.string().regex(/^\/downloads\/android\/[A-Za-z0-9._-]+\.apk$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type AndroidRelease = z.infer<typeof androidReleaseSchema>;

export function parseAndroidRelease(input: unknown): AndroidRelease {
  return androidReleaseSchema.parse(input);
}

export function androidReleaseApkUrl(release: AndroidRelease): string {
  return `${DOWNLOADS_ORIGIN}${release.apk}`;
}

/** The newer release, or null when the installed build is current or its version is unknown. */
export function newerAndroidRelease(
  release: AndroidRelease,
  installedVersionCode: number | null,
): AndroidRelease | null {
  if (installedVersionCode === null || !Number.isInteger(installedVersionCode)) return null;
  return release.versionCode > installedVersionCode ? release : null;
}

export async function fetchAndroidRelease(fetchImpl: typeof fetch = fetch): Promise<AndroidRelease> {
  const response = await fetchImpl(ANDROID_RELEASE_MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Release manifest unavailable: HTTP ${response.status}`);
  return parseAndroidRelease(await response.json());
}
