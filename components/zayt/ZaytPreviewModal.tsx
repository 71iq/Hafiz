import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sparkles, X } from "lucide-react-native";
import { ResponsiveOverlay } from "@/components/ui/ResponsiveOverlay";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings } from "@/lib/settings/context";
import { ZaytRivePreview } from "./ZaytRivePreview";

type ZaytPreviewModalProps = {
  visible: boolean;
  onClose: () => void;
};

export function ZaytPreviewModal({ visible, onClose }: ZaytPreviewModalProps) {
  const s = useStrings();
  const { isDark, isRTL } = useSettings();
  const [hasError, setHasError] = useState(false);
  const iconColor = isDark ? "#2dd4bf" : "#0d9488";
  const closeColor = isDark ? "#d4d4d4" : "#6e5a47";

  useEffect(() => {
    if (visible) setHasError(false);
  }, [visible]);

  const handleRiveError = useCallback(() => {
    setHasError(true);
  }, []);

  return (
    <ResponsiveOverlay
      open={visible}
      onClose={onClose}
      phonePresentation="sheet"
      desktopPresentation="dialog"
      maxWidth={480}
      maxHeight="90%"
    >
      <View
        className="bg-surface-low p-5 dark:bg-surface-dark-low"
        style={{ direction: isRTL ? "rtl" : "ltr" }}
      >
        <View className="items-center pb-4">
          <View className="h-1.5 w-10 rounded-full bg-surface-high dark:bg-surface-dark-high" />
        </View>

        <View className={`${isRTL ? "flex-row-reverse" : "flex-row"} items-center gap-3`}>
          <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
            <Sparkles size={19} color={iconColor} />
          </View>
          <View className="flex-1">
            <Text
              className="text-charcoal dark:text-neutral-100"
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 18,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.zaytPreviewTitle}
            </Text>
            <Text
              className="mt-1 text-warm-400 dark:text-neutral-500"
              style={{
                fontFamily: "Manrope_400Regular",
                fontSize: 13,
                lineHeight: 18,
                textAlign: isRTL ? "right" : "left",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.zaytPreviewSubtitle}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            className="h-10 w-10 items-center justify-center rounded-full bg-surface-high dark:bg-surface-dark-high"
            style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
          >
            <X size={18} color={closeColor} />
          </Pressable>
        </View>

        <View className="mt-5 h-80 overflow-hidden rounded-3xl bg-surface dark:bg-surface-dark">
          {visible ? (
            <ZaytRivePreview
              loadingLabel={s.zaytPreviewLoading}
              errorLabel={s.zaytPreviewError}
              isDark={isDark}
              onError={handleRiveError}
            />
          ) : null}
        </View>

        {hasError && (
          <Text
            className="mt-4 text-center text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18 }}
          >
            {s.zaytPreviewError}
          </Text>
        )}
      </View>
    </ResponsiveOverlay>
  );
}
