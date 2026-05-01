import { View, Pressable, Text, Platform, StyleSheet } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useColorScheme } from "nativewind";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ACTIVE_BG = "#1B4D4F"; // primary-container
const ACTIVE_TEXT = "#FDDC91"; // gold
const INACTIVE_LIGHT = "rgba(45, 45, 45, 0.5)"; // charcoal/50
const INACTIVE_DARK = "rgba(232, 225, 218, 0.5)"; // surface-high/50
const BAR_BG_LIGHT = "rgba(255, 248, 241, 0.80)"; // surface/80
const BAR_BG_DARK = "rgba(28, 25, 23, 0.80)"; // stone-900/80
const SHADOW_COLOR = "rgba(0, 54, 56, 0.04)";

function TabItem({
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

  const handlePressIn = () => {
    scale.value = withSpring(0.9, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const { options } = descriptor;
  const label = options.title ?? route.name;
  const iconColor = isFocused
    ? ACTIVE_TEXT
    : isDark
      ? INACTIVE_DARK
      : INACTIVE_LIGHT;

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={options.tabBarAccessibilityLabel}
      style={[
        animatedStyle,
        styles.tabItem,
        isFocused && styles.tabItemActive,
      ]}
    >
      {options.tabBarIcon?.({
        focused: isFocused,
        color: iconColor,
        size: 22,
      })}
      <Text
        style={[
          styles.label,
          { color: iconColor },
        ]}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

export function CustomTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  // Filter out routes with href: null (expo-router sets tabBarItemStyle.display: 'none')
  const visibleRoutes = state.routes.filter((route) => {
    const { options } = descriptors[route.key];
    const itemStyle = options.tabBarItemStyle as any;
    return !(itemStyle && itemStyle.display === "none");
  });

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 12),
          backgroundColor: isDark ? BAR_BG_DARK : BAR_BG_LIGHT,
          ...Platform.select({
            web: {
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
            } as any,
            default: {
              // On native without expo-blur, use slightly higher opacity
              backgroundColor: isDark
                ? "rgba(28, 25, 23, 0.95)"
                : "rgba(255, 248, 241, 0.95)",
            },
          }),
        },
      ]}
    >
      {visibleRoutes.map((route) => {
        const descriptor = descriptors[route.key];
        const isFocused = state.index === state.routes.indexOf(route);

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: "tabLongPress",
            target: route.key,
          });
        };

        return (
          <TabItem
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

const styles = StyleSheet.create({
  container: {
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
    // Teal-tinted ambient shadow
    shadowColor: "#003638",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    elevation: 5,
  },
  tabItem: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 9999,
  },
  tabItemActive: {
    backgroundColor: ACTIVE_BG,
  },
  label: {
    fontFamily: "Manrope_500Medium",
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 2,
  },
});
