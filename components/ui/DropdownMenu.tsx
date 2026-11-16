import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Check, MoreHorizontal } from "lucide-react-native";
import { isTopOverlayLayer, registerOverlayLayer, useOverlayLayerId } from "@/components/ui/ResponsiveOverlay";
import { useSettings } from "@/lib/settings/context";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { cn } from "@/lib/utils";
import { textStartStyle } from "@/lib/ui/direction";

export type DropdownMenuItem = {
  key: string;
  label: string;
  icon?: (color: string) => ReactNode;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  checked?: boolean;
  group?: string;
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
  triggerIcon?: (color: string) => ReactNode;
};

const MENU_MARGIN = 12;
const ANCHOR_GAP = 8;
const TRIGGER_HIT_SLOP = 6;
const MENU_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Enter",
  " ",
  "Escape",
]);

type MenuPlacementInput = {
  anchor: AnchorRect;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  align: "start" | "end";
};

export function placeDropdownMenu({
  anchor,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  align,
}: MenuPlacementInput): { left: number; top: number } {
  const requestedLeft = align === "start" ? anchor.x : anchor.x + anchor.width - menuWidth;
  const left = Math.min(Math.max(requestedLeft, MENU_MARGIN), viewportWidth - menuWidth - MENU_MARGIN);
  const belowTop = anchor.y + anchor.height + ANCHOR_GAP;
  if (belowTop + menuHeight <= viewportHeight - MENU_MARGIN) return { left, top: belowTop };
  const aboveTop = anchor.y - menuHeight - ANCHOR_GAP;
  if (aboveTop >= MENU_MARGIN) return { left, top: aboveTop };
  return { left, top: Math.max(MENU_MARGIN, viewportHeight - MENU_MARGIN - menuHeight) };
}

function nextEnabledIndex(items: DropdownMenuItem[], from: number, step: 1 | -1): number {
  const count = items.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + step * offset) % count) + count) % count;
    if (!items[index]?.disabled) return index;
  }
  return -1;
}

