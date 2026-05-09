import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
} from "react-native";
import { ChevronUp } from "lucide-react-native";
import { toArabicNumber } from "@/lib/arabic";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";
import type { MushafIndex } from "@/lib/mushaf/position";

type Props = {
  /** Current page (1-604) */
  currentPage: number;
  /** Active range — 1..max */
  max?: number;
  /** Called when user releases the thumb on a page */
  onCommit: (page: number) => void;
  /** Called continuously while dragging (for the floating label) */
  onPreview?: (page: number) => void;
  /** Tap the expand chevron → opens GoToNavigator */
  onExpand: () => void;
  index: MushafIndex | null;
};

const TICK_WIDTH = 38;
const TICK_HEIGHT = 30;

export function MushafSlider({
  currentPage,
  max = 604,
  onCommit,
  onPreview,
  onExpand,
  index,
}: Props) {
  const { isRTL, isDark } = useSettings();
  const s = useStrings();
  const listRef = useRef<FlatList<number>>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const userScrollingRef = useRef(false);
  const momentumRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewRef = useRef(currentPage);
  const lastCommitRef = useRef(currentPage);

  const pages = useMemo(
    () => Array.from({ length: max }, (_, index) => max - index),
    [max]
  );

  const centerPadding = Math.max(0, (viewportWidth - TICK_WIDTH) / 2);

  const pageToOffset = useCallback(
    (page: number) => (max - Math.max(1, Math.min(max, page))) * TICK_WIDTH,
    [max]
  );

  const offsetToPage = useCallback(
    (offsetX: number) => {
      const index = Math.round(Math.max(0, offsetX) / TICK_WIDTH);
      return Math.max(1, Math.min(max, max - index));
    },
    [max]
  );

  const scrollToPage = useCallback(
    (page: number, animated: boolean) => {
      if (!viewportWidth) return;
      listRef.current?.scrollToOffset({
        offset: pageToOffset(page),
        animated,
      });
    },
    [pageToOffset, viewportWidth]
  );

  useEffect(() => {
    lastPreviewRef.current = currentPage;
    lastCommitRef.current = currentPage;
    if (!userScrollingRef.current) {
      setPreviewPage(null);
      scrollToPage(currentPage, false);
    }
  }, [currentPage, scrollToPage]);

  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  const updatePreviewFromOffset = useCallback(
    (offsetX: number) => {
      const page = offsetToPage(offsetX);
      if (page === lastPreviewRef.current) return;
      lastPreviewRef.current = page;
      setPreviewPage(page);
      onPreview?.(page);
    },
    [offsetToPage, onPreview]
  );

  const commitFromOffset = useCallback(
    (offsetX: number) => {
      const page = offsetToPage(offsetX);
      userScrollingRef.current = false;
      momentumRef.current = false;
      setDragging(false);
      setPreviewPage(null);
      lastPreviewRef.current = page;
      if (lastCommitRef.current !== page) {
        lastCommitRef.current = page;
        onCommit(page);
      }
      scrollToPage(page, true);
    },
    [offsetToPage, onCommit, scrollToPage]
  );

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      setViewportWidth(e.nativeEvent.layout.width);
    },
    []
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!userScrollingRef.current) return;
      updatePreviewFromOffset(e.nativeEvent.contentOffset.x);
    },
    [updatePreviewFromOffset]
  );

  const handleScrollBeginDrag = useCallback(() => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    userScrollingRef.current = true;
    momentumRef.current = false;
    setDragging(true);
  }, []);

  const handleMomentumScrollBegin = useCallback(() => {
    momentumRef.current = true;
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
  }, []);

  const handleScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = e.nativeEvent.contentOffset.x;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = setTimeout(() => {
        if (!momentumRef.current) commitFromOffset(offsetX);
      }, 120);
    },
    [commitFromOffset]
  );

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      commitFromOffset(e.nativeEvent.contentOffset.x);
    },
    [commitFromOffset]
  );

  const livePage = previewPage ?? currentPage;
  const surahName = index?.pageByNumber.get(livePage)
    ? index.surahByNumber.get(index.pageByNumber.get(livePage)!.surah_start)?.name_arabic ?? null
    : null;

  const renderTick = useCallback(
    ({ item }: ListRenderItemInfo<number>) => {
      const distance = Math.abs(item - livePage);
      const active = distance === 0;
      const major = item === 1 || item === max || item % 20 === 0;
      return (
        <View style={{ width: TICK_WIDTH, height: TICK_HEIGHT, alignItems: "center", justifyContent: "center" }}>
          <View
            style={{
              width: active ? 4 : 2,
              height: active ? 22 : major ? 14 : 8,
              borderRadius: 2,
              backgroundColor: active
                ? "#0d9488"
                : isDark
                  ? "rgba(255,255,255,0.2)"
                  : "rgba(0,54,56,0.22)",
            }}
          />
        </View>
      );
    },
    [isDark, livePage, max]
  );

  return (
    <View
      pointerEvents="box-none"
      style={{
        flexDirection: isRTL ? "row-reverse" : "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
      }}
    >
      <Pressable
        onPress={onExpand}
        hitSlop={10}
        accessibilityLabel={s.goTo}
        style={({ pressed }) => ({
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,54,56,0.08)",
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: pressed ? 0.95 : 1 }],
        })}
      >
        <ChevronUp size={16} color={isDark ? "#a3a3a3" : "#003638"} />
      </Pressable>

      <View style={{ flex: 1, minWidth: 0 }} onLayout={handleLayout}>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: -3,
            zIndex: 2,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: isDark ? "#8a8a8a" : "#8B8178", fontFamily: "Manrope_500Medium", fontSize: 10 }}>
            {toArabicNumber(max)}
          </Text>
          <Text style={{ color: isDark ? "#8a8a8a" : "#8B8178", fontFamily: "Manrope_500Medium", fontSize: 10 }}>
            {toArabicNumber(1)}
          </Text>
        </View>

        {dragging && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              alignSelf: "center",
              top: -34,
              zIndex: 3,
              backgroundColor: "#003638",
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 4,
              minWidth: 110,
              alignItems: "center",
            }}
          >
            <Text
              numberOfLines={1}
              style={{ color: "#fff", fontFamily: "Manrope_600SemiBold", fontSize: 12 }}
            >
              {surahName ? `${surahName} · ` : ""}
              {`ص ${toArabicNumber(livePage)}`}
            </Text>
          </View>
        )}

        <FlatList
          ref={listRef}
          horizontal
          data={pages}
          renderItem={renderTick}
          keyExtractor={(item) => `p-${item}`}
          getItemLayout={(_, index) => ({
            length: TICK_WIDTH,
            offset: TICK_WIDTH * index,
            index,
          })}
          showsHorizontalScrollIndicator={false}
          snapToInterval={TICK_WIDTH}
          decelerationRate="fast"
          disableIntervalMomentum
          scrollEventThrottle={16}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onMomentumScrollBegin={handleMomentumScrollBegin}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          contentContainerStyle={{
            paddingLeft: centerPadding,
            paddingRight: centerPadding,
            paddingTop: 8,
          }}
          style={{ height: 38 }}
          initialNumToRender={24}
          maxToRenderPerBatch={24}
          windowSize={9}
        />
      </View>

      <View style={{ width: 44, alignItems: "center" }} pointerEvents="none">
        <Text
          className="text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 13 }}
        >
          {toArabicNumber(livePage)}
        </Text>
      </View>
    </View>
  );
}
