import { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutRectangle,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { textStartStyle } from "@/lib/ui/direction";

export type DetailTab<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  tabs: readonly DetailTab<K>[];
  activeKey: K;
  onChange: (key: K) => void;
  isRTL: boolean;
  backgroundColor: string;
  accessibilityLabel?: string;
};

const FADE_WIDTH = 16;

export function DetailTabRow<K extends string>({
  tabs,
  activeKey,
  onChange,
  isRTL,
  backgroundColor,
  accessibilityLabel,
}: Props<K>) {
  const scrollRef = useRef<ScrollView>(null);
  const chipLayouts = useRef(new Map<K, LayoutRectangle>());
  const chipNodes = useRef(new Map<K, unknown>());
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [offset, setOffset] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web") {
      const node = chipNodes.current.get(activeKey) as
        | { scrollIntoView?: (options: ScrollIntoViewOptions) => void }
        | undefined;
      node?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return;
    }
    const layout = chipLayouts.current.get(activeKey);
    if (!layout || viewportWidth === 0) return;
    const visibleStart = offset;
    const visibleEnd = offset + viewportWidth;
    if (layout.x >= visibleStart && layout.x + layout.width <= visibleEnd) return;
    const x = layout.x < visibleStart ? layout.x - FADE_WIDTH : layout.x + layout.width - viewportWidth + FADE_WIDTH;
    scrollRef.current?.scrollTo({ x: Math.max(0, x), animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, layoutVersion, viewportWidth]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setOffset(Math.abs(event.nativeEvent.contentOffset.x));
  };

  const overflow = contentWidth - viewportWidth > 1;
  const hiddenBefore = overflow && offset > 1;
  const hiddenAfter = overflow && offset + viewportWidth < contentWidth - 1;
  const showLeftFade = isRTL ? hiddenAfter : hiddenBefore;
  const showRightFade = isRTL ? hiddenBefore : hiddenAfter;

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={(event) => setViewportWidth(Math.round(event.nativeEvent.layout.width))}
      style={{ position: "relative" }}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        onContentSizeChange={(width) => setContentWidth(Math.round(width))}
        contentContainerStyle={{
          direction: isRTL ? "rtl" : "ltr",
          flexDirection: "row",
          gap: 8,
          paddingVertical: 2,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <Pressable
              key={tab.key}
              ref={(node) => {
                if (node) chipNodes.current.set(tab.key, node);
                else chipNodes.current.delete(tab.key);
              }}
              onLayout={(event) => {
                chipLayouts.current.set(tab.key, event.nativeEvent.layout);
                if (active) setLayoutVersion((value) => value + 1);
              }}
              onPress={() => onChange(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              aria-selected={active}
              className={`items-center justify-center rounded-full px-4 ${
                active ? "bg-primary-accent/10 dark:bg-primary-bright/10" : "bg-surface-low dark:bg-surface-dark-low"
              }`}
              style={({ pressed }) => ({
                minHeight: 44,
                flexShrink: 0,
                opacity: pressed ? 0.8 : 1,
                cursor: Platform.OS === "web" ? "pointer" : undefined,
              })}
            >
              <Text
                numberOfLines={1}
                className={
                  active ? "text-primary-muted dark:text-primary-bright" : "text-warm-600 dark:text-neutral-300"
                }
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  fontSize: 13,
                  ...textStartStyle(isRTL),
                  writingDirection: isRTL ? "rtl" : "ltr",
                  ...(Platform.OS === "web" ? ({ whiteSpace: "nowrap" } as object) : null),
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {showLeftFade ? <EdgeFade side="left" color={backgroundColor} /> : null}
      {showRightFade ? <EdgeFade side="right" color={backgroundColor} /> : null}
    </View>
  );
}

function EdgeFade({ side, color }: { side: "left" | "right"; color: string }) {
  const id = `detail-tab-fade-${side}`;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, width: FADE_WIDTH, [side]: 0 }}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1={side === "left" ? "1" : "0"} y1="0" x2={side === "left" ? "0" : "1"} y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
