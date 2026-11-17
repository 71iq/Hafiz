import { Platform } from "react-native";

export function getQfOAuthRedirectUri(): string {
  const origin = Platform.OS === "web" ? globalThis.location?.origin : undefined;
  return `${origin ?? "https://hafizquran.app"}/auth/qf-callback`;
}

const QF_CALLBACK_PARAMS = ["code", "state", "error", "error_description"] as const;
export type QfCallbackParams = Partial<Record<(typeof QF_CALLBACK_PARAMS)[number], string>>;

// Reads the provider's result from the App Link that closed the native auth session.
// Only these values travel to the in-app callback route.
export function readQfCallbackParams(url: string): QfCallbackParams {
  const query = url.split("#", 1)[0].split("?").slice(1).join("?");
  const params: QfCallbackParams = {};
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const key = decodeQueryPart(separator < 0 ? pair : pair.slice(0, separator));
    const value = separator < 0 ? "" : decodeQueryPart(pair.slice(separator + 1));
    if ((QF_CALLBACK_PARAMS as readonly string[]).includes(key) && !(key in params))
      params[key as keyof QfCallbackParams] = value;
  }
  return params;
}

function decodeQueryPart(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, " "));
  } catch {
    return part;
  }
}
