import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { connectQfFromSession, connectQfProviderTokens } from "@/lib/quran-foundation/user";
import { QF_OAUTH_PROVIDER, QF_OAUTH_SCOPES } from "@/lib/quran-foundation/user-types";

export type AppOAuthProvider = "google" | "apple" | "facebook" | typeof QF_OAUTH_PROVIDER;

type OAuthMode = "sign-in" | "link";

export async function startAppOAuth(
  provider: AppOAuthProvider,
  mode: OAuthMode = "sign-in"
): Promise<{ session: Session | null; qfConnected: boolean }> {
  const isQf = provider === QF_OAUTH_PROVIDER;
  const redirectTo = getOAuthRedirectTo();
  const options = {
    redirectTo,
    scopes: isQf ? QF_OAUTH_SCOPES : undefined,
    ...(Platform.OS !== "web" ? { skipBrowserRedirect: true } : {}),
  };

  if (Platform.OS === "web") {
    if (mode === "link") {
      const { error } = await (supabase.auth as any).linkIdentity({ provider, options });
      if (error) throw error;
      return { session: null, qfConnected: false };
    }
    const { error } = await supabase.auth.signInWithOAuth({ provider: provider as any, options });
    if (error) throw error;
    return { session: null, qfConnected: false };
  }

  const { data, error } =
    mode === "link"
      ? await (supabase.auth as any).linkIdentity({ provider, options })
      : await supabase.auth.signInWithOAuth({ provider: provider as any, options });
  if (error) throw error;
  if (!data?.url) return { session: null, qfConnected: false };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success" || !result.url) return { session: null, qfConnected: false };

  const params = parseOAuthParams(result.url);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  let session: Session | null = null;

  if (accessToken && refreshToken) {
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;
    session = sessionData.session;
  } else {
    const { data: sessionData } = await supabase.auth.getSession();
    session = sessionData.session;
  }

  let qfConnected = false;
  if (isQf) {
    const providerToken = params.get("provider_token");
    const providerRefreshToken = params.get("provider_refresh_token") ?? undefined;
    const connection = providerToken
      ? await connectQfProviderTokens(providerToken, providerRefreshToken)
      : await connectQfFromSession(session);
    qfConnected = connection.ok && "status" in connection && connection.status === "connected";
  }

  return { session, qfConnected };
}

export function getOAuthRedirectTo(): string | undefined {
  if (Platform.OS === "web") return globalThis.location?.origin;
  return Linking.createURL("auth/callback");
}

function parseOAuthParams(url: string): URLSearchParams {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const hashParams = new URLSearchParams(hash);
  hashParams.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  return params;
}
