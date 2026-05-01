import { Modal, View, Text, Pressable, ScrollView } from "react-native";
import { X, Check } from "lucide-react-native";
import { TRANSLATION_LANGUAGES } from "@/lib/translations/languages";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function TranslationLanguagePicker({ visible, onClose }: Props) {
  const { translationLanguage, setTranslationLanguage, isDark } =
    useSettings();
  const s = useStrings();

  const handleSelect = async (code: string) => {
    await setTranslationLanguage(code);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        {/* Backdrop */}
        <Pressable
          className="flex-1"
          style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
          onPress={onClose}
        />

        {/* Sheet */}
        <View
          className="bg-surface dark:bg-surface-dark-low rounded-t-4xl"
          style={{ maxHeight: "70%" }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-6 pt-3 pb-4">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 20 }}
            >
              {s.translationLanguagePickerTitle}
            </Text>
            <Pressable
              onPress={onClose}
              className="w-9 h-9 rounded-full bg-surface-high dark:bg-surface-dark-high items-center justify-center"
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.95 : 1 }],
              })}
            >
              <X size={16} color={isDark ? "#a3a3a3" : "#6e5a47"} />
            </Pressable>
          </View>

          {/* Language list — no borders, use spacing */}
          <ScrollView className="px-6 pb-8">
            <View className="gap-1">
              {TRANSLATION_LANGUAGES.map((lang) => {
                const isSelected = lang.code === translationLanguage;
                return (
                  <Pressable
                    key={lang.code}
                    onPress={() => handleSelect(lang.code)}
                    className="flex-row items-center justify-between py-3.5 px-3 rounded-2xl"
                    style={({ pressed }) => ({
                      backgroundColor: isSelected
                        ? (isDark ? "rgba(45,212,191,0.08)" : "rgba(13,148,136,0.06)")
                        : pressed
                          ? (isDark ? "rgba(45,212,191,0.04)" : "rgba(13,148,136,0.03)")
                          : "transparent",
                    })}
                  >
                    <View className="flex-1">
                      <Text
                        className={
                          isSelected
                            ? "text-primary-accent dark:text-primary-bright"
                            : "text-charcoal dark:text-neutral-300"
                        }
                        style={{
                          fontFamily: isSelected ? "Manrope_600SemiBold" : "Manrope_500Medium",
                          fontSize: 15,
                        }}
                      >
                        {lang.nameEnglish}
                      </Text>
                      <Text
                        className="text-warm-400 dark:text-neutral-500 mt-0.5"
                        style={{
                          fontFamily: "Manrope_400Regular",
                          fontSize: 13,
                          ...(lang.direction === "rtl"
                            ? { writingDirection: "rtl", textAlign: "right" }
                            : {}),
                        }}
                      >
                        {lang.nameNative}
                      </Text>
                    </View>
                    {isSelected && (
                      <Check size={20} color={isDark ? "#2dd4bf" : "#0d9488"} />
                    )}
                  </Pressable>
                );
              })}
              <View className="h-8" />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
