import { Modal, View, Text, Pressable, ScrollView } from "react-native";
import { X, Check } from "lucide-react-native";
import { TRANSLATION_LANGUAGES } from "@/lib/translations/languages";
import { useSettings } from "@/lib/settings/context";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function TranslationLanguagePicker({ visible, onClose }: Props) {
  const { translationLanguage, setTranslationLanguage, isTranslationLoading, isDark } =
    useSettings();

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
        <Pressable className="flex-1" onPress={onClose} />

        {/* Sheet */}
        <View
          className="bg-white dark:bg-neutral-900 rounded-t-3xl"
          style={{ maxHeight: "70%" }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
            <Text className="text-lg font-bold text-warm-800 dark:text-neutral-100">
              Translation Language
            </Text>
            <Pressable
              onPress={onClose}
              className="w-8 h-8 rounded-full bg-warm-100 dark:bg-neutral-800 items-center justify-center"
            >
              <X size={16} color={isDark ? "#a3a3a3" : "#78716c"} />
            </Pressable>
          </View>

          {/* Language list */}
          <ScrollView className="px-5 pb-8">
            {TRANSLATION_LANGUAGES.map((lang) => {
              const isSelected = lang.code === translationLanguage;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => handleSelect(lang.code)}
                  className={`flex-row items-center justify-between py-3.5 border-b border-warm-50 dark:border-neutral-800 ${
                    isSelected ? "opacity-100" : "opacity-80"
                  }`}
                >
                  <View className="flex-1">
                    <Text
                      className={`text-base ${
                        isSelected
                          ? "font-semibold text-teal-700 dark:text-teal-400"
                          : "font-medium text-warm-700 dark:text-neutral-300"
                      }`}
                    >
                      {lang.nameEnglish}
                    </Text>
                    <Text
                      className="text-sm text-warm-400 dark:text-neutral-500 mt-0.5"
                      style={
                        lang.direction === "rtl"
                          ? { writingDirection: "rtl", textAlign: "right" }
                          : undefined
                      }
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
            {/* Bottom spacing */}
            <View className="h-8" />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
