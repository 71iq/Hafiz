import { Platform } from "react-native";

// Native clients return through their own address. Android claims it as a verified App Link,
// so it must differ from the website's /auth/qf-callback: otherwise Chrome on a phone with
// Hafiz installed would hand the website's own connection to the app.
export const QF_APP_CALLBACK_PATH = "/auth/qf-app-callback";
export const QF_APP_REDIRECT_URI = `https://hafizquran.app${QF_APP_CALLBACK_PATH}`;

export function getQfOAuthRedirectUri(): string {
  if (Platform.OS !== "web") return QF_APP_REDIRECT_URI;
  return `${globalThis.location?.origin ?? "https://hafizquran.app"}/auth/qf-callback`;
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
