import { useEffect, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useDatabase } from "@/lib/database/provider";
import { useWordInteraction, type TooltipPosition } from "@/lib/word/context";
import { fetchWordTranslation } from "@/lib/word/queries";

const TOOLTIP_HEIGHT = 36;
const ARROW_SIZE = 6;
const GAP = 6;

function TooltipPopup({
  position,
  translation,
  onPress,
}: {
  position: TooltipPosition;
  translation: string | null;
  onPress: () => void;
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
      }}
      onLayout={(e) => setTooltipWidth(e.nativeEvent.layout.width)}
    >
      <View
        style={{
          backgroundColor: "#0d9488",
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 7,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 8,
        }}
      >
        <Text
          // @ts-ignore — whiteSpace is valid CSS but not in RN Text types
          style={{ color: "#fff", fontSize: 13, fontWeight: "500", whiteSpace: "nowrap" }}
          numberOfLines={1}
        >
          {translation ?? "…"}
        </Text>
        <ChevronRight size={12} color="rgba(255,255,255,0.75)" />
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
          borderTopColor: "#0d9488",
        }}
      />
    </Pressable>
  );
}

export function FloatingWordTooltip() {
  const { tooltipWord, tooltipPosition, openDetail } = useWordInteraction();
  const db = useDatabase();
  const [translation, setTranslation] = useState<string | null>(null);

  useEffect(() => {
    if (!tooltipWord) return;
    setTranslation(null);
    fetchWordTranslation(db, tooltipWord.surah, tooltipWord.ayah, tooltipWord.wordPos).then(
      (row) => setTranslation(row?.translation_en ?? "—")
    );
  }, [db, tooltipWord?.surah, tooltipWord?.ayah, tooltipWord?.wordPos]);

  if (!tooltipWord || !tooltipPosition || Platform.OS !== "web") return null;
  if (typeof document === "undefined") return null;

  const { createPortal } = require("react-dom");

  return createPortal(
    <TooltipPopup
      position={tooltipPosition}
      translation={translation}
      onPress={() => openDetail(tooltipWord)}
    />,
    document.body
  );
}
