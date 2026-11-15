import { interpolate } from "@/lib/i18n/useStrings";
import type { UIStringKey, UIStrings } from "@/lib/i18n/strings";

/** Browser tab titles per route, in the UI language: "Mushaf | Hafiz", "المصحف | حافظ". */
const ROUTE_TITLE_KEYS: Record<string, UIStringKey> = {
  "/home": "tabHome",
  "/mushaf": "tabMushaf",
  "/progress": "tabProgress",
  "/settings": "tabSettings",
  "/halaqa": "tabHalaqa",
  "/leaderboard": "tabBoard",
  "/reflection-feed": "reflectionFeedTitle",
  "/reflection-journey": "reflectionJourneyTitle",
  "/about": "documentTitleAbout",
  "/credits": "documentTitleCredits",
  "/privacy": "documentTitlePrivacy",
  "/terms": "documentTitleTerms",
  "/profile": "authProfile",
};

export function documentTitleFor(pathname: string, s: UIStrings): string {
  if (pathname === "/dev/zayt") return `Zayt Preview | ${s.appName}`;
  const key = ROUTE_TITLE_KEYS[pathname];
  return key ? interpolate(s.documentTitleFormat, { page: s[key], app: s.appName }) : s.appName;
}
