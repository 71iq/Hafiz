import {
  View,
  Pressable,
  Text,
  Platform,
  StyleSheet,
  BackHandler,
  useWindowDimensions,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ReduceMotion,
} from "react-native-reanimated";
import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";
import { useChrome } from "@/lib/ui/chrome";
import { useSettings, withThemeOpacity, type ThemePalette } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import { useAuthStore } from "@/lib/auth/store";
import { isSupabaseConfigured } from "@/lib/supabase";
import { ProfileIdentity } from "@/components/profile/ProfileIdentity";
import { BusyIndicator } from "@/components/ui/BusyIndicator";
import { SyncIndicator, useSyncStatusView } from "@/components/ui/SyncIndicator";
import { openSearch } from "@/lib/navigation/search-launcher";
import {
  FLOATING_NAV_TRIGGER_SIZE,
  PERSISTENT_SIDEBAR_BREAKPOINT,
  PERSISTENT_SIDEBAR_WIDTH,
  SIDEBAR_BREAKPOINT,
  VIEWPORT_BREAKPOINTS,
} from "@/lib/ui/viewport";
import { PanelLeftOpen, PanelRightOpen, Search, X } from "lucide-react-native";
import { textStartStyle } from "@/lib/ui/direction";
import { accentIconColor, mutedIconColor } from "@/lib/ui/theme-icons";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Semantic navigation tokens. Active items use gold text on primary-soft (7.1:1). Inactive items use
 * one solid color, never a second opacity layer: the theme's muted text on surfaces (6:1 or more)
 * and a light teal on the primary sidebar (8.6:1).
 */
const NAV_TOKENS = {
  activeBackground: "#1B4D4F",
  activeText: "#FDDC91",
  inactiveOnPrimary: "#C7D3D1",
} as const;
const PANEL_WIDTH = 248;
/** Below 768px the floating bar shows these four tabs, in this order. */
export const PHONE_TAB_ROUTES = ["home", "mushaf", "progress", "settings"] as const;
const SIDEBAR_PRIMARY_ROUTES = [
  "home",
  "mushaf",
  "leaderboard",
  "progress",
  "reflection-feed",
  "reflection-journey",
] as const;
const SIDEBAR_SETTINGS_ROUTE = "settings";

type HoverFocusState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

function getRouteItems(
  state: BottomTabBarProps["state"],
  descriptors: BottomTabBarProps["descriptors"],
  routeNames: readonly string[],
) {
  return routeNames.flatMap((name) => {
    const route = state.routes.find((item) => item.name === name);
    if (!route) return [];
    const descriptor = descriptors[route.key];
    return descriptor ? [{ route, descriptor }] : [];
  });
}

/** Another modal surface (an open overlay) owns Escape while it is on top. */
function hasOpenModalSurface() {
  return typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null;
}

// ─── Bottom Tab Bar (mobile) ─────────────────────────────────

function BottomTabItem({
  route,
  descriptor,
  isFocused,
  onPress,
  onLongPress,
  inactiveColor,
  compact,
  labelScaleCap,
  isRTL,
}: {
  route: any;
  descriptor: any;
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  /** Inactive labels use the theme's solid secondary text colour, 4.5:1 or more on the bar. */
  inactiveColor: string;
  compact: boolean;
  /** The largest system text scale at which all four labels still fit this bar. */
  labelScaleCap: number;
  isRTL?: boolean;
}) {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotionPreference();
  const scaleTarget = useRef(1);
  useEffect(() => {
    if (reduceMotion) scale.value = scaleTarget.current;
  }, [reduceMotion, scale]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const { options } = descriptor;
  const label = options.title ?? route.name;
  const iconColor = isFocused ? NAV_TOKENS.activeText : inactiveColor;

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        scaleTarget.current = 0.98;
        scale.value = reduceMotion
          ? 0.98
          : withSpring(0.98, { damping: 15, stiffness: 400, reduceMotion: ReduceMotion.Never });
      }}
      onPressOut={() => {
        scaleTarget.current = 1;
        scale.value = reduceMotion ? 1 : withSpring(1, { damping: 15, stiffness: 400, reduceMotion: ReduceMotion.Never });
      }}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      style={[animatedStyle, styles.bottomTabSlot]}
    >
      {/* The pill hugs the label; the press target is the item's whole share of the bar. */}
      <View style={[styles.bottomTabItem, compact && styles.bottomTabItemCompact]}>
        {/* Android drops a view's rounding when its background arrives after mount, which turned the
            pill into a rectangle on a tab switch. The fill exists from mount and only fades. */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bottomTabPill, { opacity: isFocused ? 1 : 0 }]} />
        {options.tabBarIcon?.({ focused: isFocused, color: iconColor, size: 20 })}
        {/* Arabic labels keep their natural line height so marks above and below are not clipped. */}
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={labelScaleCap}
          style={[styles.bottomLabel, isRTL ? null : styles.bottomLabelLatin, { color: iconColor }]}
        >
          {label}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

