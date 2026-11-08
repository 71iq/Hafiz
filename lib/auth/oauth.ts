import { authCommands } from "@/lib/auth/commands";
import type { AuthCommandResult, AuthOwner } from "@/lib/auth/coordinator";
import { getAuthSessionIdentity } from "@/lib/auth/session-identity";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { AuthError, type Session, type SignInWithOAuthCredentials } from "@supabase/supabase-js";
import { supabase, prepareOwnedLink, readOwnedSession, restoreOwnedSession } from "@/lib/supabase";
import { isSocialAuthEnabled } from "@/lib/auth/config";
import { connectQfFromSession, connectQfProviderTokens } from "@/lib/quran-foundation/user";
import { captureQfRequestOwner, type QfSessionOwner } from "@/lib/quran-foundation/request-owner";
import { QF_OAUTH_PROVIDER, QF_OAUTH_SCOPES } from "@/lib/quran-foundation/user-types";

export type AppOAuthProvider = "google" | "apple" | "facebook" | typeof QF_OAUTH_PROVIDER;
type OAuthMode = "sign-in" | "link";
type StateReader = () => { user: Pick<Session["user"], "id"> | null; session: Session | null };
export type AppOAuthOutcome = { session: Session | null; qfConnected: boolean; qfOwner: QfSessionOwner | null };
export type AppOAuthHandle = {
  isCurrent: () => boolean;
  result: Promise<AuthCommandResult<AppOAuthOutcome>>;
};

// The handle exists before queued work starts and retains the accepted owner even
// when a later provider request rejects. UI cleanup owns a separate busy lease.
export function startAppOAuth(provider: AppOAuthProvider, mode: OAuthMode, getState: StateReader): AppOAuthHandle {
  let owner: AuthOwner | undefined;
  const isCurrent = () => owner?.isCurrent() ?? false;
  const empty = (): AppOAuthOutcome => ({ session: null, qfConnected: false, qfOwner: null });
  const obsolete = { kind: "obsolete" } as const;
  const reservation = authCommands.reserveReplacement<AppOAuthOutcome | typeof obsolete>(
    async (isIntentCurrent, origin) => {
      try {
        if (!origin.isCurrent()) return obsolete;
        const isQf = provider === QF_OAUTH_PROVIDER;
        if (!isQf && !isSocialAuthEnabled()) throw new Error("Social sign-in is temporarily unavailable.");
        const redirectTo = getOAuthRedirectTo();
        // The installed SDK types omit configured custom OAuth providers.
        const credentials: SignInWithOAuthCredentials = {
          provider: provider as SignInWithOAuthCredentials["provider"],
          options: {
            redirectTo,
            scopes: isQf ? QF_OAUTH_SCOPES : undefined,
            ...(Platform.OS !== "web" ? { skipBrowserRedirect: true } : {}),
          },
        };
        if (Platform.OS === "web") {
          const { error } =
            mode === "link"
              ? await supabase.auth.linkIdentity(credentials)
              : await supabase.auth.signInWithOAuth(credentials);
          if (!isCurrent()) return obsolete;
          if (error) throw error;
          return empty();
        }

        const starting = getState();
        const startingIdentity = getAuthSessionIdentity(starting.session);
        if (
          mode === "link" &&
          (startingIdentity.kind !== "identified" || starting.user?.id.toLowerCase() !== startingIdentity.userId)
        )
          throw new AuthError("A matching account is required to link a provider", 400, "oauth_link_session_missing");
        const expectedUserId =
          mode === "link" && startingIdentity.kind === "identified" ? startingIdentity.userId : undefined;
        const { data, error } =
          mode === "link"
            ? await prepareOwnedLink(origin, starting.session, credentials)
            : await supabase.auth.signInWithOAuth(credentials);
        if (error) throw error;
        if (!isCurrent()) return obsolete;
        if (!data?.url) return empty();

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (!isCurrent()) return obsolete;
        if (result.type !== "success" || !result.url) return empty();
        const params = parseOAuthParams(result.url);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (!!accessToken !== !!refreshToken)
          throw new AuthError("OAuth callback returned incomplete credentials", 400, "oauth_callback_invalid");
        let session: Session | null = null;
        if (accessToken && refreshToken) {
          const { data: restored, error: restoreError } = await restoreOwnedSession(
            origin,
            starting.session,
            { access_token: accessToken, refresh_token: refreshToken },
            isIntentCurrent,
            expectedUserId,
          );
          if (restoreError) throw restoreError;
          session = restored.session;
          const identity = getAuthSessionIdentity(session);
          if (
            !isIntentCurrent() ||
            identity.kind !== "identified" ||
            !authCommands.canCompleteRecovery(origin, JSON.stringify(identity))
          )
            return obsolete;
          owner = authCommands.captureOwner();
        } else if (mode === "link") {
          const { data: read, error: readError } = await readOwnedSession(origin, starting.session, isIntentCurrent);
          if (readError) throw readError;
          if (!isCurrent()) return obsolete;
          session = read.session;
        } else {
          // Native URL detection is disabled. A tokenless callback cannot establish
          // attribution to whichever global session happens to exist now.
          return empty();
        }
        if (!isCurrent()) return obsolete;
        let qfConnected = false;
        let qfOwner: QfSessionOwner | null = null;
        if (isQf) {
          const acceptedOwner = owner;
          if (!acceptedOwner) return obsolete;
          qfOwner = captureQfRequestOwner({
            getState,
            readSession: async () => {
              // The adapter's receipt may adopt its own logout before notification.
              // Intent activity survives that receipt; epoch checks stay in the owner.
              const result = await readOwnedSession(acceptedOwner, session, isIntentCurrent);
              // Preserve the SDK error before the source owner rejects the now-null session.
              if (result.error) throw result.error;
              return result;
            },
            sourceSession: session,
          });
          if (!qfOwner)
            throw new AuthError("Quran Foundation session is unavailable", 409, "oauth_session_unavailable");
          const providerToken = params.get("provider_token");
          const providerRefreshToken = params.get("provider_refresh_token") ?? undefined;
          const connection = providerToken
            ? await connectQfProviderTokens(providerToken, providerRefreshToken, qfOwner)
            : await connectQfFromSession(session, qfOwner);
          if (!isCurrent() || !qfOwner.isCurrent()) return obsolete;
          qfConnected = connection.ok && "status" in connection && connection.status === "connected";
        }
        return { session, qfConnected, qfOwner };
      } catch (error) {
        // A failed SDK renewal can publish its own verified logout. Its receipt
        // advances this ticket to null; an external logout or ABA cannot do so.
        if (
          Platform.OS !== "web" &&
          !isCurrent() &&
          isIntentCurrent() &&
          owner?.canSettleSameLifetime?.() &&
          getState().session === null
        )
          owner = authCommands.captureOwner();
        if (!isCurrent() || !isIntentCurrent()) return obsolete;
        throw error;
      }
    },
  );
  owner = reservation.owner;
  const result = reservation.result.then((result): AuthCommandResult<AppOAuthOutcome> => {
    if (result.status !== "completed" || "kind" in result.value || !owner?.isCurrent()) return { status: "superseded" };
    return { status: "completed", value: result.value, owner };
  });
  return { isCurrent, result };
}

function getOAuthRedirectTo(): string | undefined {
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
