import { View, Pressable, Text, Platform, StyleSheet, useWindowDimensions } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useEffect, useState, useCallback } from "react";
import { useColorScheme } from "nativewind";
import { useChrome } from "@/lib/ui/chrome";
import { Menu } from "lucide-react-native";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ACTIVE_BG = "#1B4D4F";
const ACTIVE_TEXT = "#FDDC91";
const INACTIVE_LIGHT = "rgba(45, 45, 45, 0.5)";
const INACTIVE_DARK = "rgba(232, 225, 218, 0.5)";
const BAR_BG_LIGHT = "rgba(255, 248, 241, 0.80)";
const BAR_BG_DARK = "rgba(28, 25, 23, 0.80)";
export const SIDEBAR_BREAKPOINT = 768;
const PANEL_WIDTH = 248;

function getVisibleRoutes(state: BottomTabBarProps["state"], descriptors: BottomTabBarProps["descriptors"]) {
  return state.routes.filter((route) => {
    const { options } = descriptors[route.key];
    const itemStyle = options.tabBarItemStyle as any;
    return !(itemStyle && itemStyle.display === "none");
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
      onPressIn={() => { scale.value = withSpring(0.9, { damping: 15, stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      style={[animatedStyle, styles.bottomTabItem, isFocused && styles.bottomTabItemActive]}
    >
      {options.tabBarIcon?.({ focused: isFocused, color: iconColor, size: 22 })}
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
  const { visible } = useChrome();

  const hidden = useSharedValue(0);
  useEffect(() => {
    hidden.value = withTiming(visible ? 0 : 1, { duration: 200 });
  }, [visible, hidden]);
  const barAnimStyle = useAnimatedStyle(() => {
    const slide = hidden.value * 120;
    return {
      transform: [{ translateY: slide }],
      opacity: 1 - hidden.value,
    };
  });

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        styles.bottomContainer,
        {
          paddingBottom: Math.max(insets.bottom, 12),
          backgroundColor: isDark ? BAR_BG_DARK : BAR_BG_LIGHT,
          ...Platform.select({
            web: { backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" } as any,
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
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      className={`${isRTL ? "flex-row-reverse" : "flex-row"} items-center gap-3 rounded-2xl px-4 py-3 ${isFocused ? "bg-primary" : ""}`}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {options.tabBarIcon?.({ focused: isFocused, color: iconColor, size: 20 })}
      <Text style={[styles.sidebarLabel, { color: iconColor }]}>{label}</Text>
    </Pressable>
  );
}

function FloatingPanel(props: BottomTabBarProps & { isRTL?: boolean }) {
  const { state, descriptors, navigation, isRTL } = props;
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const visibleRoutes = getVisibleRoutes(state, descriptors);
  const [open, setOpen] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: 180 });
  }, [open, progress]);

  const showPanel = useCallback(() => setOpen(true), []);
  const hidePanel = useCallback(() => setOpen(false), []);
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
  const triggerTop = Math.max(insets.top + 72, 88);
  const panelTop = triggerTop + 56;

  return (
    <>
      <Pressable
        onPress={togglePanel}
        onFocus={showPanel}
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
            web: { backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" } as any,
            default: {},
          }),
        }}
      >
        <Menu size={18} color={menuColor} />
      </Pressable>

      <Pressable
        onHoverIn={showPanel}
        onFocus={showPanel}
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
              web: { backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" } as any,
              default: {},
            }),
          },
          panelStyle,
        ]}
      >
        <Pressable
          onHoverIn={showPanel}
          onPress={showPanel}
          className="rounded-3xl bg-surface/95 dark:bg-surface-dark/95 px-4 py-5"
        >
          <View className="px-3 pb-6">
            <Text
              className="text-primary dark:text-neutral-100"
              style={{ fontFamily: "NotoSerif_700Bold", fontSize: 22 }}
            >
              Hafiz
            </Text>
            <Text
              className="mt-0.5 text-warm-400 dark:text-neutral-500"
              style={{ fontFamily: "Manrope_400Regular", fontSize: 11 }}
            >
              The Digital Sanctuary
            </Text>
          </View>

          <View className="gap-1">
            {visibleRoutes.map((route) => {
              const descriptor = descriptors[route.key];
              const isFocused = state.index === state.routes.indexOf(route);
              const onPress = () => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
                hidePanel();
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
            })}
          </View>
        </Pressable>
      </Animated.View>
    </>
  );
}

// ─── Responsive wrapper ─────────────────────────────────────

export function AppNavigation(props: BottomTabBarProps & { isRTL?: boolean }) {
  const { width } = useWindowDimensions();
  const isWide = width >= SIDEBAR_BREAKPOINT;

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
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    shadowColor: "#003638",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 8,
  },
  bottomTabItem: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
  },
  bottomTabItemActive: {
    backgroundColor: ACTIVE_BG,
  },
  bottomLabel: {
    fontFamily: "Manrope_500Medium",
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  sidebarLabel: {
    fontFamily: "Manrope_500Medium",
    fontSize: 14,
  },
});
