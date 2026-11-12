import { useSettings, type UILanguage } from "@/lib/settings/context";
import { getStartupLanguage } from "./startup-language";
import { strings, type UIStringKey, type UIStrings } from "./strings";

/**
 * The language chosen in the app. Until the shared settings have loaded it falls back to the
 * startup guess (the web cache or the device direction), so a screen shown before the database
 * is ready still renders a language. Use it instead of getStartupLanguage on routes that can
 * open after startup, so an Arabic app on an English phone stays Arabic and vice versa.
 */
export function useAppLanguage(): UILanguage {
  const { uiLanguage, isLoaded } = useSettings();
  return isLoaded ? uiLanguage : getStartupLanguage();
}

export function useStrings(): UIStrings {
  const { uiLanguage } = useSettings();
  return strings[uiLanguage] ?? strings.en;
}

/** Helper for string interpolation: interpolate("Page {{n}}", { n: 5 }) → "Page 5" */
export function interpolate(
  template: string,
  vars: Record<string, string | number>
): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
    template
  );
}

export function stringByKey(s: UIStrings, key: string, fallback = ""): string {
  return key in s ? s[key as UIStringKey] : fallback;
}
