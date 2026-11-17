export function isEmailAuthFlowsEnabled(): boolean {
  const value = process.env.EXPO_PUBLIC_EMAIL_AUTH_FLOWS_ENABLED ?? "true";
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

export type SocialAuthProvider = "google" | "apple" | "facebook";

/** Every social provider the app supports, in button order. */
const SOCIAL_AUTH_PROVIDERS: readonly SocialAuthProvider[] = ["google", "apple", "facebook"];

/**
 * Reads a comma-separated provider list such as "google, facebook". Unset enables every provider,
 * which keeps local development unchanged. An empty value or "none" enables none. Names are
 * case-insensitive and unknown names are ignored. The result keeps button order.
 */
export function parseSocialAuthProviders(value: string | undefined): readonly SocialAuthProvider[] {
  if (value === undefined) return SOCIAL_AUTH_PROVIDERS;
  const names = new Set(value.split(",").map((name) => name.trim().toLowerCase()));
  return SOCIAL_AUTH_PROVIDERS.filter((provider) => names.has(provider));
}

/** Social providers this build offers. Quran Foundation sign-in is governed by isQfLoginEnabled. */
export function getEnabledSocialProviders(): readonly SocialAuthProvider[] {
  // A static access, so Expo inlines the build value.
  return parseSocialAuthProviders(process.env.EXPO_PUBLIC_SOCIAL_AUTH_PROVIDERS);
}
