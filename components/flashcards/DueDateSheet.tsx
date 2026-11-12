import { Text } from "react-native";
import { Button } from "@/components/ui/Button";
import { Input, type InputProps } from "@/components/ui/Input";
import { OverlayBody, OverlayFooter, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import type { UIStrings } from "@/lib/i18n/strings";
import { textStartStyle } from "@/lib/ui/direction";

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
          keyboardType="numbers-and-punctuation"
          dir={isRTL ? "rtl" : "ltr"}
          className="min-h-12 rounded-2xl bg-surface-low dark:bg-surface-dark-low px-4 py-3 text-charcoal dark:text-neutral-100"
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 16,
            ...textStartStyle(isRTL),
            writingDirection: "ltr",
          }}
        />
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
