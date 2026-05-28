import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { MoreHorizontal } from "lucide-react-native";
import { useSettings } from "@/lib/settings/context";
import { cn } from "@/lib/utils";

export type DropdownMenuItem = {
  key: string;
  label: string;
  icon?: (color: string) => ReactNode;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

type AnchorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DropdownMenuProps = {
  items: DropdownMenuItem[];
  triggerLabel: string;
  disabled?: boolean;
  align?: "start" | "end";
  width?: number;
  isRTL?: boolean;
  className?: string;
};

const MENU_MARGIN = 12;
const ITEM_HEIGHT = 44;

export function DropdownMenu({
  items,
  triggerLabel,
  disabled = false,
  align = "end",
  width = 220,
  isRTL: explicitIsRTL,
  className,
}: DropdownMenuProps) {
  const { height, width: viewportWidth } = useWindowDimensions();
  const triggerRef = useRef<View>(null);
  const { isDark, isRTL: settingsIsRTL, themeColors } = useSettings();
  const isRTL = explicitIsRTL ?? settingsIsRTL;
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  const menuWidth = Math.min(width, viewportWidth - MENU_MARGIN * 2);
  const estimatedHeight = Math.min(items.length * ITEM_HEIGHT + 12, height - MENU_MARGIN * 2);
  const iconColor = isDark ? "#d4d4d4" : "#6e5a47";
  const textColor = isDark ? "#f5f5f5" : "#2D2D2D";
  const mutedColor = isDark ? "#a3a3a3" : "#8B8178";
  const destructiveColor = isDark ? "#f87171" : "#dc2626";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(95,78,64,0.12)";

  const menuPosition = useMemo(() => {
    if (!anchor) return null;
    const requestedLeft =
      align === "start"
        ? anchor.x
        : anchor.x + anchor.width - menuWidth;
    const left = Math.min(Math.max(requestedLeft, MENU_MARGIN), viewportWidth - menuWidth - MENU_MARGIN);
    const belowTop = anchor.y + anchor.height + 8;
    const aboveTop = anchor.y - estimatedHeight - 8;
    const top = belowTop + estimatedHeight <= height - MENU_MARGIN
      ? belowTop
      : Math.max(MENU_MARGIN, aboveTop);
    return { left, top };
  }, [align, anchor, estimatedHeight, height, menuWidth, viewportWidth]);

  const close = useCallback(() => {
    setAnchor(null);
  }, []);

  const open = useCallback(() => {
    if (disabled || items.length === 0) return;
    triggerRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      setAnchor({ x, y, width: measuredWidth, height: measuredHeight });
    });
  }, [disabled, items.length]);

  const selectItem = useCallback((item: DropdownMenuItem) => {
    if (item.disabled) return;
    setAnchor(null);
    requestAnimationFrame(item.onPress);
  }, []);

  return (
    <>
      <View ref={triggerRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={triggerLabel}
          disabled={disabled}
          onPress={open}
          className={cn("h-8 w-8 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low", className)}
          style={({ pressed }) => ({
            cursor: Platform.OS === "web" ? "pointer" : undefined,
            opacity: disabled ? 0.35 : pressed || anchor ? 0.72 : 1,
          })}
        >
          <MoreHorizontal size={17} color={iconColor} />
        </Pressable>
      </View>

      <Modal visible={anchor !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <View className="flex-1">
          <Pressable className="absolute inset-0" onPress={close} />
          {menuPosition ? (
            <View
              className="absolute overflow-hidden rounded-2xl border py-1.5 shadow-2xl"
              style={{
                backgroundColor: themeColors.surface,
                borderColor,
                left: menuPosition.left,
                top: menuPosition.top,
                width: menuWidth,
              }}
            >
              {items.map((item) => {
                const color = item.disabled
                  ? mutedColor
                  : item.destructive
                    ? destructiveColor
                    : textColor;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="menuitem"
                    accessibilityLabel={item.label}
                    disabled={item.disabled}
                    onPress={() => selectItem(item)}
                    className="min-h-11 items-center gap-3 px-3.5"
                    style={({ pressed }) => ({
                      backgroundColor: pressed ? themeColors.surfaceLow : "transparent",
                      direction: "ltr",
                      flexDirection: isRTL ? "row-reverse" : "row",
                      opacity: item.disabled ? 0.45 : 1,
                    })}
                  >
                    {item.icon ? (
                      <View className="h-5 w-5 items-center justify-center">
                        {item.icon(color)}
                      </View>
                    ) : null}
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
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}