function BottomBar(props: BottomTabBarProps & { isRTL?: boolean }) {
  const { state, descriptors, navigation, isRTL } = props;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { themeSurface, effectiveTheme } = useSettings();
  const inactiveTabColor = mutedIconColor(effectiveTheme);
  const tabs = getRouteItems(state, descriptors, PHONE_TAB_ROUTES);
  const compact = width < VIEWPORT_BREAKPOINTS.phoneCompact;
  const { visible, immersive } = useChrome();
  const chromeVisible = visible && !immersive;
  const barBackground = withThemeOpacity(themeSurface, 0.8);
  const nativeBarBackground = withThemeOpacity(themeSurface, 0.95);

  const reduceMotion = useReducedMotionPreference();
  const hidden = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      hidden.value = chromeVisible ? 0 : 1;
      return;
    }
    hidden.value = withTiming(chromeVisible ? 0 : 1, { duration: 200, reduceMotion: ReduceMotion.Never });
  }, [chromeVisible, hidden, reduceMotion]);
  const barAnimStyle = useAnimatedStyle(() => {
    const slide = hidden.value * 120;
    return {
      transform: [{ translateY: slide }],
      opacity: 1 - hidden.value,
    };
  });

  return (
    <Animated.View
      pointerEvents={chromeVisible ? "auto" : "none"}
      style={[
        styles.bottomContainer,
        compact && styles.bottomContainerCompact,
        {
          position: Platform.OS === "web" ? ("fixed" as any) : "absolute",
          bottom: Math.max(insets.bottom, 10),
          paddingBottom: 6,
          zIndex: 80,
          backgroundColor: barBackground,
          ...Platform.select({
            web: {
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              pointerEvents: chromeVisible ? "auto" : "none",
            } as any,
            default: {
              backgroundColor: nativeBarBackground,
            },
          }),
        },
        barAnimStyle,
      ]}
    >
      {tabs.map(({ route, descriptor }) => {
        const isFocused = state.index === state.routes.indexOf(route);
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        const onLongPress = () => {
          navigation.emit({ type: "tabLongPress", target: route.key });
        };

        return (
          <BottomTabItem
            key={route.key}
            route={route}
            descriptor={descriptor}
            isFocused={isFocused}
            onPress={onPress}
            onLongPress={onLongPress}
            inactiveColor={inactiveTabColor}
            compact={compact}
            // Four 11px labels fit 320px at standard size, 360px up to about 1.15x and 390px up to 1.3x.
            labelScaleCap={width < 360 ? 1 : width < 390 ? 1.15 : 1.3}
            isRTL={isRTL}
          />
        );
      })}
    </Animated.View>
  );
}

// ─── Panel and sidebar (768px and wider) ─────────────────────

