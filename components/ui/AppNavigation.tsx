import {
  View,
  Pressable,
  Text,
  Image,
  Platform,
  StyleSheet,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router, useGlobalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useEffect, useState, useCallback, useRef } from "react";
import { useColorScheme } from "nativewind";
import { useChrome } from "@/lib/ui/chrome";
import { useStrings } from "@/lib/i18n/useStrings";
import { useAuthStore } from "@/lib/auth/store";
import { PublicProfileOverlay } from "@/components/profile/PublicProfileOverlay";
import {
  PERSISTENT_SIDEBAR_BREAKPOINT,
  PERSISTENT_SIDEBAR_WIDTH,
  SIDEBAR_BREAKPOINT,
} from "@/lib/ui/viewport";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FileText,
  Info,
  PanelLeftOpen,
  PanelRightOpen,
  SlidersHorizontal,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react-native";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ACTIVE_BG = "#1B4D4F";
const ACTIVE_TEXT = "#FDDC91";
const INACTIVE_OPACITY = 0.5;
const INACTIVE_LIGHT = "rgba(45, 45, 45, 0.5)";
const INACTIVE_DARK = "rgba(232, 225, 218, 0.5)";
const BAR_BG_LIGHT = "rgba(255, 248, 241, 0.80)";
const BAR_BG_DARK = "rgba(28, 25, 23, 0.80)";
const PANEL_WIDTH = 248;
const SIDEBAR_PRIMARY_ROUTES = [
  "home",
  "mushaf",
  "leaderboard",
  "progress",
  "reflection-feed",
  "reflection-journey",
] as const;
const SIDEBAR_SETTINGS_ROUTE = "settings";
const SETTINGS_CATEGORY_IDS = [
  "general",
  "reading",
  "content",
  "account",
  "about",
  "advanced",
] as const;

type SettingsCategoryId = typeof SETTINGS_CATEGORY_IDS[number];

const SETTINGS_CATEGORY_ICONS: Record<SettingsCategoryId, LucideIcon> = {
  general: SlidersHorizontal,
  reading: BookOpen,
  content: FileText,
  account: User,
  about: Info,
  advanced: Sparkles,
};

function parseSettingsCategory(value: string | string[] | undefined): SettingsCategoryId {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return SETTINGS_CATEGORY_IDS.includes(rawValue as SettingsCategoryId)
    ? rawValue as SettingsCategoryId
    : "general";
}

function getVisibleRoutes(state: BottomTabBarProps["state"], descriptors: BottomTabBarProps["descriptors"]) {
  return state.routes.filter((route) => {
    const { options } = descriptors[route.key];
    const itemStyle = options.tabBarItemStyle as any;
    return !(itemStyle && itemStyle.display === "none");
  });
}

function getSidebarRouteItems(
  state: BottomTabBarProps["state"],
  descriptors: BottomTabBarProps["descriptors"],
  routeNames: readonly string[]
) {
  return routeNames.flatMap((name) => {
    const route = state.routes.find((item) => item.name === name);
    if (!route) return [];
    const descriptor = descriptors[route.key];
    return descriptor ? [{ route, descriptor }] : [];
  });
}

// ─── Bottom Tab Bar (mobile) ─────────────────────────────────

