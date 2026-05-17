import React, { useMemo } from "react";
import {
  ScrollView,
  useWindowDimensions,
  View,
  type ScrollViewProps,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings/context";
import {
  DESKTOP_CONTENT_GUTTER,
  DESKTOP_CONTENT_MAX_WIDTH,
  PERSISTENT_SIDEBAR_BREAKPOINT,
  PERSISTENT_SIDEBAR_WIDTH,
} from "@/lib/ui/viewport";

type ScreenRailProps = ViewProps & {
  maxWidth?: number;
};

type ScreenScrollViewProps = ScrollViewProps & {
  maxWidth?: number;
  phoneGutter?: number;
  desktopGutter?: number;
  contentClassName?: string;
  children: React.ReactNode;
};

export function useScreenContentLayout({
  maxWidth = DESKTOP_CONTENT_MAX_WIDTH,
  phoneGutter = 24,
  desktopGutter = DESKTOP_CONTENT_GUTTER,
}: {
  maxWidth?: number;
  phoneGutter?: number;
  desktopGutter?: number;
} = {}) {
  const { width } = useWindowDimensions();
  const { isRTL } = useSettings();
  const hasPersistentSidebar = width >= PERSISTENT_SIDEBAR_BREAKPOINT;
  const sideWithSidebar = hasPersistentSidebar ? PERSISTENT_SIDEBAR_WIDTH + desktopGutter : phoneGutter;
  const openSide = hasPersistentSidebar ? desktopGutter : phoneGutter;

  const contentContainerStyle = useMemo<ViewStyle>(
    () => ({
      alignItems: "center",
      paddingLeft: isRTL ? openSide : sideWithSidebar,
      paddingRight: isRTL ? sideWithSidebar : openSide,
    }),
    [isRTL, openSide, sideWithSidebar]
  );

  const railStyle = useMemo<ViewStyle>(
    () => ({
      width: "100%",
      maxWidth,
    }),
    [maxWidth]
  );

  return {
    hasPersistentSidebar,
    isLaptop: hasPersistentSidebar,
    contentContainerStyle,
    railStyle,
  };
}

export function ScreenRail({ maxWidth = DESKTOP_CONTENT_MAX_WIDTH, className, style, ...props }: ScreenRailProps) {
  return (
    <View
      className={cn("w-full", className)}
      style={[{ maxWidth }, style]}
      {...props}
    />
  );
}

export function ScreenScrollView({
  maxWidth = DESKTOP_CONTENT_MAX_WIDTH,
  phoneGutter = 24,
  desktopGutter = DESKTOP_CONTENT_GUTTER,
  className,
  contentClassName,
  contentContainerStyle,
  children,
  ...props
}: ScreenScrollViewProps) {
  const { contentContainerStyle: railContainerStyle, railStyle } = useScreenContentLayout({
    maxWidth,
    phoneGutter,
    desktopGutter,
  });

  return (
    <ScrollView
      className={cn("flex-1", className)}
      contentContainerStyle={[railContainerStyle, contentContainerStyle]}
      {...props}
    >
      <View className={cn("w-full", contentClassName)} style={railStyle}>
        {children}
      </View>
    </ScrollView>
  );
}