function SidebarRow({
  label,
  icon,
  isFocused,
  onPress,
  isRTL,
  isPersistent,
  theme,
  accessibilityHint,
}: {
  label: string;
  icon: (color: string) => ReactNode;
  isFocused: boolean;
  onPress: () => void;
  isRTL?: boolean;
  isPersistent?: boolean;
  theme: ThemePalette;
  accessibilityHint?: string;
}) {
  const isDarkSurface = theme === "dark" || theme === "amoled";
  const color = isFocused
    ? NAV_TOKENS.activeText
    : isPersistent
      ? NAV_TOKENS.inactiveOnPrimary
      : mutedIconColor(theme);
  // Hover and keyboard focus show a primary-soft background; the active item keeps it solid.
  const highlight = isPersistent
    ? NAV_TOKENS.activeBackground
    : withThemeOpacity(NAV_TOKENS.activeBackground, isDarkSurface ? 0.6 : 0.12);

  return (
    <Pressable
      onPress={(event: GestureResponderEvent) => {
        event?.stopPropagation?.();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={isFocused ? { selected: true } : {}}
      className={`flex-row items-center gap-3 rounded-2xl px-4 py-3 ${isFocused ? "bg-primary-soft" : ""}`}
      style={(state) => {
        const { pressed, hovered, focused } = state as HoverFocusState;
        return {
          minHeight: 44,
          direction: isRTL ? "rtl" : "ltr",
          transform: [{ scale: pressed ? 0.96 : 1 }],
          ...(!isFocused && (hovered || focused) ? { backgroundColor: highlight } : null),
        };
      }}
    >
      {icon(color)}
      <Text
        style={[
          styles.sidebarLabel,
          {
            color,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SidebarSeparator({ isDark, isPersistent }: { isDark: boolean; isPersistent?: boolean }) {
  return (
    <View
      className="mx-3 my-4"
      style={{
        height: 1,
        backgroundColor: isPersistent
          ? "rgba(253, 220, 145, 0.22)"
          : isDark
            ? "rgba(232, 225, 218, 0.12)"
            : "rgba(45, 45, 45, 0.10)",
      }}
    />
  );
}

/**
 * The profile entry. Signed out it shows Guest with an optional Log in action; while the session
 * restores it shows Signing in; while account data loads it shows a neutral Profile name, and a
 * fallback profile shows Hafiz user until the real one loads. No part of the email address is shown.
 * Only a confirmed session end (not a connectivity error) adds the log-in-again line; local progress
 * stays. The sync state sits at the end of the card.
 */
function SidebarProfileCard({
  isDark,
  isRTL,
  isPersistent,
  onNavigate,
}: {
  isDark: boolean;
  isRTL?: boolean;
  isPersistent?: boolean;
  onNavigate?: () => void;
}) {
  const s = useStrings();
  const { user, profile, isInitialized, sessionEnded } = useAuthStore();
  const syncStatus = useSyncStatusView();
  const configured = isSupabaseConfigured();
  const restoring = configured && isInitialized === false;
  const displayName = restoring
    ? s.navigationSigningIn
    : !user
      ? s.navigationGuest
      : !profile
        ? s.authProfile
        : profile.display_name || (profile.is_fallback ? "" : profile.username) || s.navigationHafizUser;
  const showSessionEnded = configured && !restoring && !user && sessionEnded;
  const nameColor = isPersistent ? "#FDDC91" : isDark ? "#F5F5F4" : "#2D2D2D";
  const handleColor = isPersistent ? NAV_TOKENS.inactiveOnPrimary : isDark ? "#A3A3A3" : "#6E5A47";
  const cardBg = isPersistent
    ? "rgba(253, 220, 145, 0.08)"
    : isDark
      ? "rgba(255, 255, 255, 0.05)"
      : "rgba(255, 255, 255, 0.62)";
  const openProfile = () => {
    onNavigate?.();
    router.push("/profile" as any);
  };
  const openLogin = () => {
    onNavigate?.();
    router.push("/auth/login" as any);
  };
  const openSyncDetails = () => {
    onNavigate?.();
    router.push({ pathname: "/(tabs)/settings", params: { category: "account" } } as any);
  };

  return (
    <View className="rounded-2xl px-3 py-2" style={{ backgroundColor: cardBg, direction: isRTL ? "rtl" : "ltr" }}>
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel={`${s.authProfile}: ${displayName}`}
          className="min-h-11 flex-1 flex-row items-center gap-3 py-1"
          style={({ pressed }) => ({ opacity: pressed ? 0.76 : 1 })}
        >
          <ProfileIdentity
            displayName={displayName}
            username={user && profile && !profile.is_fallback ? profile.username : undefined}
            avatarUrl={user && profile ? profile.avatar_url : undefined}
            isDark={isDark}
            isRTL={isRTL}
            avatarSize={34}
            nameSize={13}
            handleSize={10}
            nameColor={nameColor}
            handleColor={handleColor}
          />
        </Pressable>
        {restoring ? <BusyIndicator size={14} color={handleColor} /> : null}
        {!restoring && !user && configured ? (
          <Pressable
            onPress={openLogin}
            accessibilityRole="button"
            className="min-h-11 items-center justify-center rounded-full px-3"
          >
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, color: nameColor }}>{s.navigationLogIn}</Text>
          </Pressable>
        ) : null}
        {/* The sync state opens its details (last success, pending changes, guarded retry) in Settings > Account. */}
        {user && syncStatus !== "idle" && syncStatus !== "synced" ? (
          <Pressable
            onPress={openSyncDetails}
            accessibilityRole="button"
            accessibilityLabel={s.navigationSyncDetails}
            className="min-h-11 min-w-11 items-center justify-center"
          >
            <SyncIndicator status={syncStatus} isDark={isDark} hideSuccess onPrimary={isPersistent} />
          </Pressable>
        ) : null}
      </View>
      {showSessionEnded ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            fontFamily: "Manrope_500Medium",
            fontSize: 12,
            lineHeight: 17,
            color: handleColor,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
            paddingBottom: 2,
          }}
        >
          {s.authSessionEnded}
        </Text>
      ) : null}
    </View>
  );
}

function SidebarContent({
  state,
  descriptors,
  navigation,
  isDark,
  isRTL,
  isPersistent,
  onNavigate,
  onClose,
}: BottomTabBarProps & {
  isDark: boolean;
  isRTL?: boolean;
  isPersistent?: boolean;
  onNavigate?: () => void;
  /** Floating panels show a labeled Close button. */
  onClose?: () => void;
}) {
  const s = useStrings();
  const { effectiveTheme } = useSettings();
  const theme: ThemePalette = effectiveTheme ?? (isDark ? "dark" : "beige");
  const primaryItems = getRouteItems(state, descriptors, SIDEBAR_PRIMARY_ROUTES);
  const [settingsItem] = getRouteItems(state, descriptors, [SIDEBAR_SETTINGS_ROUTE]);

  const renderItem = ({ route, descriptor }: { route: any; descriptor: any }) => {
    const isFocused = state.index === state.routes.indexOf(route);
    const onPress = () => {
      const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.name === SIDEBAR_SETTINGS_ROUTE ? { category: "general" } : route.params);
      }
      onNavigate?.();
    };

    return (
      <SidebarRow
        key={route.key}
        label={descriptor.options.title ?? route.name}
        icon={(color) => descriptor.options.tabBarIcon?.({ focused: isFocused, color, size: 20 })}
        isFocused={isFocused}
        onPress={onPress}
        isRTL={isRTL}
        isPersistent={isPersistent}
        theme={theme}
      />
    );
  };

  return (
    <>
      <View
        className="px-3 pb-7"
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          direction: isRTL ? "rtl" : "ltr",
          width: "100%",
        }}
      >
        <Text
          className={isPersistent ? "text-gold" : "text-primary dark:text-neutral-100"}
          style={{
            fontFamily: isRTL ? undefined : "NotoSerif_700Bold",
            fontSize: isPersistent ? 24 : 22,
            fontWeight: isRTL ? "700" : undefined,
            ...textStartStyle(isRTL),
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {s.appName}
        </Text>
        {onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={s.navigationClose}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={(state) => {
              const { hovered, focused } = state as HoverFocusState;
              return hovered || focused
                ? { backgroundColor: withThemeOpacity(NAV_TOKENS.activeBackground, 0.12) }
                : null;
            }}
          >
            <X size={18} color={mutedIconColor(theme)} />
          </Pressable>
        ) : null}
      </View>

      <View className="gap-1">
        {primaryItems.map(renderItem)}
        <SidebarRow
          label={s.tabSearch}
          icon={(color) => <Search size={20} color={color} strokeWidth={2} />}
          isFocused={false}
          onPress={() => {
            onNavigate?.();
            openSearch();
          }}
          isRTL={isRTL}
          isPersistent={isPersistent}
          theme={theme}
          accessibilityHint={Platform.OS === "web" ? "Ctrl+K" : undefined}
        />
      </View>
      <SidebarSeparator isDark={isDark} isPersistent={isPersistent} />
      {isPersistent && <View className="flex-1" />}
      {settingsItem ? renderItem(settingsItem) : null}
      <SidebarSeparator isDark={isDark} isPersistent={isPersistent} />
      <SidebarProfileCard isDark={isDark} isRTL={isRTL} isPersistent={isPersistent} onNavigate={onNavigate} />
    </>
  );
}