function BottomTabItem({
  route,
  descriptor,
  isFocused,
  onPress,
  onLongPress,
  isDark,
}: {
  route: any;
  descriptor: any;
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  isDark: boolean;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const { options } = descriptor;
  const label = options.title ?? route.name;
  const iconColor = isFocused ? ACTIVE_TEXT : isDark ? INACTIVE_DARK : INACTIVE_LIGHT;

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => { scale.value = withSpring(0.98, { damping: 15, stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      style={[
        animatedStyle,
        styles.bottomTabItem,
        isFocused && styles.bottomTabItemActive,
        !isFocused && { opacity: INACTIVE_OPACITY },
      ]}
    >
      {options.tabBarIcon?.({ focused: isFocused, color: iconColor, size: 20 })}
      <Text style={[styles.bottomLabel, { color: iconColor }]}>{label}</Text>
    </AnimatedPressable>
  );
}

function BottomBar(props: BottomTabBarProps) {
  const { state, descriptors, navigation } = props;
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const visibleRoutes = getVisibleRoutes(state, descriptors);
  const { visible, immersive } = useChrome();
  const chromeVisible = visible && !immersive;

  const hidden = useSharedValue(0);
  useEffect(() => {
    hidden.value = withTiming(chromeVisible ? 0 : 1, { duration: 200 });
  }, [chromeVisible, hidden]);
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
        {
          position: Platform.OS === "web" ? "fixed" as any : "absolute",
          bottom: Math.max(insets.bottom, 10),
          paddingBottom: 6,
          zIndex: 80,
          backgroundColor: isDark ? BAR_BG_DARK : BAR_BG_LIGHT,
          ...Platform.select({
            web: {
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              pointerEvents: chromeVisible ? "auto" : "none",
            } as any,
            default: {
              backgroundColor: isDark ? "rgba(28,25,23,0.95)" : "rgba(255,248,241,0.95)",
            },
          }),
        },
        barAnimStyle,
      ]}
    >
      {visibleRoutes.map((route) => {
        const descriptor = descriptors[route.key];
        const isFocused = state.index === state.routes.indexOf(route);
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        const onLongPress = () => { navigation.emit({ type: "tabLongPress", target: route.key }); };

        return (
          <BottomTabItem
            key={route.key}
            route={route}
            descriptor={descriptor}
            isFocused={isFocused}
            onPress={onPress}
            onLongPress={onLongPress}
            isDark={isDark}
          />
        );
      })}
    </Animated.View>
  );
}

// ─── Floating Panel (desktop) ───────────────────────────────