export function DropdownMenu({
  items,
  triggerLabel,
  disabled = false,
  align = "end",
  width = 220,
  isRTL: explicitIsRTL,
  className,
  triggerIcon,
}: DropdownMenuProps) {
  const { height, width: viewportWidth } = useWindowDimensions();
  const triggerRef = useRef<View>(null);
  const itemRefs = useRef<(View | null)[]>([]);
  const activeIndex = useRef(-1);
  const layerId = useOverlayLayerId("menu");
  const { isDark, isRTL: settingsIsRTL, themeColors } = useSettings();
  const reduceMotion = useReducedMotionPreference();
  const isRTL = explicitIsRTL ?? settingsIsRTL;
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [menuHeight, setMenuHeight] = useState<number | null>(null);
  const isOpen = anchor !== null;

  const menuWidth = Math.min(width, viewportWidth - MENU_MARGIN * 2);
  const maxMenuHeight = height - MENU_MARGIN * 2;
  const iconColor = isDark ? "#d4d4d4" : "#6e5a47";
  const textColor = isDark ? "#f5f5f5" : "#2D2D2D";
  const mutedColor = isDark ? "#a3a3a3" : "#8B8178";
  const destructiveColor = isDark ? "#f87171" : "#dc2626";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(95,78,64,0.12)";
  const firstDestructive = items.findIndex((item) => item.destructive);

  const menuPosition = useMemo(() => {
    if (!anchor || menuHeight === null) return null;
    return placeDropdownMenu({
      anchor,
      menuWidth,
      menuHeight,
      viewportWidth,
      viewportHeight: height,
      align,
    });
  }, [align, anchor, height, menuHeight, menuWidth, viewportWidth]);

  const close = useCallback(() => {
    setAnchor(null);
    setMenuHeight(null);
    activeIndex.current = -1;
  }, []);

  const open = useCallback(() => {
    if (disabled || items.length === 0) return;
    triggerRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      setMenuHeight(null);
      setAnchor({ x, y, width: measuredWidth, height: measuredHeight });
    });
  }, [disabled, items.length]);

  const selectItem = useCallback(
    (item: DropdownMenuItem) => {
      if (item.disabled) return;
      close();
      requestAnimationFrame(item.onPress);
    },
    [close],
  );

  const focusItem = useCallback((index: number) => {
    if (index < 0) return;
    activeIndex.current = index;
    (itemRefs.current[index] as { focus?: () => void } | null)?.focus?.();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const unregister = registerOverlayLayer(layerId);
    if (Platform.OS !== "web" || typeof window === "undefined") return unregister;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlayLayer(layerId) || event.isComposing || !MENU_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const current = activeIndex.current;
      switch (event.key) {
        case "ArrowDown":
          focusItem(nextEnabledIndex(items, current, 1));
          break;
        case "ArrowUp":
          focusItem(nextEnabledIndex(items, current < 0 ? 0 : current, -1));
          break;
        case "Home":
          focusItem(nextEnabledIndex(items, -1, 1));
          break;
        case "End":
          focusItem(nextEnabledIndex(items, 0, -1));
          break;
        case "Enter":
        case " ": {
          const item = items[current];
          if (item) selectItem(item);
          break;
        }
        case "Escape":
          close();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      unregister();
    };
  }, [close, focusItem, isOpen, items, layerId, selectItem]);

  const placed = menuPosition !== null;
  useEffect(() => {
    if (!placed || Platform.OS !== "web") return;
    const frame = requestAnimationFrame(() => focusItem(nextEnabledIndex(items, -1, 1)));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);

  return (
    <>
      <View ref={triggerRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={triggerLabel}
          accessibilityState={{ disabled, expanded: isOpen }}
          disabled={disabled}
          onPress={open}
          hitSlop={TRIGGER_HIT_SLOP}
          className={cn(
            "h-8 w-8 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low",
            className,
          )}
          style={({ pressed }) => ({
            cursor: Platform.OS === "web" ? "pointer" : undefined,
            opacity: disabled ? 0.35 : pressed || anchor ? 0.72 : 1,
          })}
        >
          {triggerIcon ? triggerIcon(iconColor) : <MoreHorizontal size={17} color={iconColor} />}
        </Pressable>
      </View>

      <Modal
        key={reduceMotion ? "static" : "fade"}
        visible={isOpen}
        transparent
        animationType={reduceMotion ? "none" : "fade"}
        statusBarTranslucent
        onRequestClose={close}
      >
        <View className="flex-1">
          <Pressable className="absolute inset-0" onPress={close} />
          {anchor ? (
            <View
              accessibilityRole="menu"
              onLayout={(event) => {
                const measured = Math.ceil(event.nativeEvent.layout.height);
                setMenuHeight((current) => (current === measured ? current : measured));
              }}
              className="absolute overflow-hidden rounded-2xl border py-1.5 shadow-2xl"
              style={{
                backgroundColor: themeColors.surface,
                borderColor,
                left: menuPosition?.left ?? MENU_MARGIN,
                top: menuPosition?.top ?? 0,
                width: menuWidth,
                maxHeight: maxMenuHeight,
                opacity: menuPosition ? 1 : 0,
              }}
            >
              <ScrollView bounces={false} showsVerticalScrollIndicator={Platform.OS === "web"}>
                {items.map((item, index) => {
                  const color = item.disabled ? mutedColor : item.destructive ? destructiveColor : textColor;
                  const divider = index > 0 && (item.separatorBefore || index === firstDestructive);
                  const heading = item.group && item.group !== items[index - 1]?.group ? item.group : null;
                  const isRadio = item.checked !== undefined;
                  return (
                    <View key={item.key}>
                      {heading ? (
                        <Text
                          accessibilityRole="header"
                          className="px-3.5 pb-1 pt-2"
                          style={{
                            color: mutedColor,
                            fontFamily: "Manrope_600SemiBold",
                            fontSize: 11,
                            ...textStartStyle(isRTL),
                            writingDirection: isRTL ? "rtl" : "ltr",
                            borderTopWidth: divider ? 1 : 0,
                            borderTopColor: borderColor,
                          }}
                        >
                          {heading}
                        </Text>
                      ) : null}
                      <Pressable
                        ref={(node) => {
                          itemRefs.current[index] = node;
                        }}
                        accessibilityRole={isRadio ? ("menuitemradio" as "menuitem") : "menuitem"}
                        accessibilityLabel={item.label}
                        accessibilityState={
                          isRadio ? { disabled: !!item.disabled, checked: item.checked } : { disabled: !!item.disabled }
                        }
                        disabled={item.disabled}
                        onPress={() => selectItem(item)}
                        onFocus={() => {
                          activeIndex.current = index;
                        }}
                        className="min-h-11 items-center gap-3 px-3.5 py-2.5"
                        style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => ({
                          backgroundColor: pressed || focused ? themeColors.surfaceLow : "transparent",
                          borderTopWidth: divider && !heading ? 1 : 0,
                          borderTopColor: borderColor,
                          direction: "ltr",
                          flexDirection: isRTL ? "row-reverse" : "row",
                          opacity: item.disabled ? 0.45 : 1,
                        })}
                      >
                        {item.icon ? (
                          <View className="h-5 w-5 items-center justify-center">{item.icon(color)}</View>
                        ) : null}
                        <Text
                          className="min-w-0 flex-1"
                          style={{
                            color,
                            fontFamily: "Manrope_600SemiBold",
                            fontSize: 14,
                            lineHeight: 20,
                            ...textStartStyle(isRTL),
                            writingDirection: isRTL ? "rtl" : "ltr",
                          }}
                        >
                          {item.label}
                        </Text>
                        {isRadio ? (
                          <View className="h-5 w-5 items-center justify-center">
                            {item.checked ? <Check size={16} color={color} /> : null}
                          </View>
                        ) : null}
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}
