import { redirectOAuthCallbackPath } from "@/lib/auth/oauth-callback";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  return redirectOAuthCallbackPath(path, initial);
}
