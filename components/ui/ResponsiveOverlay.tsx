import { OperationNoticeOverlay } from "@/components/ui/OperationNoticeProvider";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type Ref,
  type RefObject,
} from "react";
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ScrollViewProps,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SIDEBAR_BREAKPOINT } from "@/lib/ui/viewport";
import { useUIDirection, type Direction, textStartStyle } from "@/lib/ui/direction";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
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
  phoneSheetHeight?: "content" | "max";
  surfaceColor?: string;
  dir?: Direction;
  avoidKeyboard?: boolean;
  initialFocusRef?: RefObject<{ focus?: () => void } | null>;
  restoreFocusRef?: RefObject<{ focus?: () => void } | null>;
  children: React.ReactNode;
};

type OverlayHeaderProps = {
  title?: string;
  titleNumberOfLines?: number;
  subtitle?: string;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  showHandle?: boolean;
  dir?: Direction;
  isRTL?: boolean;
};

type OverlayBodyProps = {
  children: React.ReactNode;
  scrollRef?: Ref<ScrollView>;
  scrollEnabled?: boolean;
  className?: string;
  contentContainerClassName?: string;
  contentContainerStyle?: ScrollViewProps["contentContainerStyle"];
  stickyHeaderIndices?: number[];
};

type OverlayFooterProps = {
  children: React.ReactNode;
  dir?: Direction;
  isRTL?: boolean;
  className?: string;
  stacked?: boolean;
};

export const OVERLAY_FOOTER_STACK_WIDTH = 360;
const KEYBOARD_FIELD_GAP = 16;

let bodyScrollLockCount = 0;
let restoreBodyOverflow = "";
let restoreBodyTouchAction = "";
let restoreBodyPaddingRight = "";
const overlayStack: string[] = [];

function lockBodyScroll() {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  if (bodyScrollLockCount === 0) {
    const body = document.body;
    const viewportWidth = document.documentElement.clientWidth;
    const scrollbarWidth =
      typeof window === "undefined" || viewportWidth <= 0 ? 0 : Math.max(0, window.innerWidth - viewportWidth);
    restoreBodyOverflow = body.style.overflow;
    restoreBodyTouchAction = body.style.touchAction;
    restoreBodyPaddingRight = body.style.paddingRight;
    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  if (Platform.OS !== "web" || typeof document === "undefined" || bodyScrollLockCount === 0) return;
  bodyScrollLockCount -= 1;
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = restoreBodyOverflow;
    document.body.style.touchAction = restoreBodyTouchAction;
    if (restoreBodyPaddingRight) document.body.style.paddingRight = restoreBodyPaddingRight;
    else document.body.style.removeProperty("padding-right");
  }
}

export function registerOverlayLayer(id: string): () => void {
  const existing = overlayStack.indexOf(id);
  if (existing >= 0) overlayStack.splice(existing, 1);
  overlayStack.push(id);
  return () => {
    const index = overlayStack.indexOf(id);
    if (index >= 0) overlayStack.splice(index, 1);
  };
}

export function isTopOverlayLayer(id: string): boolean {
  return overlayStack[overlayStack.length - 1] === id;
}

export function hasOpenOverlay(): boolean {
  return overlayStack.length > 0;
}

function createOverlayId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

export function useOverlayLayerId(prefix = "overlay"): string {
  return useRef(createOverlayId(prefix)).current;
}

type OverlayChrome = { titleRef: MutableRefObject<unknown> };
const OverlayChromeContext = createContext<OverlayChrome | null>(null);

function asHTMLElement(node: unknown): HTMLElement | null {
  return typeof HTMLElement !== "undefined" && node instanceof HTMLElement ? node : null;
}

