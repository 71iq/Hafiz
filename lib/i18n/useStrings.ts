import { useSettings } from "@/lib/settings/context";
import { strings, type UIStringKey, type UIStrings } from "./strings";

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
