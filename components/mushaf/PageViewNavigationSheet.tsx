import { Pressable, Text, View } from "react-native";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react-native";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { OverlayBody, OverlayHeader, ResponsiveSheet } from "@/components/ui/ResponsiveOverlay";
import { useStrings, interpolate } from "@/lib/i18n/useStrings";
import { useSettings, type PageScroll } from "@/lib/settings/context";
import { toArabicNumber } from "@/lib/arabic";

type Props = {
  visible: boolean;
  currentPage: number;
  onClose: () => void;
  onOpenGoTo: () => void;
};

export function PageViewNavigationSheet({
  visible,
  currentPage,
  onClose,
  onOpenGoTo,
}: Props) {
  const s = useStrings();
  const { isDark, isRTL, pageScroll, setPageScroll } = useSettings();
  const pageLabel = interpolate(s.pageN, { n: isRTL ? toArabicNumber(currentPage) : String(currentPage) });
  const RowChevron = isRTL ? ChevronLeft : ChevronRight;
  const mutedColor = isDark ? "#737373" : "#8B8178";

  return (
    <ResponsiveSheet
      open={visible}
      onClose={onClose}
      dismissOnBackdrop
      maxWidth={430}
      maxHeight="70%"
    >
      <OverlayHeader
        title={s.pageViewMenuTitle}
        subtitle={s.pageViewMenuSubtitle}
        onClose={onClose}
        showHandle
        isRTL={isRTL}
      />

      <OverlayBody contentContainerClassName="px-5 pt-4 pb-6">
        <View className="gap-5">
          <View>
            <Text
              className="mb-3 text-warm-400 dark:text-neutral-500"
              style={{
                fontFamily: "Manrope_700Bold",
                fontSize: 12,
                textAlign: isRTL ? "right" : "left",
                textTransform: "uppercase",
                writingDirection: isRTL ? "rtl" : "ltr",
              }}
            >
              {s.pageScrollLabel}
            </Text>
            <ToggleGroup<PageScroll>
              value={pageScroll}
              onValueChange={setPageScroll}
              items={[
                { value: "vertical", label: s.pageScrollVertical },
                { value: "horizontal", label: s.pageScrollHorizontal },
              ]}
              dir={isRTL ? "rtl" : "ltr"}
            />
          </View>

          <Pressable
            onPress={() => {
              onClose();
              onOpenGoTo();
            }}
            className="items-center justify-between gap-3 rounded-3xl bg-surface-low dark:bg-surface-dark-low px-4 py-4"
            style={({ pressed }) => ({
              direction: isRTL ? "rtl" : "ltr",
              flexDirection: "row",
              opacity: pressed ? 0.78 : 1,
              transform: [{ scale: pressed ? 0.99 : 1 }],
            })}
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-accent/10 dark:bg-primary-bright/15">
              <BookOpen size={18} color={isDark ? "#2dd4bf" : "#0d9488"} />
            </View>
            <View className="min-w-0 flex-1">
              <Text
                className="text-charcoal dark:text-neutral-200"
                style={{
                  fontFamily: "Manrope_700Bold",
                  fontSize: 14,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {s.pageViewGoTo}
              </Text>
              <Text
                className="mt-0.5 text-warm-400 dark:text-neutral-500"
                style={{
                  fontFamily: "Manrope_500Medium",
                  fontSize: 12,
                  textAlign: isRTL ? "right" : "left",
                  writingDirection: isRTL ? "rtl" : "ltr",
                }}
              >
                {pageLabel}
              </Text>
            </View>
            <RowChevron size={18} color={mutedColor} />
          </Pressable>
        </View>
      </OverlayBody>
    </ResponsiveSheet>
  );
}