function focusWebElement(node: unknown): boolean {
  const element = asHTMLElement(node);
  if (!element) return false;
  if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

function useWebKeyboardInset(enabled: boolean) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!enabled || Platform.OS !== "web" || typeof window === "undefined" || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setInset(0);
    };
  }, [enabled]);
  return inset;
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
  phoneSheetHeight = "content",
  surfaceColor,
  dir: explicitDir,
  avoidKeyboard = true,
  initialFocusRef,
  restoreFocusRef,
  children,
}: ResponsiveOverlayProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { themeSurface } = useSettings();
  const dir = useUIDirection(explicitDir);
  const reduceMotion = useReducedMotionPreference();
  const animation = useRef(new Animated.Value(0)).current;
  const overlayId = useOverlayLayerId();
  const contentRef = useRef<View>(null);
  const titleRef = useRef<unknown>(null);
  const chrome = useMemo<OverlayChrome>(() => ({ titleRef }), []);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const isPhone = width < SIDEBAR_BREAKPOINT;
  const activePresentation = isPhone ? phonePresentation : desktopPresentation === "dialog" ? "dialog" : "panel";
  const resolvedSurfaceColor = surfaceColor ?? themeSurface;

  useEffect(() => {
    if (!open) return;
    const unregister = registerOverlayLayer(overlayId);
    lockBodyScroll();
    return () => {
      unregister();
      unlockBodyScroll();
    };
  }, [open, overlayId]);

  useEffect(() => {
    if (reduceMotion) {
      animation.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(animation, {
      toValue: open ? 1 : 0,
      duration: open ? 220 : 180,
      useNativeDriver: true,
    }).start();
  }, [animation, open, reduceMotion]);

  useEffect(() => {
    if (!open || Platform.OS !== "web" || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !isTopOverlayLayer(overlayId)) return;
      event.preventDefault();
      event.stopPropagation();
      if (dismissOnEscape) latestClose.current();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [dismissOnEscape, open, overlayId]);

  useEffect(() => {
    if (!open) return;
    const activeElement = Platform.OS === "web" && typeof document !== "undefined" ? document.activeElement : null;
    const focusTimer = requestAnimationFrame(() => {
      if (initialFocusRef?.current?.focus) {
        initialFocusRef.current.focus();
        return;
      }
      if (Platform.OS === "web" && !focusWebElement(titleRef.current)) focusWebElement(contentRef.current);
    });
    return () => {
      cancelAnimationFrame(focusTimer);
      const restoreTarget = restoreFocusRef?.current;
      if (restoreTarget?.focus) {
        requestAnimationFrame(() => restoreTarget.focus?.());
        return;
      }
      if (Platform.OS === "web" && activeElement instanceof HTMLElement) {
        requestAnimationFrame(() => activeElement.focus());
      }
    };
  }, [initialFocusRef, open, restoreFocusRef]);

  const androidAvoidsKeyboard = Platform.OS === "android" && avoidKeyboard && open;
  const [androidKeyboardInset, setAndroidKeyboardInset] = useState(0);
  const containerHeightRef = useRef(0);
  useEffect(() => {
    if (!androidAvoidsKeyboard) return;
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      const { height: keyboardHeight, screenY } = event.endCoordinates;
      const overlap = containerHeightRef.current > 0 ? containerHeightRef.current - screenY : keyboardHeight;
      setAndroidKeyboardInset(Math.max(0, overlap));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setAndroidKeyboardInset(0));
    return () => {
      show.remove();
      hide.remove();
      setAndroidKeyboardInset(0);
    };
  }, [androidAvoidsKeyboard]);

  const webKeyboardInset = useWebKeyboardInset(Platform.OS === "web" && avoidKeyboard && open);
  useEffect(() => {
    if (webKeyboardInset <= 0 || typeof document === "undefined") return;
    const frame = requestAnimationFrame(() => {
      const focused = asHTMLElement(document.activeElement);
      const surface = asHTMLElement(contentRef.current);
      if (!focused || !surface?.contains(focused)) return;
      const tag = focused.tagName.toLowerCase();
      if (tag !== "input" && tag !== "textarea" && !focused.isContentEditable) return;
      focused.style.scrollMarginBottom = `${KEYBOARD_FIELD_GAP}px`;
      focused.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [webKeyboardInset]);
  const keyboardInset = androidAvoidsKeyboard ? androidKeyboardInset : webKeyboardInset;

  const computedMaxHeight = useMemo(() => {
    if (maxHeight != null) return maxHeight;
    if (activePresentation === "fullscreen") return "100%" as const;
    return Math.min(height - (isPhone ? insets.top + 8 : 48), isPhone ? height * 0.92 : 720);
  }, [activePresentation, height, insets.top, isPhone, maxHeight]);

  const contentWidth = useMemo(() => {
    if (activePresentation === "fullscreen") return width;
    if (activePresentation === "sheet") return width;
    const widthCap = maxWidth ?? (desktopPresentation === "dialog" ? 420 : 720);
    return Math.min(width - (isPhone ? 24 : 32), widthCap);
  }, [activePresentation, desktopPresentation, isPhone, maxWidth, width]);

  const isPhoneSheet = activePresentation === "sheet" && isPhone;
  const contentStyle = useMemo<ViewStyle>(
    () => ({
      width: contentWidth,
      maxWidth: activePresentation === "sheet" ? "100%" : contentWidth,
      maxHeight: computedMaxHeight,
      height: isPhoneSheet && phoneSheetHeight === "max" ? computedMaxHeight : undefined,
      ...(isPhoneSheet ? { flexShrink: 1, minHeight: 0 } : null),
      backgroundColor: resolvedSurfaceColor,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
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
          : [{ scale: animation.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
      opacity: animation,
    }),
    [
      activePresentation,
      animation,
      computedMaxHeight,
      contentWidth,
      isPhoneSheet,
      phoneSheetHeight,
      resolvedSurfaceColor,
    ],
  );

  const overlayAlignment = activePresentation === "sheet" ? "items-stretch justify-end" : "items-center justify-center";
  const Container = avoidKeyboard && Platform.OS === "ios" ? KeyboardAvoidingView : View;
  const handleRequestClose = () => {
    if (Platform.OS === "android" && Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    onClose();
  };

  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={handleRequestClose}>
      <Container
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className={cn("flex-1 px-0", overlayAlignment)}
        onLayout={(event) => {
          containerHeightRef.current = event.nativeEvent.layout.height;
        }}
        style={{
          backgroundColor: "rgba(0,0,0,0.55)",
          direction: dir,
          paddingTop: insets.top,
          ...(keyboardInset > 0 ? { paddingBottom: keyboardInset } : null),
        }}
      >
        <Pressable
          className="absolute inset-0"
          disabled={!dismissOnBackdrop}
          onPress={dismissOnBackdrop ? onClose : undefined}
        />
        <Animated.View
          ref={contentRef}
          className={cn(
            "overflow-hidden bg-surface dark:bg-surface-dark shadow-2xl",
            activePresentation === "sheet" ? "rounded-t-[28px]" : "rounded-[28px]",
          )}
          style={[contentStyle, { direction: dir }]}
        >
          <OverlayChromeContext.Provider value={chrome}>
            <ErrorBoundary section="overlay" variant="section" showHome={false}>
              {children}
            </ErrorBoundary>
          </OverlayChromeContext.Provider>
        </Animated.View>
      </Container>
      <OperationNoticeOverlay overlayId={overlayId} open={open} />
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
  titleNumberOfLines,
  subtitle,
  leading,
  actions,
  onClose,
  dir: explicitDir,
  isRTL: explicitIsRTL,
}: OverlayHeaderProps) {
  const dir = useUIDirection(explicitDir);
  const { effectiveTheme, isDark } = useSettings();
  const s = useStrings();
  const chrome = useContext(OverlayChromeContext);
  const isRTL = explicitIsRTL ?? dir === "rtl";
  const rowClassName = isRTL ? "flex-row-reverse" : "flex-row";
  const closeIconColor = isDark ? "#a3a3a3" : effectiveTheme === "white" ? "#71717A" : "#8B8178";
  const attachTitle = useCallback(
    (node: unknown) => {
      if (!chrome) return;
      if (node) chrome.titleRef.current = node;
      else if (chrome.titleRef.current) chrome.titleRef.current = null;
    },
    [chrome],
  );

  return (
    <View className="px-5 pt-3 pb-4 border-b border-warm-200 dark:border-neutral-800">
      <View className={cn("items-center justify-between gap-3", rowClassName)} style={{ direction: "ltr" }}>
        <View
          className={cn("min-w-0 flex-1 items-start gap-3", rowClassName, isRTL ? "items-end" : "items-start")}
          style={{ direction: "ltr" }}
        >
          {leading ? <View>{leading}</View> : null}
          {title || subtitle ? (
            <View className={cn("min-w-0 flex-1", isRTL ? "items-end" : "items-start")}>
              {title ? (
                <Text
                  ref={attachTitle as Ref<Text>}
                  accessibilityRole="header"
                  numberOfLines={titleNumberOfLines}
                  className="text-charcoal dark:text-neutral-100"
                  style={{
                    fontFamily: "Manrope_700Bold",
                    fontSize: 18,
                    ...textStartStyle(isRTL),
                    writingDirection: isRTL ? "rtl" : "ltr",
                    ...(Platform.OS === "web" ? { outlineStyle: "none" as never } : null),
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
                    ...textStartStyle(isRTL),
                    writingDirection: isRTL ? "rtl" : "ltr",
                  }}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        <View className={cn("items-center gap-2", rowClassName)} style={{ direction: "ltr" }}>
          {actions}
          {onClose ? (
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={s.genericClose}
              className="h-11 w-11 items-center justify-center rounded-full bg-surface-low dark:bg-surface-dark-low"
              style={{ cursor: Platform.OS === "web" ? "pointer" : undefined }}
            >
              <X size={18} color={closeIconColor} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const OVERLAY_BODY_FLEX = { flexGrow: 1, flexShrink: 1, flexBasis: "auto" } as const;

function assignRef<T>(target: Ref<T> | undefined, value: T | null) {
  if (typeof target === "function") target(value);
  else if (target && typeof target === "object") (target as MutableRefObject<T | null>).current = value;
}

export function OverlayBody({
  children,
  scrollRef,
  scrollEnabled = true,
  className,
  contentContainerClassName,
  contentContainerStyle,
  stickyHeaderIndices,
}: OverlayBodyProps) {
  const insets = useSafeAreaInsets();
  const ownScrollRef = useRef<ScrollView | null>(null);
  const attachScroll = useCallback(
    (node: ScrollView | null) => {
      ownScrollRef.current = node;
      assignRef(scrollRef, node);
    },
    [scrollRef],
  );

  useEffect(() => {
    if (!scrollEnabled || Platform.OS === "web") return;
    const subscription = Keyboard.addListener("keyboardDidShow", () => {
      const focused = TextInput.State.currentlyFocusedInput?.();
      const scroll = ownScrollRef.current;
      if (!focused || !scroll?.scrollResponderScrollNativeHandleToKeyboard) return;
      requestAnimationFrame(() => {
        try {
          scroll.scrollResponderScrollNativeHandleToKeyboard(focused, KEYBOARD_FIELD_GAP, true);
        } catch {
        }
      });
    });
    return () => subscription.remove();
  }, [scrollEnabled]);

  if (!scrollEnabled) {
    const hasContentContainer = contentContainerClassName != null || contentContainerStyle != null;
    return (
      <View className={cn("min-h-0", className)} style={OVERLAY_BODY_FLEX}>
        {hasContentContainer ? (
          <View className={cn("min-h-0", contentContainerClassName)} style={[OVERLAY_BODY_FLEX, contentContainerStyle]}>
            {children}
          </View>
        ) : (
          children
        )}
      </View>
    );
  }

  return (
    <ScrollView
      ref={attachScroll}
      className={cn("min-h-0", className)}
      style={OVERLAY_BODY_FLEX}
      showsVerticalScrollIndicator={Platform.OS === "web"}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={contentContainerStyle}
      contentContainerClassName={contentContainerClassName}
      stickyHeaderIndices={stickyHeaderIndices}
    >
      <ErrorBoundary section="overlay-body" variant="section" showHome={false}>
        {children}
      </ErrorBoundary>
      {insets.bottom > 0 ? <View style={{ height: insets.bottom }} /> : null}
    </ScrollView>
  );
}

type FooterLayout = { reportWrapped: () => void };
const OverlayFooterContext = createContext<FooterLayout | null>(null);

export function OverlayFooterLabel({ onLayout, style, ...props }: TextProps) {
  const footer = useContext(OverlayFooterContext);
  const lineHeight = 20;
  return (
    <Text
      {...props}
      style={[{ lineHeight, textAlign: "center" }, style]}
      onLayout={(event: LayoutChangeEvent) => {
        onLayout?.(event);
        if (event.nativeEvent.layout.height > lineHeight * 1.5) footer?.reportWrapped();
      }}
    />
  );
}

export function OverlayFooter({
  children,
  dir: explicitDir,
  isRTL: explicitIsRTL,
  className,
  stacked: forceStacked = false,
}: OverlayFooterProps) {
  const insets = useSafeAreaInsets();
  const dir = useUIDirection(explicitDir);
  const isRTL = explicitIsRTL ?? dir === "rtl";
  const [rowWidth, setRowWidth] = useState(0);
  const [wrapThreshold, setWrapThreshold] = useState(0);
  const rowWidthRef = useRef(0);
  const stackedRef = useRef(false);
  const pendingWrap = useRef(false);
  const footerLayout = useMemo<FooterLayout>(
    () => ({
      reportWrapped: () => {
        if (stackedRef.current) return;
        const width = rowWidthRef.current;
        if (width === 0) {
          pendingWrap.current = true;
          return;
        }
        setWrapThreshold((current) => Math.max(current, width));
      },
    }),
    [],
  );
  const stacked =
    forceStacked || (rowWidth > 0 && (rowWidth < OVERLAY_FOOTER_STACK_WIDTH || rowWidth <= wrapThreshold));
  stackedRef.current = stacked;
  const handleRowLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next === rowWidthRef.current) return;
    rowWidthRef.current = next;
    setRowWidth(next);
    if (pendingWrap.current) {
      pendingWrap.current = false;
      setWrapThreshold((current) => Math.max(current, next));
    }
  };

  return (
    <View
      className={cn(
        "border-t border-warm-200 dark:border-neutral-800 px-5 pt-4",
        isRTL ? "items-end" : "items-start",
        className,
      )}
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <OverlayFooterContext.Provider value={footerLayout}>
        {stacked ? (
          <View className="w-full gap-3" style={{ flexDirection: "column-reverse" }} onLayout={handleRowLayout}>
            {Children.toArray(children).map((child, index) => (
              <View key={index} className="w-full" style={{ flexDirection: "row", direction: "ltr" }}>
                {child}
              </View>
            ))}
          </View>
        ) : (
          <View
            className={cn("w-full gap-3", isRTL ? "flex-row-reverse" : "flex-row")}
            style={{ direction: "ltr" }}
            onLayout={handleRowLayout}
          >
            {children}
          </View>
        )}
      </OverlayFooterContext.Provider>
    </View>
  );
}
