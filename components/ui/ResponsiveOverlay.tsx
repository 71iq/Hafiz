import { useEffect, useMemo, useRef, type Ref } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type ViewStyle,
} from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { cn } from "@/lib/utils";

type OverlayPresentation = "sheet" | "dialog" | "fullscreen";
type DesktopPresentation = "panel" | "dialog";
type OverlayMaxHeight = number | `${number}%`;

type ResponsiveOverlayProps = {
  open: boolean;
  onClose: () => void;
  phonePresentation: OverlayPresentation;
  desktopPresentation?: DesktopPresentation;
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
  maxWidth?: number;
  maxHeight?: OverlayMaxHeight;
  surfaceColor?: string;
  children: React.ReactNode;
};

type OverlayHeaderProps = {
  title?: string;
  subtitle?: string;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  showHandle?: boolean;
  isRTL?: boolean;
};

type OverlayBodyProps = {
  children: React.ReactNode;
  scrollRef?: Ref<ScrollView>;
  scrollEnabled?: boolean;
  className?: string;
  contentContainerClassName?: string;
  contentContainerStyle?: ScrollViewProps["contentContainerStyle"];
};

type OverlayFooterProps = {
  children: React.ReactNode;
  isRTL?: boolean;
  className?: string;
};

let bodyScrollLockCount = 0;
let restoreBodyOverflow = "";
let restoreBodyTouchAction = "";
const overlayStack: string[] = [];

function lockBodyScroll() {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  if (bodyScrollLockCount === 0) {
    restoreBodyOverflow = document.body.style.overflow;
    restoreBodyTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  if (Platform.OS !== "web" || typeof document === "undefined" || bodyScrollLockCount === 0) return;
  bodyScrollLockCount -= 1;
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = restoreBodyOverflow;
    document.body.style.touchAction = restoreBodyTouchAction;
  }
}

function pushOverlay(id: string) {
  const existing = overlayStack.indexOf(id);
  if (existing >= 0) overlayStack.splice(existing, 1);
  overlayStack.push(id);
}

function popOverlay(id: string) {
  const existing = overlayStack.indexOf(id);
  if (existing >= 0) overlayStack.splice(existing, 1);
}

function isTopOverlay(id: string) {
  return overlayStack[overlayStack.length - 1] === id;
}

