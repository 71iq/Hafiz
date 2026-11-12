import { Platform, Pressable, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Input, type InputProps } from "@/components/ui/Input";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import type { UIStrings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { formatLocalDateInput } from "@/lib/date";
import { toArabicNumber } from "@/lib/arabic";
import { textStartStyle } from "@/lib/ui/direction";

// The iOS punctuation pad has digits and "-". Elsewhere it falls back to a full
// keyboard, while the phone pad (inputmode="tel" on web) has both.
function dueDateKeyboardType(): InputProps["keyboardType"] {
  return Platform.OS === "ios" ? "numbers-and-punctuation" : "phone-pad";
}

type DueDateSheetProps = {
  visible: boolean;
  value: string;
  error: string | null;
  busy: boolean;
  isDark: boolean;
  isRTL: boolean;
  s: UIStrings;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
} & Pick<InputProps, "autoCapitalize" | "autoCorrect">;

export function DueDateSheet({
  visible,
  value,
  error,
  busy,
  isDark,
  isRTL,
  s,
  onChange,
  onClose,
  onSave,
  autoCapitalize,
  autoCorrect,
}: DueDateSheetProps) {
  return (
    <ResponsiveSheet open={visible} onClose={onClose} maxWidth={420} maxHeight={360} avoidKeyboard>
      <OverlayHeader title={s.cardSetDueDate} subtitle={s.cardDueDateHint} onClose={onClose} isRTL={isRTL} showHandle />
      <OverlayBody scrollEnabled={false} contentContainerClassName="px-5 py-5">
        <Input
          value={value}
          onChangeText={onChange}
          placeholder={s.cardDueDatePlaceholder}
          placeholderTextColor={isDark ? "#737373" : "#b9a085"}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          keyboardType={dueDateKeyboardType()}
          dir={isRTL ? "rtl" : "ltr"}
          className="min-h-12 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3 text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 16,
            ...textStartStyle(isRTL),
            writingDirection: "ltr",
          }}
        />
        {/* Quick choices fill the field, so a common date needs no typing. */}
        <View className="mt-3 flex-row flex-wrap gap-2" style={{ direction: isRTL ? "rtl" : "ltr" }}>
          {quickDueDates(s, isRTL).map((choice) => {
            const selected = choice.value === value;
            return (
              <Pressable
                key={choice.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onChange(choice.value)}
                disabled={busy}
                className={`rounded-full px-3 py-2 ${selected ? "bg-primary-accent/15 dark:bg-primary-bright/15" : "bg-surface-low dark:bg-surface-dark-low"}`}
              >
                <Text
                  className={selected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-200"}
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}
                >
                  {choice.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {error ? (
          <Text
            className="mt-3 text-red-600 dark:text-red-400"
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 13,
              ...textStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          >
            {error}
          </Text>
        ) : null}
      </OverlayBody>
      <OverlayFooter isRTL={isRTL}>
        <Button variant="outline" onPress={onClose} disabled={busy} className="flex-1">
          <Text
            className="text-charcoal dark:text-neutral-200"
            style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}
          >
            {s.flashcardsCancel}
          </Text>
        </Button>
        <Button onPress={onSave} disabled={busy} className="flex-1">
          <Text className="text-white" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
            {s.cardSaveDueDate}
          </Text>
        </Button>
      </OverlayFooter>
    </ResponsiveSheet>
  );
}

function quickDueDates(s: UIStrings, isRTL: boolean): { label: string; value: string }[] {
  const at = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return formatLocalDateInput(date);
  };
  const inMonth = new Date();
  inMonth.setMonth(inMonth.getMonth() + 1);
  return [
    { label: s.cardDueToday, value: at(0) },
    { label: s.cardDueTomorrow, value: at(1) },
    { label: interpolate(s.cardDueInDays, { n: isRTL ? toArabicNumber(3) : 3 }), value: at(3) },
    { label: s.cardDueInWeek, value: at(7) },
    { label: s.cardDueInMonth, value: formatLocalDateInput(inMonth) },
  ];
}
