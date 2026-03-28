import React, { useEffect, useRef } from "react";
import { Animated, View, type ViewProps, type DimensionValue } from "react-native";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared pulse animation hook
// ---------------------------------------------------------------------------

function usePulse(duration = 1200): Animated.Value {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
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
  }, [opacity, duration]);

  return opacity;
}

// ---------------------------------------------------------------------------
// Base Skeleton
// ---------------------------------------------------------------------------

type SkeletonProps = ViewProps & {
  /** Override dark mode detection when not using SettingsProvider */
  isDark?: boolean;
  /** Width — number (px) or percentage string ("100%") */
  width?: DimensionValue;
  /** Height — number (px) or percentage string */
  height?: DimensionValue;
  /** Border radius — number (px). Defaults to 8 */
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

  return (
    <Animated.View
      className={cn("overflow-hidden", className)}
      style={[
        {
          backgroundColor: isDark ? "#262626" : "#E8E1DA",
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

// ---------------------------------------------------------------------------
// SkeletonText — single text line placeholder
// ---------------------------------------------------------------------------

type SkeletonTextProps = ViewProps & {
  isDark?: boolean;
  /** Width of the line. Defaults to "100%" */
  width?: DimensionValue;
  /** Line height in px. Defaults to 14 */
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

// ---------------------------------------------------------------------------
// SkeletonCircle — avatar / rank badge placeholder
// ---------------------------------------------------------------------------

type SkeletonCircleProps = ViewProps & {
  isDark?: boolean;
  /** Diameter in px. Defaults to 40 */
  size?: number;
};

export const SkeletonCircle = React.memo(function SkeletonCircle({
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

// ---------------------------------------------------------------------------
// SkeletonCard — card-shaped placeholder
// ---------------------------------------------------------------------------

type SkeletonCardProps = ViewProps & {
  isDark?: boolean;
  /** Card height in px. Defaults to 120 */
  height?: number;
};

export const SkeletonCard = React.memo(function SkeletonCard({
  isDark = false,
  height = 120,
  className,
  ...props
}: SkeletonCardProps) {
  return (
    <Skeleton
      isDark={isDark}
      width="100%"
      height={height}
      borderRadius={24}
      className={cn("my-2", className)}
      {...props}
    />
  );
});

// ---------------------------------------------------------------------------
// Pre-composed: LeaderboardSkeleton
// 5 rows — rank circle | avatar circle | name line + score line
// ---------------------------------------------------------------------------

type ComposedSkeletonProps = ViewProps & {
  isDark?: boolean;
};

export const LeaderboardSkeleton = React.memo(function LeaderboardSkeleton({
  isDark = false,
  className,
  ...props
}: ComposedSkeletonProps) {
  return (
    <View className={cn("px-4 pt-4", className)} {...props}>
      {Array.from({ length: 5 }).map((_, i) => (
        <View
          key={i}
          className="flex-row items-center py-3"
          style={{ gap: 12 }}
        >
          {/* Rank badge */}
          <SkeletonCircle isDark={isDark} size={28} />
          {/* Avatar */}
          <SkeletonCircle isDark={isDark} size={40} />
          {/* Name + secondary text */}
          <View className="flex-1" style={{ gap: 6 }}>
            <SkeletonText
              isDark={isDark}
              width={i % 2 === 0 ? "60%" : "45%"}
              lineHeight={14}
            />
            <SkeletonText isDark={isDark} width="30%" lineHeight={10} />
          </View>
          {/* Score */}
          <Skeleton
            isDark={isDark}
            width={48}
            height={20}
            borderRadius={10}
          />
        </View>
      ))}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Pre-composed: ReflectionsSkeleton
// 3 reflection card placeholders
// ---------------------------------------------------------------------------

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
          {/* Author row: avatar + name + timestamp */}
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <SkeletonCircle isDark={isDark} size={32} />
            <SkeletonText isDark={isDark} width={80} lineHeight={12} />
            <View className="flex-1" />
            <SkeletonText isDark={isDark} width={40} lineHeight={10} />
          </View>
          {/* Body text lines */}
          <View style={{ gap: 4 }}>
            <SkeletonText isDark={isDark} width="100%" lineHeight={12} />
            <SkeletonText isDark={isDark} width={widths[i]} lineHeight={12} />
          </View>
          {/* Action row: like + comment */}
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

// ---------------------------------------------------------------------------
// Pre-composed: SearchResultsSkeleton
// 2 surah groups, each with header + 3 ayah result lines
// ---------------------------------------------------------------------------

export const SearchResultsSkeleton = React.memo(function SearchResultsSkeleton({
  isDark = false,
  className,
  ...props
}: ComposedSkeletonProps) {
  return (
    <View className={cn("px-4 pt-4", className)} style={{ gap: 20 }} {...props}>
      {Array.from({ length: 2 }).map((_, groupIdx) => (
        <View key={groupIdx} style={{ gap: 10 }}>
          {/* Surah header */}
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
          {/* Ayah result lines */}
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
