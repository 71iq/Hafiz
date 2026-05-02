import { useEffect, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useWordInteraction, type TooltipPosition } from "@/lib/word/context";
import {
  fetchWordTranslation,
  fetchWordMeaningAr,
} from "@/lib/word/queries";
import { useSettings } from "@/lib/settings/context";

const TOOLTIP_HEIGHT = 36;
const ARROW_SIZE = 6;
const GAP = 6;

function TooltipPopup({
  position,
  translation,
  onPress,
  onHoverIn,
  onHoverOut,
}: {
  position: TooltipPosition;
  translation: string | null;
  onPress: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
}) {
  const [tooltipWidth, setTooltipWidth] = useState(0);

  const centerX = position.x + position.width / 2;
  const left = tooltipWidth > 0
    ? Math.max(8, Math.min(centerX - tooltipWidth / 2, (typeof window !== "undefined" ? window.innerWidth : 400) - tooltipWidth - 8))
    : centerX;
  const top = position.y - TOOLTIP_HEIGHT - ARROW_SIZE - GAP;

  return (
    <Pressable
      onPress={onPress}
      // @ts-ignore — position:'fixed' is valid CSS/RN-Web but not in RN types
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9999,
        opacity: tooltipWidth > 0 ? 1 : 0,
        // @ts-ignore — cursor is valid on web
        cursor: "pointer",
      }}
      onLayout={(e) => setTooltipWidth(e.nativeEvent.layout.width)}
      {...(onHoverIn && { onHoverIn })}
      {...(onHoverOut && { onHoverOut })}
    >
      <View
        style={{
          backgroundColor: "#003638", // primary deep teal
          borderRadius: 20, // pill shape per DESIGN.md
          paddingHorizontal: 14,
          paddingVertical: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          // Ambient teal-tinted shadow per DESIGN.md
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
            // @ts-ignore — whiteSpace is valid CSS on web
            whiteSpace: "nowrap",
          }}
          numberOfLines={1}
        >
          {translation ?? "…"}
        </Text>
        <ChevronRight size={12} color="rgba(255,255,255,0.6)" />
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
  const { tooltipWord, tooltipPosition, openDetail, cancelTooltipClear, clearTooltipDelayed } = useWordInteraction();
  const db = useDatabase();
  const { uiLanguage } = useSettings();
  const [translation, setTranslation] = useState<string | null>(null);

  useEffect(() => {
    if (!tooltipWord) return;
    setTranslation(null);
    const { surah, ayah, wordPos } = tooltipWord;
    if (uiLanguage === "ar") {
      fetchWordMeaningAr(db, surah, ayah, wordPos)
        .then(async (row) => {
          if (row?.meaning) {
            setTranslation(row.meaning);
            return;
          }
          // Fall back to English translation if no Arabic meaning is recorded
          const en = await fetchWordTranslation(db, surah, ayah, wordPos);
          setTranslation(en?.translation_en ?? "—");
        })
        .catch(() => setTranslation("—"));
    } else {
      fetchWordTranslation(db, surah, ayah, wordPos).then(
        (row) => setTranslation(row?.translation_en ?? "—")
      );
    }
  }, [db, tooltipWord?.surah, tooltipWord?.ayah, tooltipWord?.wordPos, uiLanguage]);

  if (!tooltipWord || !tooltipPosition || Platform.OS !== "web") return null;
  if (typeof document === "undefined") return null;

  const { createPortal } = require("react-dom");

  return createPortal(
    <TooltipPopup
      position={tooltipPosition}
      translation={translation}
      onPress={() => openDetail(tooltipWord)}
      onHoverIn={cancelTooltipClear}
      onHoverOut={clearTooltipDelayed}
    />,
    document.body
  );
}