export function ResponsiveOverlay({
  open,
  onClose,
  phonePresentation,
  desktopPresentation = "panel",
  dismissOnBackdrop = true,
  dismissOnEscape = dismissOnBackdrop,
  maxWidth,
  maxHeight,
  surfaceColor,
  children,
}: ResponsiveOverlayProps) {
  const { width, height } = useWindowDimensions();
  const animation = useRef(new Animated.Value(0)).current;
  const overlayId = useRef(`overlay-${Math.random().toString(36).slice(2)}`).current;
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const activePresentation = isPhone ? phonePresentation : desktopPresentation === "dialog" ? "dialog" : "panel";

  useEffect(() => {
    if (!open) return;
    pushOverlay(overlayId);
    lockBodyScroll();
    return () => {
      popOverlay(overlayId);
      unlockBodyScroll();
    };
  }, [open, overlayId]);

  useEffect(() => {
    Animated.timing(animation, {
      toValue: open ? 1 : 0,
      duration: open ? 220 : 180,
      useNativeDriver: true,
    }).start();
  }, [animation, open]);

  useEffect(() => {
    if (!open || Platform.OS !== "web" || typeof window === "undefined" || !dismissOnEscape) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isTopOverlay(overlayId)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismissOnEscape, onClose, open, overlayId]);

  const computedMaxHeight = useMemo(() => {
    if (maxHeight != null) return maxHeight;
    if (activePresentation === "fullscreen") return "100%" as const;
    return Math.min(height - (isPhone ? 16 : 48), isPhone ? height * 0.92 : 720);
  }, [activePresentation, height, isPhone, maxHeight]);

  const contentWidth = useMemo(() => {
    if (activePresentation === "fullscreen") return width;
    if (activePresentation === "sheet") return width;
    const widthCap = maxWidth ?? (desktopPresentation === "dialog" ? 420 : 720);
    return Math.min(width - (isPhone ? 24 : 32), widthCap);
  }, [activePresentation, desktopPresentation, isPhone, maxWidth, width]);

  const contentStyle = useMemo<ViewStyle>(
    () => ({
      width: contentWidth,
      maxWidth: activePresentation === "sheet" ? "100%" : contentWidth,
      maxHeight: computedMaxHeight,
      ...(surfaceColor ? { backgroundColor: surfaceColor } : null),
      borderTopLeftRadius: activePresentation === "sheet" ? 28 : 28,
      borderTopRightRadius: activePresentation === "sheet" ? 28 : 28,
      borderBottomLeftRadius: activePresentation === "sheet" ? 0 : 28,
      borderBottomRightRadius: activePresentation === "sheet" ? 0 : 28,
      overflow: "hidden",
      transform:
        activePresentation === "sheet"
          ? [
              {
                translateY: animation.interpolate({
                  inputRange: [0, 1],
                  outputRange: [48, 0],
                }),
              },
            ]
          : [
              { scale: animation.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
            ],
      opacity: animation,
    }),
    [activePresentation, animation, computedMaxHeight, contentWidth, surfaceColor]
  );

  const overlayAlignment =
    activePresentation === "sheet" ? "items-stretch justify-end" : "items-center justify-center";

  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View className={cn("flex-1 px-0", overlayAlignment)} style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
        <Pressable
          className="absolute inset-0"
          disabled={!dismissOnBackdrop}
          onPress={dismissOnBackdrop ? onClose : undefined}
        />
        <Animated.View
          className={cn(
            "overflow-hidden bg-surface dark:bg-surface-dark shadow-2xl",
            activePresentation === "sheet" ? "rounded-t-[28px]" : "rounded-[28px]"
          )}
          style={contentStyle}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

export function ResponsiveSheet(props: Omit<ResponsiveOverlayProps, "phonePresentation" | "desktopPresentation">) {
  return <ResponsiveOverlay phonePresentation="sheet" desktopPresentation="panel" {...props} />;
}

export function ResponsiveModal(props: Omit<ResponsiveOverlayProps, "phonePresentation" | "desktopPresentation">) {
  return <ResponsiveOverlay phonePresentation="dialog" desktopPresentation="dialog" {...props} />;
}

export function OverlayHeader({
  title,
  subtitle,
  leading,
  actions,
  onClose,
  showHandle = false,
  isRTL = false,
}: OverlayHeaderProps) {
  const rowClassName = isRTL ? "flex-row-reverse" : "flex-row";

  return (
    <View className="px-5 pt-3 pb-4 border-b border-warm-200 dark:border-neutral-800">
      {showHandle ? (
        <View className="items-center pb-3">
          <View className="h-1.5 w-10 rounded-full bg-surface-high dark:bg-surface-dark-high" />
        </View>
      ) : null}
      <View className={cn("items-center justify-between gap-3", rowClassName)}>
        <View className={cn("min-w-0 flex-1 items-start gap-3", rowClassName, isRTL ? "items-end" : "items-start")}>
          {leading ? <View>{leading}</View> : null}
          {(title || subtitle) ? (
            <View className={cn("min-w-0 flex-1", isRTL ? "items-end" : "items-start")}>
              {title ? (
                <Text
                  className="text-charcoal dark:text-neutral-100"
                  style={{
                    fontFamily: "Manrope_700Bold",
                    fontSize: 18,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text
                  className="mt-1 text-warm-500 dark:text-neutral-400"
                  style={{
                    fontFamily: "Manrope_400Regular",
                    fontSize: 13,
                    lineHeight: 20,
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        <View className={cn("items-center gap-2", rowClassName)}>
          {actions}
          {onClose ? (
            <Pressable
              onPress={onClose}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
              style={{ cursor: Platform.OS === "web" ? "pointer" : undefined }}
            >
              <X size={18} color="#8B8178" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function OverlayBody({
  children,
  scrollRef,
  scrollEnabled = true,
  className,
  contentContainerClassName,
  contentContainerStyle,
}: OverlayBodyProps) {
  if (!scrollEnabled) {
    return <View className={cn("flex-1 min-h-0", className)}>{children}</View>;
  }

  return (
    <ScrollView
      ref={scrollRef}
      className={cn("flex-1 min-h-0", className)}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={contentContainerStyle}
      contentContainerClassName={contentContainerClassName}
    >
      {children}
    </ScrollView>
  );
}

export function OverlayFooter({ children, isRTL = false, className }: OverlayFooterProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={cn(
        "border-t border-warm-200 dark:border-neutral-800 px-5 pt-4",
        isRTL ? "items-end" : "items-start",
        className
      )}
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <View className={cn("w-full gap-3", isRTL ? "flex-row-reverse" : "flex-row")}>{children}</View>
    </View>
  );
}
