import { useState, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  PanResponder,
  type LayoutChangeEvent,
} from "react-native";
import { ChevronUp } from "lucide-react-native";
import { toArabicNumber } from "@/lib/arabic";
import { useSettings } from "@/lib/settings/context";
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

const TRACK_HEIGHT = 4;
const THUMB_SIZE = 18;

export function MushafSlider({
  currentPage,
  max = 604,
  onCommit,
  onPreview,
  onExpand,
  index,
}: Props) {
  const { isRTL, isDark } = useSettings();
  const [trackWidth, setTrackWidth] = useState(0);
  const trackXRef = useRef(0);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    // measureInWindow gets the page-X for absolute touch math
    (e.target as any)?.measureInWindow?.((x: number) => {
      trackXRef.current = x;
    });
  }, []);

  const xToPage = useCallback(
    (touchPageX: number): number => {
      if (trackWidth <= 0) return currentPage;
      const local = Math.max(0, Math.min(trackWidth, touchPageX - trackXRef.current));
      const ratioLtr = local / trackWidth;
      // RTL: thumb on the right means low page; on the left means high page.
      const ratio = isRTL ? 1 - ratioLtr : ratioLtr;
      return Math.max(1, Math.min(max, Math.round(1 + ratio * (max - 1))));
    },
    [trackWidth, currentPage, max, isRTL]
  );

  const pageToOffset = useCallback(
    (page: number): number => {
      if (trackWidth <= 0) return 0;
      const ratio = (Math.max(1, Math.min(max, page)) - 1) / Math.max(1, max - 1);
      const ltrOffset = ratio * trackWidth;
      return isRTL ? trackWidth - ltrOffset : ltrOffset;
    },
    [trackWidth, max, isRTL]
  );

  const livePage = previewPage ?? currentPage;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          setDragging(true);
          const p = xToPage(e.nativeEvent.pageX);
          setPreviewPage(p);
          onPreview?.(p);
        },
        onPanResponderMove: (e) => {
          const p = xToPage(e.nativeEvent.pageX);
          setPreviewPage(p);
          onPreview?.(p);
        },
        onPanResponderRelease: (e) => {
          const p = xToPage(e.nativeEvent.pageX);
          setDragging(false);
          setPreviewPage(null);
          onCommit(p);
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          setPreviewPage(null);
        },
      }),
    [xToPage, onCommit, onPreview]
  );

  const surahName = index?.pageByNumber.get(livePage)
    ? index.surahByNumber.get(index.pageByNumber.get(livePage)!.surah_start)?.name_arabic ?? null
    : null;

  const thumbOffset = pageToOffset(livePage) - THUMB_SIZE / 2;

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
      {/* Expand button */}
      <Pressable
        onPress={onExpand}
        hitSlop={10}
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

      {/* Track + thumb */}
      <View style={{ flex: 1, height: 28, justifyContent: "center" }} {...panResponder.panHandlers}>
        <View
          onLayout={onTrackLayout}
          style={{
            height: TRACK_HEIGHT,
            borderRadius: TRACK_HEIGHT / 2,
            backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,54,56,0.15)",
          }}
        />
        {trackWidth > 0 && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 14 - THUMB_SIZE / 2,
              left: thumbOffset,
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              backgroundColor: "#0d9488",
              shadowColor: "#003638",
              shadowOpacity: 0.18,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 3,
            }}
          />
        )}
        {/* Floating preview label while dragging */}
        {dragging && trackWidth > 0 && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: Math.max(0, Math.min(trackWidth - 110, thumbOffset - 50 + THUMB_SIZE / 2)),
              top: -34,
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
      </View>
    </View>
  );
}