/**
 * Edge-triggered panel for 768-1023px and for Mushaf at every width from 768px. It opens only by
 * click, tap or keyboard on the visible trigger. While open, a capturing outside layer dismisses it
 * on the first outside press without activating what is underneath; Close, Escape and Android Back
 * also dismiss it and focus returns to the trigger.
 */
function FloatingPanel(props: BottomTabBarProps & { isRTL?: boolean }) {
  const { isRTL } = props;
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { isDark, effectiveTheme } = useSettings();
  const theme: ThemePalette = effectiveTheme ?? (isDark ? "dark" : "beige");
  const { visible, immersive } = useChrome();
  const chromeVisible = visible && !immersive;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<View>(null);
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    if (reduceMotion) {
      progress.value = open ? 1 : 0;
      return;
    }
    progress.value = withTiming(open ? 1 : 0, { duration: 180, reduceMotion: ReduceMotion.Never });
  }, [open, progress, reduceMotion]);

  useEffect(() => {
    if (!chromeVisible) setOpen(false);
  }, [chromeVisible]);

  // Destinations mount while open and through the closing fade, so a closed panel has nothing in the
  // keyboard order.
  const [contentMounted, setContentMounted] = useState(false);
  useEffect(() => {
    if (open) {
      setContentMounted(true);
      return;
    }
    if (reduceMotion) {
      setContentMounted(false);
      return;
    }
    const timer = setTimeout(() => setContentMounted(false), 180);
    return () => clearTimeout(timer);
  }, [open, reduceMotion]);

  const closePanel = useCallback(() => {
    setOpen(false);
    if (Platform.OS === "web" && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => (triggerRef.current as unknown as HTMLElement | null)?.focus?.());
    }
  }, []);
  const togglePanel = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  useEffect(() => {
    if (!open) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      closePanel();
      return true;
    });
    if (Platform.OS !== "web" || typeof document === "undefined") return () => back.remove();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || hasOpenModalSurface()) return;
      event.preventDefault();
      closePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      back.remove();
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closePanel]);

  const panelStyle = useAnimatedStyle(() => {
    const hiddenOffset = isRTL ? 24 : -24;
    return {
      opacity: progress.value,
      transform: [{ translateX: hiddenOffset * (1 - progress.value) }],
    };
  });

  const pointerEvents = open ? "auto" : "none";
  const menuColor = mutedIconColor(theme);
  const sideStyle = isRTL
    ? { right: 0, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 }
    : { left: 0, borderTopRightRadius: 14, borderBottomRightRadius: 14 };
  const edgeStyle = isRTL ? { right: 0 } : { left: 0 };
  const triggerTop = Math.max(insets.top + 132, Math.round(height * 0.45) - 28);
  const panelTop = Math.max(insets.top + 88, 96);
  const SidebarTriggerIcon = isRTL ? PanelRightOpen : PanelLeftOpen;
  const fixedPosition = Platform.OS === "web" ? ("fixed" as any) : "absolute";

  if (!chromeVisible) return null;

  return (
    <>
      {open ? (
        <Pressable
          testID="navigation-outside-layer"
          onPress={closePanel}
          accessible={false}
          importantForAccessibility="no"
          aria-hidden
          style={{ position: fixedPosition, top: 0, bottom: 0, left: 0, right: 0, zIndex: 50 }}
        />
      ) : null}

      {/* A 44px target in the reserved gutter; the visible tab hugs the screen edge. */}
      <Pressable
        ref={triggerRef}
        onPress={togglePanel}
        accessibilityRole="button"
        accessibilityLabel={s.navigationMenu}
        accessibilityState={{ expanded: open }}
        style={{
          position: "absolute",
          top: triggerTop,
          width: FLOATING_NAV_TRIGGER_SIZE,
          height: 56,
          zIndex: 60,
          alignItems: isRTL ? "flex-end" : "flex-start",
          ...edgeStyle,
        }}
      >
        {(state) => {
          const { focused, hovered } = state as HoverFocusState;
          return (
            <View
              className="items-center justify-center bg-surface-high/90 dark:bg-surface-dark-high/90"
              style={{
                width: 28,
                height: 56,
                ...sideStyle,
                borderWidth: focused ? 2 : 0,
                borderColor: accentIconColor(theme),
                opacity: hovered ? 0.9 : 1,
                ...Platform.select({
                  web: { backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } as any,
                  default: {},
                }),
              }}
            >
              <SidebarTriggerIcon size={16} color={menuColor} />
            </View>
          );
        }}
      </Pressable>

      <Animated.View
        pointerEvents={pointerEvents}
        aria-hidden={!open}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        style={[
          {
            position: "absolute",
            top: panelTop,
            width: PANEL_WIDTH,
            zIndex: 55,
            ...sideStyle,
            ...Platform.select({
              web: {
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                pointerEvents: open ? "auto" : "none",
              } as any,
              default: {},
            }),
          },
          panelStyle,
        ]}
      >
        <View className="rounded-3xl bg-surface/95 dark:bg-surface-dark/95 px-4 py-5">
          {contentMounted ? (
            <SidebarContent {...props} isDark={isDark} onNavigate={closePanel} onClose={closePanel} />
          ) : null}
        </View>
      </Animated.View>
    </>
  );
}

