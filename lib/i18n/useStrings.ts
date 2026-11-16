import { useSettings, type UILanguage } from "@/lib/settings/context";
import { getStartupLanguage } from "./startup-language";
import { strings, type UIStringKey, type UIStrings } from "./strings";

export function useAppLanguage(): UILanguage {
  const { uiLanguage, isLoaded } = useSettings();
  return isLoaded ? uiLanguage : getStartupLanguage();
}

export function useStrings(): UIStrings {
  const { uiLanguage } = useSettings();
  return strings[uiLanguage] ?? strings.en;
}

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
