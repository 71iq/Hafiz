// Matches hafiz://auth/callback, exp://host/--/auth/callback and /auth/callback,
// with or without a query string or fragment.
const OAUTH_CALLBACK_PATH = /^(?:[a-z][a-z\d+.-]*:\/\/(?:[^/?#]*\/--\/)?)?\/?auth\/callback\/?(?:[?#]|$)/i;

export function isOAuthCallbackPath(path: string): boolean {
  return OAUTH_CALLBACK_PATH.test(path);
}

// The OAuth browser session hands hafiz://auth/callback back to the app. The in-flight
// openAuthSessionAsync call already reads its tokens, so a warm link must not also push a
// route on top of Login. A cold link has no flow left to own it, so open the home tab.
export function redirectOAuthCallbackPath(path: string, initial: boolean): string | null {
  if (!isOAuthCallbackPath(path)) return path;
  return initial ? "/(tabs)/home" : null;
}
