import React, { useEffect, useRef } from "react";
import { Animated, View, type ViewProps, type DimensionValue } from "react-native";
import { useSettings } from "@/lib/settings/context";
import { cn } from "@/lib/utils";
import { useReducedMotionPreference } from "@/lib/ui/reduced-motion";


function usePulse(duration = 1200): Animated.Value {
  const reduceMotion = useReducedMotionPreference();
  const opacity = useRef(new Animated.Value(reduceMotion ? 0.5 : 0.3)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.5);
      return;
    }
    opacity.setValue(0.3);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, duration, reduceMotion]);

  return opacity;
}


type SkeletonProps = ViewProps & {
  isDark?: boolean;
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
};

export const Skeleton = React.memo(function Skeleton({
  isDark = false,
  width,
  height,
  borderRadius = 8,
  className,
  style,
  ...props
}: SkeletonProps) {
  const opacity = usePulse();
  const { themeColors } = useSettings();
  const backgroundColor = themeColors.surfaceHigh;

  return (
    <Animated.View
      className={cn("overflow-hidden", className)}
      style={[
        {
          backgroundColor,
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
      {...props}
    />
  );
});


type SkeletonTextProps = ViewProps & {
  isDark?: boolean;
  width?: DimensionValue;
  lineHeight?: number;
};

export const SkeletonText = React.memo(function SkeletonText({
  isDark = false,
  width = "100%",
  lineHeight = 14,
  className,
  ...props
}: SkeletonTextProps) {
  return (
    <Skeleton
      isDark={isDark}
      width={width}
      height={lineHeight}
      borderRadius={7}
      className={cn("my-1", className)}
      {...props}
    />
  );
});

type SkeletonCircleProps = ViewProps & {
  isDark?: boolean;
  size?: number;
};

const SkeletonCircle = React.memo(function SkeletonCircle({
  isDark = false,
  size = 40,
  className,
  ...props
}: SkeletonCircleProps) {
  return (
    <Skeleton
      isDark={isDark}
      width={size}
      height={size}
      borderRadius={size / 2}
      className={className}
      {...props}
    />
  );
});


type ComposedSkeletonProps = ViewProps & {
  isDark?: boolean;
};


export const ReflectionsSkeleton = React.memo(function ReflectionsSkeleton({
  isDark = false,
  className,
  ...props
}: ComposedSkeletonProps) {
  const widths: DimensionValue[] = ["90%", "75%", "85%"];

  return (
    <View className={cn("px-4 pt-2", className)} style={{ gap: 16 }} {...props}>
      {Array.from({ length: 3 }).map((_, i) => (
        <View
          key={i}
          className="rounded-3xl p-4"
          style={{
            backgroundColor: isDark
              ? "rgba(38,38,38,0.5)"
              : "rgba(232,225,218,0.45)",
            gap: 10,
          }}
        >
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <SkeletonCircle isDark={isDark} size={32} />
            <SkeletonText isDark={isDark} width={80} lineHeight={12} />
            <View className="flex-1" />
            <SkeletonText isDark={isDark} width={40} lineHeight={10} />
          </View>
          <View style={{ gap: 4 }}>
            <SkeletonText isDark={isDark} width="100%" lineHeight={12} />
            <SkeletonText isDark={isDark} width={widths[i]} lineHeight={12} />
          </View>
          <View className="flex-row items-center" style={{ gap: 16 }}>
            <Skeleton
              isDark={isDark}
              width={50}
              height={16}
              borderRadius={8}
            />
            <Skeleton
              isDark={isDark}
              width={50}
              height={16}
              borderRadius={8}
            />
          </View>
        </View>
      ))}
    </View>
  );
});


export const SearchResultsSkeleton = React.memo(function SearchResultsSkeleton({
  isDark = false,
  className,
  ...props
}: ComposedSkeletonProps) {
  return (
    <View className={cn("px-4 pt-4", className)} style={{ gap: 20 }} {...props}>
      {Array.from({ length: 2 }).map((_, groupIdx) => (
        <View key={groupIdx} style={{ gap: 10 }}>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Skeleton
              isDark={isDark}
              width={24}
              height={24}
              borderRadius={12}
            />
            <SkeletonText isDark={isDark} width={120} lineHeight={16} />
            <View className="flex-1" />
            <Skeleton
              isDark={isDark}
              width={32}
              height={18}
              borderRadius={9}
            />
          </View>
          {Array.from({ length: 3 }).map((_, lineIdx) => (
            <View
              key={lineIdx}
              className="pl-8"
              style={{ gap: 4 }}
            >
              <SkeletonText
                isDark={isDark}
                width={lineIdx === 2 ? "65%" : "90%"}
                lineHeight={13}
              />
              <SkeletonText isDark={isDark} width="40%" lineHeight={10} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
});
