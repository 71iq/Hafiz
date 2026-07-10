import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useWordInteraction, type TooltipPosition } from "@/lib/word/context";
import { fetchWordTranslation, fetchWordMeaningAr } from "@/lib/word/queries";
import { useSettings } from "@/lib/settings/context";
import { useStrings } from "@/lib/i18n/useStrings";

const TOOLTIP_HEIGHT = 36;
const ARROW_SIZE = 6;
const GAP = 6;
const SIDE_MARGIN = 8;
const MAX_TOOLTIP_WIDTH = 320;
const DISMISS_DRAG_DISTANCE = 8;
const WORD_TOKEN_SELECTOR = "[data-hafiz-quran-token='word']";
const TOOLTIP_SELECTOR = "[data-hafiz-word-tooltip='true']";

function closestMatches(target: EventTarget | null, selector: string) {
  if (!target || typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest(selector));
}

function TooltipPopup({
  position,
  translation,
  isRTL,
  onPress,
  onHoverIn,
  onHoverOut,
}: {
  position: TooltipPosition;
  translation: string | null;
  isRTL: boolean;
  onPress: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
}) {
  const [tooltipWidth, setTooltipWidth] = useState(0);
  const TooltipChevron = isRTL ? ChevronLeft : ChevronRight;

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 400;
  const maxTooltipWidth = Math.min(MAX_TOOLTIP_WIDTH, viewportWidth - SIDE_MARGIN * 2);
  const maxTextWidth = Math.max(80, maxTooltipWidth - 45);
  const centerX = position.x + position.width / 2;
  const left =
    tooltipWidth > 0
      ? Math.max(SIDE_MARGIN, Math.min(centerX - tooltipWidth / 2, viewportWidth - tooltipWidth - SIDE_MARGIN))
      : centerX;
  const top = position.y - TOOLTIP_HEIGHT - ARROW_SIZE - GAP;

  return (
    <Pressable
      onPress={onPress}
      {...(Platform.OS === "web" ? ({ dataSet: { hafizWordTooltip: "true" } } as any) : null)}
      // @ts-ignore — position:'fixed' is valid CSS/RN-Web but not in RN types
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9999,
        opacity: tooltipWidth > 0 ? 1 : 0,
        // @ts-ignore — cursor is valid on web
        cursor: "pointer",
        maxWidth: maxTooltipWidth,
      }}
      onLayout={(e) => setTooltipWidth(e.nativeEvent.layout.width)}
      {...(onHoverIn && { onHoverIn })}
      {...(onHoverOut && { onHoverOut })}
    >
      <View
        style={{
          backgroundColor: "#003638", // primary deep teal
          borderRadius: 20, // pill shape
          paddingHorizontal: 14,
          paddingVertical: 8,
          direction: "ltr",
          flexDirection: isRTL ? "row-reverse" : "row",
          alignItems: "center",
          gap: 5,
          maxWidth: maxTooltipWidth,
          // Ambient teal-tinted shadow
          shadowColor: "#003638",
          shadowOpacity: 0.04,
          shadowRadius: 32,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Text
          style={{
            color: "#fff",
            fontSize: 13,
            fontFamily: "Manrope_500Medium",
            maxWidth: maxTextWidth,
            overflow: "hidden",
            // @ts-ignore — whiteSpace is valid CSS on web
            whiteSpace: "nowrap",
            textAlign: isRTL ? "right" : "left",
            writingDirection: isRTL ? "rtl" : "ltr",
          }}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {translation ?? "…"}
        </Text>
        <TooltipChevron size={12} color="rgba(255,255,255,0.6)" />
      </View>
      {/* Down-pointing caret */}
      <View
        style={{
          alignSelf: "center",
          width: 0,
          height: 0,
          borderLeftWidth: ARROW_SIZE,
          borderRightWidth: ARROW_SIZE,
          borderTopWidth: ARROW_SIZE,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: "#003638",
        }}
      />
    </Pressable>
  );
}

export function FloatingWordTooltip() {
  const { tooltipWord, tooltipPosition, openDetail, cancelTooltipClear, clearTooltip, clearTooltipDelayed } =
    useWordInteraction();
  const db = useDatabase();
  const { isRTL, uiLanguage } = useSettings();
  const s = useStrings();
  const [translation, setTranslation] = useState<string | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!tooltipWord) return;
    setTranslation(null);
    const { surah, ayah, wordPos } = tooltipWord;
    if (uiLanguage === "ar") {
      fetchWordMeaningAr(db, surah, ayah, wordPos)
        .then((row) => {
          if (row?.meaning) {
            setTranslation(row.meaning);
            return;
          }
          setTranslation(s.noWordMeaningFallback);
        })
        .catch(() => setTranslation(s.noWordMeaningFallback));
    } else {
      fetchWordTranslation(db, surah, ayah, wordPos).then((row) => setTranslation(row?.translation_en ?? "—"));
    }
  }, [db, s.noWordMeaningFallback, tooltipWord?.surah, tooltipWord?.ayah, tooltipWord?.wordPos, uiLanguage]);

  useEffect(() => {
    if (!tooltipWord || Platform.OS !== "web" || typeof document === "undefined") return;

    const handlePointerDown = (event: any) => {
      pointerStartRef.current = {
        x: event.clientX ?? 0,
        y: event.clientY ?? 0,
      };

      if (closestMatches(event.target, WORD_TOKEN_SELECTOR) || closestMatches(event.target, TOOLTIP_SELECTOR)) {
        return;
      }

      clearTooltip();
    };

    const handlePointerMove = (event: any) => {
      const start = pointerStartRef.current;
      if (!start) return;

      const dx = Math.abs((event.clientX ?? start.x) - start.x);
      const dy = Math.abs((event.clientY ?? start.y) - start.y);
      if (dx < DISMISS_DRAG_DISTANCE && dy < DISMISS_DRAG_DISTANCE) return;

      pointerStartRef.current = null;
      clearTooltip();
    };

    const handlePointerEnd = () => {
      pointerStartRef.current = null;
    };

    const handleScroll = () => {
      pointerStartRef.current = null;
      clearTooltip();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerup", handlePointerEnd, true);
    document.addEventListener("pointercancel", handlePointerEnd, true);
    document.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerup", handlePointerEnd, true);
      document.removeEventListener("pointercancel", handlePointerEnd, true);
      document.removeEventListener("scroll", handleScroll, true);
      pointerStartRef.current = null;
    };
  }, [clearTooltip, tooltipWord]);

  if (!tooltipWord || !tooltipPosition || Platform.OS !== "web") return null;
  if (typeof document === "undefined") return null;

  const { createPortal } = require("react-dom");

  return createPortal(
    <TooltipPopup
      position={tooltipPosition}
      translation={translation}
      isRTL={isRTL}
      onPress={() => openDetail(tooltipWord)}
      onHoverIn={cancelTooltipClear}
      onHoverOut={clearTooltipDelayed}
    />,
    document.body,
  );
}