function SidebarItem({
  route,
  descriptor,
  isFocused,
  onPress,
  isDark,
  isRTL,
}: {
  route: any;
  descriptor: any;
  isFocused: boolean;
  onPress: () => void;
  isDark: boolean;
  isRTL?: boolean;
}) {
  const { options } = descriptor;
  const label = options.title ?? route.name;
  const iconColor = isFocused ? ACTIVE_TEXT : isDark ? INACTIVE_DARK : INACTIVE_LIGHT;

  return (
    <Pressable
      onPress={(event: GestureResponderEvent) => {
        event.stopPropagation();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      className={`flex-row items-center gap-3 rounded-2xl px-4 py-3 ${isFocused ? "bg-primary-soft" : ""}`}
      style={({ pressed }) => ({
        direction: isRTL ? "rtl" : "ltr",
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {options.tabBarIcon?.({ focused: isFocused, color: iconColor, size: 20 })}
      <Text
        style={[
          styles.sidebarLabel,
          {
            color: iconColor,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SidebarSeparator({
  isDark,
  isPersistent,
}: {
  isDark: boolean;
  isPersistent?: boolean;
}) {
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

function SidebarProfileCard({
  isDark,
  isRTL,
  isPersistent,
  opensOverlay,
}: {
  isDark: boolean;
  isRTL?: boolean;
  isPersistent?: boolean;
  opensOverlay?: boolean;
}) {
  const s = useStrings();
  const { user, profile } = useAuthStore();
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const displayName = profile?.display_name || profile?.username || user?.email?.split("@")[0] || s.authProfile;
  const avatarUrl = profile?.avatar_url;
  const initial = Array.from(displayName.trim())[0]?.toUpperCase() || "H";
  const nameColor = isPersistent ? "#FDDC91" : isDark ? "#F5F5F4" : "#2D2D2D";
  const avatarBg = isPersistent
    ? "rgba(253, 220, 145, 0.14)"
    : isDark
      ? "rgba(45, 212, 191, 0.14)"
      : "rgba(13, 148, 136, 0.12)";
  const cardBg = isPersistent
    ? "rgba(253, 220, 145, 0.08)"
    : isDark
      ? "rgba(255, 255, 255, 0.05)"
      : "rgba(255, 255, 255, 0.62)";
  const openProfile = () => {
    if (opensOverlay && user?.id) {
      setProfileUserId(user.id);
      return;
    }
    router.push("/profile" as any);
  };

  return (
    <>
    <Pressable
      onPress={openProfile}
      accessibilityRole="button"
      className="flex-row items-center gap-3 rounded-2xl px-3 py-3"
      style={({ pressed }) => ({
        backgroundColor: cardBg,
        direction: isRTL ? "rtl" : "ltr",
        opacity: pressed ? 0.76 : 1,
      })}
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.sidebarAvatar} />
      ) : (
        <View style={[styles.sidebarAvatarFallback, { backgroundColor: avatarBg }]}>
          <Text
            style={{
              color: nameColor,
              fontFamily: "Manrope_700Bold",
              fontSize: 13,
            }}
          >
            {initial}
          </Text>
        </View>
      )}
      <Text
        numberOfLines={1}
        style={[
          styles.sidebarProfileName,
          {
            color: nameColor,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          },
        ]}
      >
        {displayName}
      </Text>
    </Pressable>
    <PublicProfileOverlay userId={profileUserId} onClose={() => setProfileUserId(null)} />
    </>
  );
}

function SettingsSidebarContent({
  navigation,
  category,
  isDark,
  isRTL,
  isPersistent,
  onNavigate,
}: {
  navigation: BottomTabBarProps["navigation"];
  category?: string | string[];
  isDark: boolean;
  isRTL?: boolean;
  isPersistent?: boolean;
  onNavigate?: () => void;
}) {
  const s = useStrings();
  const params = useGlobalSearchParams<{ category?: string | string[] }>();
  const activeCategory = parseSettingsCategory(category ?? params.category);
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;
  const settingsCategories: Array<{ id: SettingsCategoryId; title: string; icon: LucideIcon }> = [
    { id: "general", title: s.settingsCategoryGeneral, icon: SETTINGS_CATEGORY_ICONS.general },
    { id: "reading", title: s.settingsCategoryReading, icon: SETTINGS_CATEGORY_ICONS.reading },
    { id: "content", title: s.settingsCategoryContent, icon: SETTINGS_CATEGORY_ICONS.content },
    { id: "account", title: s.settingsCategoryAccount, icon: SETTINGS_CATEGORY_ICONS.account },
    { id: "about", title: s.settingsCategoryAbout, icon: SETTINGS_CATEGORY_ICONS.about },
    { id: "advanced", title: s.settingsCategoryAdvanced, icon: SETTINGS_CATEGORY_ICONS.advanced },
  ];
  const headerColor = isPersistent ? ACTIVE_TEXT : isDark ? "#F5F5F4" : "#2D2D2D";
  const activeColor = isPersistent ? ACTIVE_TEXT : isDark ? "#2dd4bf" : "#0d9488";
  const inactiveColor = isPersistent
    ? INACTIVE_DARK
    : isDark ? INACTIVE_DARK : INACTIVE_LIGHT;
  const activeBg = isPersistent
    ? ACTIVE_BG
    : isDark ? "rgba(45, 212, 191, 0.14)" : "rgba(13, 148, 136, 0.10)";

  const goBackToHome = () => {
    navigation.navigate("home");
    onNavigate?.();
  };

  const selectCategory = (category: SettingsCategoryId) => {
    navigation.navigate(SIDEBAR_SETTINGS_ROUTE, { category });
    onNavigate?.();
  };

  return (
    <>
      <Pressable
        onPress={goBackToHome}
        accessibilityRole="button"
        className="mb-5 flex-row items-center gap-3 rounded-2xl px-3 py-3"
        style={({ pressed }) => ({
          backgroundColor: pressed
            ? isPersistent ? "rgba(253, 220, 145, 0.12)" : isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(45, 45, 45, 0.06)"
            : "transparent",
          direction: isRTL ? "rtl" : "ltr",
          opacity: pressed ? 0.78 : 1,
        })}
      >
        <BackIcon size={18} color={headerColor} />
        <Text
          style={{
            color: headerColor,
            flex: 1,
            fontFamily: "Manrope_700Bold",
            fontSize: 16,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {s.tabSettings}
        </Text>
      </Pressable>

      <View className="gap-1">
        {settingsCategories.map((category) => {
          const isActive = activeCategory === category.id;
          const Icon = category.icon;
          const iconColor = isActive ? activeColor : inactiveColor;

          return (
            <Pressable
              key={category.id}
              onPress={() => selectCategory(category.id)}
              accessibilityRole="button"
              accessibilityState={isActive ? { selected: true } : {}}
              className="flex-row items-center gap-3 rounded-2xl px-4 py-3"
              style={({ pressed }) => ({
                backgroundColor: isActive ? activeBg : "transparent",
                direction: isRTL ? "rtl" : "ltr",
                opacity: pressed ? 0.78 : 1,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <Icon size={20} color={iconColor} />
              <Text
                style={[
                  styles.sidebarLabel,
                  {
                    color: iconColor,
                    fontFamily: isActive ? "Manrope_700Bold" : "Manrope_500Medium",
                    textAlign: isRTL ? "right" : "left",
                    writingDirection: isRTL ? "rtl" : "ltr",
                  },
                ]}
              >
                {category.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
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
}: BottomTabBarProps & {
  isDark: boolean;
  isRTL?: boolean;
  isPersistent?: boolean;
  onNavigate?: () => void;
}) {
  const s = useStrings();
  const activeRoute = state.routes[state.index];
  const isSettingsRoute = activeRoute?.name === SIDEBAR_SETTINGS_ROUTE;
  const profileOpensOverlay = activeRoute?.name === "leaderboard";
  const primaryItems = getSidebarRouteItems(state, descriptors, SIDEBAR_PRIMARY_ROUTES);
  const [settingsItem] = getSidebarRouteItems(state, descriptors, [SIDEBAR_SETTINGS_ROUTE]);

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
      <SidebarItem
        key={route.key}
        route={route}
        descriptor={descriptor}
        isFocused={isFocused}
        onPress={onPress}
        isDark={isDark}
        isRTL={isRTL}
      />
    );
  };

  if (isSettingsRoute) {
    return (
      <SettingsSidebarContent
        navigation={navigation}
        category={(activeRoute.params as { category?: string | string[] } | undefined)?.category}
        isDark={isDark}
        isRTL={isRTL}
        isPersistent={isPersistent}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <>
      <View
        className="px-3 pb-7"
        style={{
          alignItems: isRTL ? "flex-end" : "flex-start",
          width: "100%",
        }}
      >
        <Text
          className={isPersistent ? "text-gold" : "text-primary dark:text-neutral-100"}
          style={{
            fontFamily: isRTL ? undefined : "NotoSerif_700Bold",
            fontSize: isPersistent ? 24 : 22,
            fontWeight: isRTL ? "700" : undefined,
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
        >
          {s.appName}
        </Text>
      </View>

      <View className="gap-1">{primaryItems.map(renderItem)}</View>
      <SidebarSeparator isDark={isDark} isPersistent={isPersistent} />
      {isPersistent && <View className="flex-1" />}
      {settingsItem ? renderItem(settingsItem) : null}
      <SidebarSeparator isDark={isDark} isPersistent={isPersistent} />
      <SidebarProfileCard
        isDark={isDark}
        isRTL={isRTL}
        isPersistent={isPersistent}
        opensOverlay={profileOpensOverlay}
      />
    </>
  );
}

function FloatingPanel(props: BottomTabBarProps & { isRTL?: boolean }) {
  const { isRTL } = props;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const { immersive } = useChrome();
  const [open, setOpen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progress = useSharedValue(0);

  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: 180 });
  }, [open, progress]);

  useEffect(() => {
    if (immersive) setOpen(false);
  }, [immersive]);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);
  const showPanel = useCallback(() => {
    cancelHide();
    setOpen(true);
  }, [cancelHide]);
  const hidePanel = useCallback(() => {
    cancelHide();
    setOpen(false);
  }, [cancelHide]);
  const scheduleHidePanel = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setOpen(false);
    }, 180);
  }, [cancelHide]);
  const togglePanel = useCallback(() => setOpen((v) => !v), []);

  const panelStyle = useAnimatedStyle(() => {
    const hiddenOffset = isRTL ? 24 : -24;
    return {
      opacity: progress.value,
      transform: [{ translateX: hiddenOffset * (1 - progress.value) }],
    };
  });

  const pointerEvents = open ? "auto" : "none";
  const menuColor = isDark ? "#a3a3a3" : "#8B8178";
  const sideStyle = isRTL ? { right: 16 } : { left: 16 };
  const edgeStyle = isRTL ? { right: 0 } : { left: 0 };
  const triggerTop = Math.max(insets.top + 132, Math.round(height * 0.45) - 22);
  const panelTop = Math.max(insets.top + 88, 96);
  const SidebarTriggerIcon = isRTL ? PanelRightOpen : PanelLeftOpen;

  if (immersive) return null;

  return (
    <>
      <Pressable
        onPress={togglePanel}
        onHoverIn={showPanel}
        onHoverOut={scheduleHidePanel}
        onFocus={showPanel}
        onBlur={scheduleHidePanel}
        accessibilityRole="button"
        className="items-center justify-center rounded-full bg-surface-high/90 dark:bg-surface-dark-high/90"
        style={{
          position: "absolute",
          top: triggerTop,
          width: 44,
          height: 44,
          zIndex: 60,
          ...sideStyle,
          ...Platform.select({
            web: { backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } as any,
            default: {},
          }),
        }}
      >
        <SidebarTriggerIcon size={18} color={menuColor} />
      </Pressable>

      <Pressable
        onHoverIn={showPanel}
        onHoverOut={scheduleHidePanel}
        onFocus={showPanel}
        onBlur={scheduleHidePanel}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: 16,
          zIndex: 40,
          ...edgeStyle,
        }}
      />

      <Animated.View
        pointerEvents={pointerEvents}
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
        <Pressable
          onHoverIn={showPanel}
          onHoverOut={scheduleHidePanel}
          onFocus={showPanel}
          onBlur={scheduleHidePanel}
          className="rounded-3xl bg-surface/95 dark:bg-surface-dark/95 px-4 py-5"
        >
          <SidebarContent {...props} isDark={isDark} onNavigate={hidePanel} />
        </Pressable>
      </Animated.View>
    </>
  );
}

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

export function AppNavigation(props: BottomTabBarProps & { isRTL?: boolean }) {
  const { width } = useWindowDimensions();
  const hasPersistentSidebar = width >= PERSISTENT_SIDEBAR_BREAKPOINT;
  const isWide = width >= SIDEBAR_BREAKPOINT;
  const activeRouteName = props.state.routes[props.state.index]?.name;

  if (activeRouteName === "mushaf" && isWide) {
    return null;
  }

  if (hasPersistentSidebar) {
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
  bottomTabItem: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 9999,
  },
  bottomTabItemActive: {
    backgroundColor: ACTIVE_BG,
  },
  bottomLabel: {
    fontFamily: "Manrope_500Medium",
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 0,
    marginTop: 2,
  },
  sidebarLabel: {
    fontFamily: "Manrope_500Medium",
    fontSize: 14,
  },
  sidebarAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  sidebarAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  sidebarProfileName: {
    flex: 1,
    fontFamily: "Manrope_600SemiBold",
    fontSize: 13,
  },
});