/** The persistent desktop sidebar stays nonmodal: no outside layer, the page keeps working beside it. */
function PersistentSidebar(props: BottomTabBarProps & { isRTL?: boolean }) {
  const { isRTL } = props;
  const insets = useSafeAreaInsets();
  const { immersive } = useChrome();
  const sideStyle = isRTL ? { right: 16 } : { left: 16 };

  if (immersive) return null;

  return (
    <View
      style={{
        position: Platform.OS === "web" ? ("fixed" as any) : "absolute",
        top: Math.max(insets.top + 16, 16),
        bottom: Math.max(insets.bottom + 16, 16),
        width: PERSISTENT_SIDEBAR_WIDTH,
        zIndex: 70,
        ...sideStyle,
      }}
      pointerEvents="box-none"
    >
      <View className="h-full flex rounded-4xl bg-primary dark:bg-primary px-4 py-5">
        <SidebarContent {...props} isDark isPersistent />
      </View>
    </View>
  );
}

// ─── Responsive wrapper ─────────────────────────────────────

/**
 * Below 768px: the four-tab floating bar. From 768px: every destination plus Search in the edge
 * panel, which becomes the persistent sidebar from 1024px except on Mushaf, where the reader keeps
 * the full width and the edge panel serves instead. Switching presentation never remounts the tabs.
 */
