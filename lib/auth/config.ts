export function isEmailAuthFlowsEnabled(): boolean {
  const value = process.env.EXPO_PUBLIC_EMAIL_AUTH_FLOWS_ENABLED ?? "true";
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

export function isSocialAuthEnabled(): boolean {
  const value = process.env.EXPO_PUBLIC_SOCIAL_AUTH_ENABLED ?? "true";
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}
