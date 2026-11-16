import { Platform, Pressable, Text } from "react-native";
import { formatRelativeTime } from "@/lib/i18n/relative-time";

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function localizeDigits(value: string, language: string) {
  return language === "ar" ? value.replace(/[0-9]/g, (digit) => ARABIC_INDIC_DIGITS[Number(digit)]) : value;
}

export function formatCommentDateTime(dateStr: string, language: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  let text: string;
  try {
    text = date.toLocaleString(language === "ar" ? "ar" : "en", { dateStyle: "long", timeStyle: "short" });
  } catch {
    text = date.toLocaleString();
  }
  return localizeDigits(text, language);
}

export function formatLocalRelativeTime(dateStr: string, justNow: string, language: string): string {
  return localizeDigits(formatRelativeTime(dateStr, justNow, language), language);
}

export function ReflectionTime({
  relative,
  full,
  hint,
  revealed,
  onReveal,
  color,
}: {
  relative: string;
  full: string;
  hint: string;
  revealed: boolean;
  onReveal: (show: boolean) => void;
  color: string;
}) {
  return (
    <Pressable
      accessibilityRole="text"
      accessibilityLabel={full}
      accessibilityHint={hint}
      onLongPress={() => onReveal(!revealed)}
      onHoverIn={() => onReveal(true)}
      onHoverOut={() => onReveal(false)}
      onFocus={() => onReveal(true)}
      onBlur={() => onReveal(false)}
      focusable={Platform.OS === "web"}
      hitSlop={8}
    >
      <Text style={{ fontFamily: "Manrope_400Regular", fontSize: 11, color }}>{revealed ? full : relative}</Text>
    </Pressable>
  );
}
