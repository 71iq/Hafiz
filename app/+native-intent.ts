import { redirectOAuthCallbackPath } from "@/lib/auth/oauth-callback";
import { redirectWidgetTapPath } from "@/lib/widget/tap";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  const widget = redirectWidgetTapPath(path, initial);
  if (widget !== undefined) return widget;
  return redirectOAuthCallbackPath(path, initial);
}
