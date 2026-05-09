import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  Platform,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
} from "react-native";
import { ChevronsUp } from "lucide-react-native";
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

const TICK_WIDTH = 26;
const TICK_HEIGHT = 20;
const WHEEL_STEP = TICK_WIDTH * 2;

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
  const railHostRef = useRef<any>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const activeOffsetRef = useRef(0);
  const userScrollingRef = useRef(false);
  const momentumRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const pointerDragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startOffset: number;
    moved: boolean;
  }>({ active: false, pointerId: null, startX: 0, startOffset: 0, moved: false });
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      programmaticScrollRef.current = true;
      if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
      listRef.current?.scrollToOffset({
        offset: pageToOffset(page),
        animated,
      });
      activeOffsetRef.current = pageToOffset(page);
      programmaticTimerRef.current = setTimeout(() => {
        programmaticScrollRef.current = false;
        programmaticTimerRef.current = null;
      }, animated ? 320 : 80);
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
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
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
      if (programmaticScrollRef.current) return;
      if (!userScrollingRef.current) {
        userScrollingRef.current = true;
        setDragging(true);
      }
      const offsetX = e.nativeEvent.contentOffset.x;
      activeOffsetRef.current = offsetX;
      updatePreviewFromOffset(offsetX);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        if (userScrollingRef.current && !momentumRef.current) commitFromOffset(offsetX);
      }, 180);
    },
    [commitFromOffset, updatePreviewFromOffset]
  );

  const handleScrollBeginDrag = useCallback(() => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
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
      activeOffsetRef.current = offsetX;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      fallbackTimerRef.current = setTimeout(() => {
        if (!momentumRef.current) commitFromOffset(offsetX);
      }, 160);
    },
    [commitFromOffset]
  );

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      activeOffsetRef.current = e.nativeEvent.contentOffset.x;
      commitFromOffset(e.nativeEvent.contentOffset.x);
    },
    [commitFromOffset]
  );

  const beginPointerDrag = useCallback((pointerId: number, clientX: number) => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    pointerDragRef.current = {
      active: true,
      pointerId,
      startX: clientX,
      startOffset: activeOffsetRef.current,
      moved: false,
    };
    userScrollingRef.current = true;
    momentumRef.current = false;
    setDragging(true);
  }, []);

  const updatePointerDrag = useCallback(
    (clientX: number) => {
      const state = pointerDragRef.current;
      if (!state.active) return;
      const deltaX = clientX - state.startX;
      const nextOffset = Math.max(0, Math.min(pageToOffset(1), state.startOffset + deltaX));
      if (Math.abs(deltaX) > 2) state.moved = true;
      activeOffsetRef.current = nextOffset;
      listRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
      updatePreviewFromOffset(nextOffset);
    },
    [pageToOffset, updatePreviewFromOffset]
  );

  const endPointerDrag = useCallback(() => {
    if (!pointerDragRef.current.active) return;
    pointerDragRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startOffset: 0,
      moved: false,
    };
    commitFromOffset(activeOffsetRef.current);
  }, [commitFromOffset]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const host = railHostRef.current?.getNode?.() ?? railHostRef.current;
    if (!host?.addEventListener) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      beginPointerDrag(event.pointerId, event.clientX);
    };
    const onPointerMove = (event: PointerEvent) => {
      const state = pointerDragRef.current;
      if (!state.active || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      updatePointerDrag(event.clientX);
    };
    const onPointerUp = (event: PointerEvent) => {
      const state = pointerDragRef.current;
      if (!state.active || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      endPointerDrag();
    };
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      userScrollingRef.current = true;
      momentumRef.current = false;
      setDragging(true);
      const nextOffset = Math.max(0, Math.min(pageToOffset(1), activeOffsetRef.current + (delta > 0 ? WHEEL_STEP : -WHEEL_STEP)));
      activeOffsetRef.current = nextOffset;
      listRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
      updatePreviewFromOffset(nextOffset);
      settleTimerRef.current = setTimeout(() => {
        commitFromOffset(nextOffset);
      }, 140);
    };

    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [beginPointerDrag, commitFromOffset, endPointerDrag, pageToOffset, updatePointerDrag, updatePreviewFromOffset]);

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
              width: active ? 3 : 2,
              height: active ? 16 : major ? 10 : 6,
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
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <Pressable
        onPress={onExpand}
        hitSlop={10}
        accessibilityLabel={s.goTo}
        style={({ pressed }) => ({
          height: 28,
          minWidth: 58,
          borderRadius: 999,
          paddingHorizontal: 9,
          backgroundColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,54,56,0.08)",
          flexDirection: isRTL ? "row-reverse" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        })}
      >
        <Text
          className="text-primary-accent dark:text-primary-bright"
          style={{ fontFamily: "Manrope_700Bold", fontSize: 12 }}
        >
          {toArabicNumber(livePage)}
        </Text>
        <ChevronsUp size={12} color={isDark ? "#a3a3a3" : "#003638"} />
      </Pressable>

      <View
        ref={railHostRef}
        style={{
          flex: 1,
          minWidth: 0,
          ...(Platform.OS === "web"
            ? ({ cursor: dragging ? "grabbing" : "grab", touchAction: "none", userSelect: "none" } as any)
            : null),
        }}
        onLayout={handleLayout}
      >
        {dragging && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              alignSelf: "center",
              top: -30,
              zIndex: 3,
              backgroundColor: "#003638",
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 3,
              minWidth: 96,
              alignItems: "center",
            }}
          >
            <Text
              numberOfLines={1}
              style={{ color: "#fff", fontFamily: "Manrope_600SemiBold", fontSize: 11 }}
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
            paddingTop: 4,
          }}
          style={{ height: 26 }}
          initialNumToRender={24}
          maxToRenderPerBatch={24}
          windowSize={9}
        />
      </View>
    </View>
  );
}
