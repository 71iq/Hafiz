import { Platform } from "react-native";

export function getQfOAuthRedirectUri(): string {
  const origin = Platform.OS === "web" ? globalThis.location?.origin : undefined;
  return `${origin ?? "https://hafizquran.app"}/auth/qf-callback`;
}
