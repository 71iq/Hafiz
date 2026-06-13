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
  const menuWidth = Math.min(Math.max(anchor?.width ?? 132, 148), viewportWidth - 24);
  const menuHeight = 108;
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(95,78,64,0.12)";

  const menuPosition = useMemo(() => {
    if (!anchor) {
      return {
        left: Math.max(12, (viewportWidth - menuWidth) / 2),
        top: 72,
      };
    }
    const requestedLeft = isRTL ? anchor.x + anchor.width - menuWidth : anchor.x;
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
          accessibilityRole="menu"
          className="absolute overflow-hidden rounded-2xl border shadow-2xl"
          style={{
            backgroundColor: themeColors.surface,
            borderColor,
            left: menuPosition.left,
            top: menuPosition.top,
            width: menuWidth,
            padding: 6,
            ...(Platform.OS === "web"
              ? ({ boxShadow: "0 12px 28px rgba(15, 23, 42, 0.14)" } as any)
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
                style={({ pressed }) => ({
                  direction: "ltr",
                  display: "flex",
                  flexDirection: isRTL ? "row-reverse" : "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: 46,
                  paddingHorizontal: 10,
                  borderRadius: 12,
                  backgroundColor: active || pressed ? themeColors.surfaceLow : "transparent",
                })}
              >
                <View
                  className="h-5 w-5 items-center justify-center"
                  style={isRTL ? { marginLeft: 8 } : { marginRight: 8 }}
                >
                  <Icon size={17} color={color} />
                </View>
                <Text
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color,
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 13,
                    lineHeight: 18,
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