export function AppNavigation(props: BottomTabBarProps & { isRTL?: boolean }) {
  const { width } = useWindowDimensions();
  const hasPersistentSidebar = width >= PERSISTENT_SIDEBAR_BREAKPOINT;
  const isWide = width >= SIDEBAR_BREAKPOINT;
  const activeRouteName = props.state.routes[props.state.index]?.name;

  if (hasPersistentSidebar && activeRouteName !== "mushaf") {
    return <PersistentSidebar {...props} />;
  }
  if (isWide) {
    return <FloatingPanel {...props} />;
  }
  return <BottomBar {...props} />;
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Bottom bar
  bottomContainer: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: 6,
    borderRadius: 28,
    shadowColor: "#003638",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 8,
  },
  // Below 360 px the bar and pills tighten so every tab keeps its whole label and a 44 px target.
  bottomContainerCompact: {
    paddingHorizontal: 4,
  },
  // Each tab is as wide as its label and pill, at least 44 px, and shares what is left of the bar.
  bottomTabSlot: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomTabItem: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
  },
  bottomTabItemCompact: {
    paddingHorizontal: 6,
  },
  bottomTabPill: {
    borderRadius: 9999,
    backgroundColor: NAV_TOKENS.activeBackground,
  },
  bottomLabel: {
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
    letterSpacing: 0,
    marginTop: 2,
  },
  bottomLabelLatin: {
    lineHeight: 14,
  },
  sidebarLabel: {
    fontFamily: "Manrope_500Medium",
    fontSize: 14,
  },
});
