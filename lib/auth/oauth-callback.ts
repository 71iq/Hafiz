const OAUTH_CALLBACK_PATH = /^(?:[a-z][a-z\d+.-]*:\/\/(?:[^/?#]*\/--\/)?)?\/?auth\/callback\/?(?:[?#]|$)/i;

export function isOAuthCallbackPath(path: string): boolean {
  return OAUTH_CALLBACK_PATH.test(path);
}

export function redirectOAuthCallbackPath(path: string, initial: boolean): string | null {
  if (!isOAuthCallbackPath(path)) return path;
  return initial ? "/(tabs)/home" : null;
}
