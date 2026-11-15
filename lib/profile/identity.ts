type NamedProfile = { display_name: string | null; username: string } | null | undefined;

/**
 * True when a profile has no display name and its username is the one the app derives from the
 * account email (lib/auth/store.ts buildFallbackProfile), so showing it would leak the email prefix.
 * The profile then reads as a neutral "Profile" without an @handle.
 */
export function neutralProfileName(profile: NamedProfile, email: string | null): boolean {
  if (!profile || profile.display_name?.trim()) return false;
  const prefix = email?.split("@")[0];
  if (!prefix) return false;
  const derived = prefix
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20)
    .toLowerCase();
  const username = profile.username.trim().toLowerCase();
  return username === prefix.toLowerCase() || (derived.length > 0 && username === derived);
}
