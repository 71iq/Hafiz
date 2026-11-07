import { useInlineOperationNotice, type InlineNoticeAttempt } from "@/components/ui/OperationNoticeProvider";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View, Text } from "react-native";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { DisclosureRow } from "@/components/ui/MirroredRow";
import { TRANSLATION_LANGUAGES } from "@/lib/translations/languages";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  OverlayBody,
  OverlayHeader,
  ResponsiveSheet,
} from "@/components/ui/ResponsiveOverlay";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function TranslationLanguagePicker({ visible, onClose }: Props) {
  const { translationLanguage, setTranslationLanguage, isDark, isRTL } =
    useSettings();
  const s = useStrings();
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const [pressedCode, setPressedCode] = useState<string | null>(null);
  const [selectingCode, setSelectingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createAttempt = useInlineOperationNotice();
  const nextGeneration = useRef(0);
  const [visibleGeneration, setVisibleGeneration] = useState(0);
  type SelectionLifetime = { id: number; active: boolean; busy: boolean; attempt: InlineNoticeAttempt | null };
  const lifetime = useRef<SelectionLifetime | null>(null);

  useEffect(() => {
    if (!visible) {
      setPressedCode(null);
      setSelectingCode(null);
      setError(null);
      return;
    }
    const current: SelectionLifetime = { id: ++nextGeneration.current, active: true, busy: false, attempt: null };
    lifetime.current = current;
    setVisibleGeneration(current.id);
    return () => {
      current.active = false;
      current.attempt?.retire();
      if (lifetime.current === current) lifetime.current = null;
    };
  }, [visible]);

  const handleClose = () => {
    const current = lifetime.current;
    if (!current?.active || current.id !== visibleGeneration) return;
    current.active = false;
    current.busy = false;
    current.attempt?.retire("normal");
    current.attempt = null;
    setPressedCode(null);
    setSelectingCode(null);
    setError(null);
    onClose();
  };

  const handleSelect = async (code: string) => {
    const current = lifetime.current;
    if (!visible || !current?.active || current.id !== visibleGeneration || current.busy) return;
    current.busy = true;
    current.attempt?.retire("normal");
    const attempt = createAttempt();
    current.attempt = attempt;
    const ownsUI = () => lifetime.current === current && current.active &&
      current.attempt === attempt && attempt.isCurrent();
    setSelectingCode(code);
    setError(null);
    try {
      await setTranslationLanguage(code);
      if (ownsUI()) handleClose();
      attempt.finish();
    } catch (e) {
      console.warn("[TranslationLanguagePicker] Failed to select translation:", e);
      const presentation = attempt.report(s.translationLoadFailed);
      if (presentation === "inline" && ownsUI()) setError(s.translationLoadFailed);
    } finally {
      if (ownsUI()) {
        current.busy = false;
        setSelectingCode(null);
      }
    }
  };

  return (
    <ResponsiveSheet
      open={visible}
      onClose={handleClose}
      dismissOnBackdrop
      maxWidth={520}
      maxHeight="80%"
    >
      <OverlayHeader
        title={s.translationLanguagePickerTitle}
        onClose={handleClose}
        showHandle
        isRTL={isRTL}
      />

      <OverlayBody contentContainerClassName="px-5 pt-2 pb-6">
        {error && (
          <Text
            className="mb-3 text-red-600 dark:text-red-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 13, textAlign: isRTL ? "right" : "left" }}
          >
            {error}
          </Text>
        )}
        <View className="gap-1">
          {TRANSLATION_LANGUAGES.map((lang) => {
            const isSelected = lang.code === translationLanguage;
            const isPressed = pressedCode === lang.code;
            const isSelecting = selectingCode === lang.code;

            return (
              <DisclosureRow
                key={lang.code}
                onPress={() => handleSelect(lang.code)}
                disabled={!!selectingCode}
                onPressIn={() => setPressedCode(lang.code)}
                onPressOut={() => setPressedCode(null)}
                className="items-center justify-between gap-3 rounded-2xl px-3 py-3.5"
                dir={isRTL ? "rtl" : "ltr"}
                style={{
                  backgroundColor: isSelected
                    ? isDark
                      ? "rgba(45,212,191,0.08)"
                      : "rgba(13,148,136,0.06)"
                    : isPressed
                      ? isDark
                        ? "rgba(45,212,191,0.04)"
                        : "rgba(13,148,136,0.03)"
                      : "transparent",
                  opacity: selectingCode && !isSelecting ? 0.45 : 1,
                }}
                trailing={
                  isSelecting ? (
                    <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
                  ) : isSelected ? (
                    <Check size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
                  ) : (
                    <DisclosureChevron size={18} color={isDark ? "#737373" : "#8B8178"} />
                  )
                }
              >
                <Text
                  className={
                    isSelected
                      ? "text-primary-accent dark:text-primary-bright"
                      : "text-charcoal dark:text-neutral-300"
                  }
                  style={{
                    fontFamily: isSelected
                      ? "Manrope_600SemiBold"
                      : "Manrope_500Medium",
                    fontSize: 15,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {lang.nameEnglish}
                </Text>
                <Text
                  className="mt-0.5 text-warm-400 dark:text-neutral-500"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 13,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {lang.nameNative}
                </Text>
              </DisclosureRow>
            );
          })}
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}
