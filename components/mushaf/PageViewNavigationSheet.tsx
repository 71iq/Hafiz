import { Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { AlignJustify, Check, MoveHorizontal } from "lucide-react-native";
import { useMemo } from "react";
import { useStrings } from "@/lib/i18n/useStrings";
import { useSettings, type PageScroll } from "@/lib/settings/context";

export type PageViewNavigationAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  visible: boolean;
  anchor: PageViewNavigationAnchor | null;
  onClose: () => void;
};

export function PageViewNavigationSheet({
  visible,
  anchor,
  onClose,
}: Props) {
  const s = useStrings();
  const { height, width: viewportWidth } = useWindowDimensions();
  const { isDark, isRTL, pageScroll, setPageScroll, themeColors } = useSettings();
  const menuWidth = Math.min(196, viewportWidth - 24);
  const menuHeight = 104;
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(95,78,64,0.12)";

  const menuPosition = useMemo(() => {
    if (!anchor) {
      return {
        left: Math.max(12, (viewportWidth - menuWidth) / 2),
        top: 72,
      };
    }
    const requestedLeft = isRTL ? anchor.x : anchor.x + anchor.width - menuWidth;
    const left = Math.min(Math.max(requestedLeft, 12), viewportWidth - menuWidth - 12);
    const belowTop = anchor.y + anchor.height + 8;
    const aboveTop = anchor.y - menuHeight - 8;
    const top = belowTop + menuHeight <= height - 12 ? belowTop : Math.max(12, aboveTop);
    return { left, top };
  }, [anchor, height, isRTL, menuWidth, viewportWidth]);

  const selectPageScroll = (value: PageScroll) => {
    setPageScroll(value);
    onClose();
  };

  const items: {
    value: PageScroll;
    label: string;
    icon: typeof AlignJustify;
  }[] = [
    { value: "vertical", label: s.pageScrollVertical, icon: AlignJustify },
    { value: "horizontal", label: s.pageScrollHorizontal, icon: MoveHorizontal },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable className="absolute inset-0" onPress={onClose} />
        <View
          className="absolute overflow-hidden rounded-2xl border py-1.5 shadow-2xl"
          style={{
            backgroundColor: themeColors.surface,
            borderColor,
            left: menuPosition.left,
            top: menuPosition.top,
            width: menuWidth,
            ...(Platform.OS === "web"
              ? ({ boxShadow: "0 18px 44px rgba(15, 23, 42, 0.16)" } as any)
              : null),
          }}
        >
          {items.map((item) => {
            const active = item.value === pageScroll;
            const Icon = item.icon;
            const color = active ? (isDark ? "#2dd4bf" : "#0d9488") : isDark ? "#d4d4d4" : "#2D2D2D";
            return (
              <Pressable
                key={item.value}
                accessibilityRole="menuitem"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                onPress={() => selectPageScroll(item.value)}
                className="min-h-11 items-center gap-3 px-3.5"
                style={({ pressed }) => ({
                  backgroundColor: active || pressed ? themeColors.surfaceLow : "transparent",
                  direction: "ltr",
                  flexDirection: isRTL ? "row-reverse" : "row",
                })}
              >
                <View className="h-5 w-5 items-center justify-center">
                  <Icon size={17} color={color} />
                </View>
                <Text
                  className="min-w-0 flex-1"
                  style={{
                    color,
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 13,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
                <View className="h-5 w-5 items-center justify-center">
                  {active ? <Check size={17} color={color} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}
