// Matches hafiz://auth/callback, exp://host/--/auth/callback and /auth/callback,
// with or without a query string or fragment.
const OAUTH_CALLBACK_PATH = /^(?:[a-z][a-z\d+.-]*:\/\/(?:[^/?#]*\/--\/)?)?\/?auth\/callback\/?(?:[?#]|$)/i;
// Matches the Quran Foundation App Link https://hafizquran.app/auth/qf-callback and its path.
const QF_CALLBACK_PATH = /^(?:https:\/\/hafizquran\.app)?\/?auth\/qf-callback\/?(?:[?#]|$)/i;

export function isOAuthCallbackPath(path: string): boolean {
  return OAUTH_CALLBACK_PATH.test(path);
}

export function isQfCallbackPath(path: string): boolean {
  return QF_CALLBACK_PATH.test(path);
}

// The OAuth browser session hands hafiz://auth/callback back to the app. The in-flight
// openAuthSessionAsync call already reads its tokens, so a warm link must not also push a
// route on top of Login. A cold link has no flow left to own it, so open the home tab.
// The Quran Foundation App Link follows the same rule for warm links: Settings routes the
// session's code once. A cold one keeps its route, because the server still holds its state.
export function redirectOAuthCallbackPath(path: string, initial: boolean): string | null {
  if (isQfCallbackPath(path)) return initial ? path : null;
  if (!isOAuthCallbackPath(path)) return path;
  return initial ? "/(tabs)/home" : null;
}
