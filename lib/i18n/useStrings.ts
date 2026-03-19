import { useSettings } from "@/lib/settings/context";
import { strings } from "./strings";

export function useStrings() {
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
