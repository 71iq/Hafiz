import React, { useMemo } from "react";
import { ScrollView, useWindowDimensions, View, type ScrollViewProps, type ViewStyle } from "react-native";
import { SafeAreaView, type SafeAreaViewProps } from "react-native-safe-area-context";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings/context";
import {
  DESKTOP_CONTENT_GUTTER,
  DESKTOP_CONTENT_MAX_WIDTH,
  FLOATING_NAV_TRIGGER_SIZE,
  PERSISTENT_SIDEBAR_BREAKPOINT,
  PERSISTENT_SIDEBAR_WIDTH,
  SIDEBAR_BREAKPOINT,
  VIEWPORT_BREAKPOINTS,
} from "@/lib/ui/viewport";

export const PHONE_CONTENT_GUTTER = 16;

export const TAB_SCREEN_BOTTOM_INSET = 100;
export const COMPACT_SCREEN_BOTTOM_INSET = 48;

type ScreenBackground = "surface" | "low" | "dim";

const screenBackgroundClassNames: Record<ScreenBackground, string> = {
  surface: "bg-surface dark:bg-surface-dark",
  low: "bg-surface-low dark:bg-surface-dark-low",
  dim: "bg-surface-dim dark:bg-surface-dark-dim",
};

type ScreenProps = SafeAreaViewProps & {
  background?: ScreenBackground;
  children: React.ReactNode;
};

type ScreenScrollViewProps = ScrollViewProps & {
  maxWidth?: number;
  phoneGutter?: number;
  desktopGutter?: number;
  topInset?: number;
  bottomInset?: number;
  contentClassName?: string;
  ref?: React.Ref<ScrollView>;
  children: React.ReactNode;
};

export function Screen({ background = "surface", className, children, ...props }: ScreenProps) {
  return (
    <SafeAreaView className={cn("flex-1", screenBackgroundClassNames[background], className)} {...props}>
      {children}
    </SafeAreaView>
  );
}

export function useScreenContentLayout({
  maxWidth = DESKTOP_CONTENT_MAX_WIDTH,
  phoneGutter = PHONE_CONTENT_GUTTER,
  desktopGutter = DESKTOP_CONTENT_GUTTER,
}: {
  maxWidth?: number;
  phoneGutter?: number;
  desktopGutter?: number;
} = {}) {
  const { width } = useWindowDimensions();
  const { isRTL } = useSettings();
  const hasPersistentSidebar = width >= PERSISTENT_SIDEBAR_BREAKPOINT;
  const hasEdgeTrigger = !hasPersistentSidebar && width >= SIDEBAR_BREAKPOINT;
  const phoneSide = width < VIEWPORT_BREAKPOINTS.phoneCompact ? Math.min(phoneGutter, 12) : phoneGutter;
  const sideWithSidebar = hasPersistentSidebar
    ? PERSISTENT_SIDEBAR_WIDTH + desktopGutter
    : hasEdgeTrigger
      ? FLOATING_NAV_TRIGGER_SIZE + 8
      : phoneSide;
  const openSide = hasPersistentSidebar || hasEdgeTrigger ? desktopGutter : phoneSide;

  const contentContainerStyle = useMemo<ViewStyle>(
    () => ({
      alignItems: "center",
      paddingLeft: isRTL ? openSide : sideWithSidebar,
      paddingRight: isRTL ? sideWithSidebar : openSide,
    }),
    [isRTL, openSide, sideWithSidebar],
  );

  const railStyle = useMemo<ViewStyle>(
    () => ({
      width: "100%",
      maxWidth,
    }),
    [maxWidth],
  );

  return {
    hasPersistentSidebar,
    isLaptop: hasPersistentSidebar,
    contentContainerStyle,
    railStyle,
  };
}

export function ScreenScrollView({
  maxWidth = DESKTOP_CONTENT_MAX_WIDTH,
  phoneGutter = PHONE_CONTENT_GUTTER,
  desktopGutter = DESKTOP_CONTENT_GUTTER,
  topInset = 0,
  bottomInset = 0,
  className,
  contentClassName,
  contentContainerStyle,
  contentInsetAdjustmentBehavior = "automatic",
  keyboardShouldPersistTaps = "handled",
  showsVerticalScrollIndicator = false,
  children,
  ...props
}: ScreenScrollViewProps) {
  const { contentContainerStyle: railContainerStyle, railStyle } = useScreenContentLayout({
    maxWidth,
    phoneGutter,
    desktopGutter,
  });
  const insetStyle = useMemo<ViewStyle>(
    () => ({
      paddingTop: topInset,
      paddingBottom: bottomInset,
    }),
    [bottomInset, topInset],
  );

  return (
    <ScrollView
      className={cn("flex-1", className)}
      contentContainerStyle={[railContainerStyle, insetStyle, contentContainerStyle]}
      contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      {...props}
    >
      <View className={cn("w-full", contentClassName)} style={railStyle}>
        {children}
      </View>
    </ScrollView>
  );
}
