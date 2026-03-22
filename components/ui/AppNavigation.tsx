import { View, Pressable, Text, Platform, StyleSheet, useWindowDimensions } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useColorScheme } from "nativewind";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ACTIVE_BG = "#1B4D4F";
const ACTIVE_TEXT = "#FDDC91";
const INACTIVE_LIGHT = "rgba(45, 45, 45, 0.5)";
const INACTIVE_DARK = "rgba(232, 225, 218, 0.5)";
const BAR_BG_LIGHT = "rgba(255, 248, 241, 0.80)";
const BAR_BG_DARK = "rgba(28, 25, 23, 0.80)";
const SIDEBAR_BG_LIGHT = "#FFF8F1";
const SIDEBAR_BG_DARK = "#0A0A0A";

export const SIDEBAR_BREAKPOINT = 768;
export const SIDEBAR_WIDTH = 220;

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

  return (
    <View
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
    </View>
  );
}

// ─── Sidebar (desktop) ──────────────────────────────────────

function SidebarItem({
  route,
  descriptor,
  isFocused,
  onPress,
  isDark,
}: {
  route: any;
  descriptor: any;
  isFocused: boolean;
  onPress: () => void;
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
      onPressIn={() => { scale.value = withSpring(0.96, { damping: 15, stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 400 }); }}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      style={[animatedStyle, styles.sidebarItem, isFocused && styles.sidebarItemActive]}
    >
      {options.tabBarIcon?.({ focused: isFocused, color: iconColor, size: 20 })}
      <Text style={[styles.sidebarLabel, { color: iconColor }]}>{label}</Text>
    </AnimatedPressable>
  );
}

function Sidebar(props: BottomTabBarProps) {
  const { state, descriptors, navigation } = props;
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const visibleRoutes = getVisibleRoutes(state, descriptors);

  return (
    <View
      style={[
        styles.sidebarContainer,
        {
          backgroundColor: isDark ? SIDEBAR_BG_DARK : SIDEBAR_BG_LIGHT,
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
        },
      ]}
    >
      {/* App title */}
      <View style={styles.sidebarHeader}>
        <Text style={[styles.sidebarTitle, { color: isDark ? "#E8E1DA" : "#003638" }]}>
          Hafiz
        </Text>
        <Text style={[styles.sidebarSubtitle, { color: isDark ? "#525252" : "#b9a085" }]}>
          The Digital Sanctuary
        </Text>
      </View>

      {/* Nav items */}
      <View style={styles.sidebarNav}>
        {visibleRoutes.map((route) => {
          const descriptor = descriptors[route.key];
          const isFocused = state.index === state.routes.indexOf(route);
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };

          return (
            <SidebarItem
              key={route.key}
              route={route}
              descriptor={descriptor}
              isFocused={isFocused}
              onPress={onPress}
              isDark={isDark}
            />
          );
        })}
      </View>
    </View>
  );
}

// ─── Responsive wrapper ─────────────────────────────────────

export function AppNavigation(props: BottomTabBarProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= SIDEBAR_BREAKPOINT;

  if (isWide) {
    return <Sidebar {...props} />;
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
    paddingHorizontal: 20,
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
  // Sidebar
  sidebarContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    paddingHorizontal: 16,
    // Subtle right edge shadow
    shadowColor: "#003638",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.03,
    shadowRadius: 16,
    elevation: 4,
    zIndex: 50,
  },
  sidebarHeader: {
    paddingHorizontal: 12,
    paddingBottom: 32,
  },
  sidebarTitle: {
    fontFamily: "NotoSerif_700Bold",
    fontSize: 22,
  },
  sidebarSubtitle: {
    fontFamily: "Manrope_400Regular",
    fontSize: 11,
    marginTop: 2,
  },
  sidebarNav: {
    gap: 4,
  },
  sidebarItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
  },
  sidebarItemActive: {
    backgroundColor: ACTIVE_BG,
  },
  sidebarLabel: {
    fontFamily: "Manrope_500Medium",
    fontSize: 14,
  },
});
