import { useEffect, useState } from "react";
import { ActivityIndicator, View, Text, Pressable } from "react-native";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
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
  const surfaceColor = isDark ? "#1C1917" : "#FFF8F1";
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const [pressedCode, setPressedCode] = useState<string | null>(null);
  const [selectingCode, setSelectingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) return;
    setPressedCode(null);
    setSelectingCode(null);
    setError(null);
  }, [visible]);

  const handleSelect = async (code: string) => {
    if (selectingCode) return;
    setSelectingCode(code);
    setError(null);
    try {
      await setTranslationLanguage(code);
      onClose();
    } catch (e) {
      console.warn("[TranslationLanguagePicker] Failed to select translation:", e);
      setError(s.translationLoadFailed);
    } finally {
      setSelectingCode(null);
    }
  };

  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      dismissOnBackdrop
      maxWidth={520}
      maxHeight="80%"
      surfaceColor={surfaceColor}
    >
      <OverlayHeader
        title={s.translationLanguagePickerTitle}
        onClose={onClose}
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
              <Pressable
                key={lang.code}
                onPress={() => handleSelect(lang.code)}
                disabled={!!selectingCode}
                onPressIn={() => setPressedCode(lang.code)}
                onPressOut={() => setPressedCode(null)}
                className="items-center justify-between gap-3 rounded-2xl px-3 py-3.5"
                style={{
                  direction: isRTL ? "rtl" : "ltr",
                  flexDirection: "row",
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
              >
                <View className="flex-1">
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
                </View>

                {isSelecting ? (
                  <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
                ) : isSelected ? (
                  <Check size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
                ) : (
                  <DisclosureChevron size={18} color={isDark ? "#737373" : "#8B8178"} />
                )}
              </Pressable>
            );
          })}
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}
