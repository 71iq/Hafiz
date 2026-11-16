import { useInlineOperationNotice, type InlineNoticeAttempt } from "@/components/ui/OperationNoticeProvider";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, TextInput, View, Text } from "react-native";
import { Check, ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react-native";
import { DisclosureRow } from "@/components/ui/MirroredRow";
import {
  DEFAULT_LANGUAGE,
  TRANSLATION_LANGUAGES,
  matchesTranslationQuery,
  type TranslationLanguage,
} from "@/lib/translations/languages";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import {
  OverlayBody,
  OverlayHeader,
  ResponsiveSheet,
} from "@/components/ui/ResponsiveOverlay";
import { inputTextStartStyle, textStartStyle } from "@/lib/ui/direction";
import { TranslationImportCancelled } from "@/lib/translations/import";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function TranslationLanguagePicker({ visible, onClose }: Props) {
  const { translationLanguage, setTranslationLanguage, isDark, isRTL, uiLanguage } =
    useSettings();
  const s = useStrings();
  const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;
  const [pressedCode, setPressedCode] = useState<string | null>(null);
  const [selectingCode, setSelectingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedCode, setFailedCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
      setFailedCode(null);
      setQuery("");
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
    setFailedCode(null);
    onClose();
  };

  const handleSelect = async (code: string) => {
    const current = lifetime.current;
    if (!visible || !current?.active || current.id !== visibleGeneration) return;
    if (current.busy && code !== DEFAULT_LANGUAGE) return;
    current.busy = true;
    current.attempt?.retire("normal");
    const attempt = createAttempt();
    current.attempt = attempt;
    const ownsUI = () => lifetime.current === current && current.active &&
      current.attempt === attempt && attempt.isCurrent();
    setSelectingCode(code);
    setError(null);
    setFailedCode(null);
    try {
      await setTranslationLanguage(code, { isCurrent: ownsUI });
      if (ownsUI()) handleClose();
      attempt.finish();
    } catch (e) {
      if (!(e instanceof TranslationImportCancelled))
        console.warn("[TranslationLanguagePicker] Failed to select translation:", e);
      const presentation = attempt.report(s.translationLoadFailed);
      if (presentation === "inline" && ownsUI()) {
        setError(s.translationLoadFailed);
        setFailedCode(code);
      }
    } finally {
      if (ownsUI()) {
        current.busy = false;
        setSelectingCode(null);
      }
    }
  };

  const activeImportedCode = translationLanguage === DEFAULT_LANGUAGE ? null : translationLanguage;
  const isOnDevice = (lang: TranslationLanguage) => lang.code === DEFAULT_LANGUAGE || lang.code === activeImportedCode;
  const matching = TRANSLATION_LANGUAGES.filter((lang) => matchesTranslationQuery(lang, query));
  const sections = [
    { key: "device", title: s.translationPickerOnDevice, languages: matching.filter(isOnDevice) },
    {
      key: "available",
      title: Platform.OS === "web" ? s.translationPickerAvailable : s.translationPickerAvailableBundled,
      languages: matching.filter((lang) => !isOnDevice(lang)),
    },
  ];
  const visibleCount = matching.length;

  const renderLanguage = (lang: TranslationLanguage) => {
    const isSelected = lang.code === translationLanguage;
    const isPressed = pressedCode === lang.code;
    const isSelecting = selectingCode === lang.code;
    const disabled = !!selectingCode && lang.code !== DEFAULT_LANGUAGE;
    const primaryName = uiLanguage === "ar" ? lang.nameArabic : lang.nameEnglish;

    return (
      <DisclosureRow
        key={lang.code}
        onPress={() => handleSelect(lang.code)}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{ checked: isSelected, busy: isSelecting, disabled }}
        aria-checked={isSelected}
        aria-busy={isSelecting}
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
          opacity: disabled && !isSelecting ? 0.45 : 1,
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
          className={isSelected ? "text-primary-accent dark:text-primary-bright" : "text-charcoal dark:text-neutral-300"}
          style={{
            fontFamily: isSelected ? "Manrope_600SemiBold" : "Manrope_500Medium",
            fontSize: 15,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {lang.sourceLabel ? `${primaryName} - ${lang.sourceLabel}` : primaryName}
        </Text>
        <Text
          className="mt-0.5 text-warm-500 dark:text-neutral-400"
          style={{
            fontFamily: "Manrope_400Regular",
            fontSize: 13,
            ...textStartStyle(isRTL),
            writingDirection: lang.direction,
          }}
        >
          {lang.nameNative}
        </Text>
      </DisclosureRow>
    );
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
        <View
          className="mb-3 h-12 items-center gap-2 rounded-2xl bg-surface-low px-3 dark:bg-surface-dark-low"
          style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}
        >
          <Search size={17} color={isDark ? "#a3a3a3" : "#8B8178"} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={s.translationSearchPlaceholder}
            accessibilityLabel={s.translationSearchPlaceholder}
            placeholderTextColor={isDark ? "#737373" : "#b9a085"}
            autoCapitalize="none"
            autoCorrect={false}
            className="h-12 min-w-0 flex-1 text-charcoal dark:text-neutral-100"
            style={{
              fontFamily: "Manrope_500Medium",
              fontSize: 15,
              ...inputTextStartStyle(isRTL),
              writingDirection: isRTL ? "rtl" : "ltr",
            }}
          />
        </View>
        {error && (
          <View
            className="mb-3 items-center gap-3"
            style={{ direction: isRTL ? "rtl" : "ltr", flexDirection: "row", flexWrap: "wrap" }}
          >
            <Text
              className="min-w-0 flex-1 text-red-600 dark:text-red-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 13, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
            >
              {error}
            </Text>
            {failedCode ? (
              <Pressable
                onPress={() => void handleSelect(failedCode)}
                accessibilityRole="button"
                accessibilityLabel={s.translationTryAgain}
                className="min-h-11 flex-row items-center gap-2 rounded-full bg-surface-low px-4 dark:bg-surface-dark-low"
                style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
              >
                <RotateCcw size={14} color={isDark ? "#2dd4bf" : "#0d9488"} />
                <Text className="text-primary-accent dark:text-primary-bright" style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                  {s.translationTryAgain}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
        <View accessibilityRole="radiogroup">
          {sections.map((section) =>
            section.languages.length > 0 ? (
              <View key={section.key} className="mb-3 gap-1">
                <Text
                  accessibilityRole="header"
                  className="mb-1 px-1 text-warm-500 dark:text-neutral-400"
                  style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, ...textStartStyle(isRTL), writingDirection: isRTL ? "rtl" : "ltr" }}
                >
                  {section.title}
                </Text>
                {section.languages.map(renderLanguage)}
              </View>
            ) : null,
          )}
          {visibleCount === 0 ? (
            <Text
              className="px-1 py-6 text-center text-warm-500 dark:text-neutral-400"
              style={{ fontFamily: "Manrope_500Medium", fontSize: 14 }}
            >
              {s.translationSearchEmpty}
            </Text>
          ) : null}
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}
