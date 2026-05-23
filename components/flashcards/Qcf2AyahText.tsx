import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { isQpcFontLoaded, loadQpcFont, qpcFontName } from "@/lib/fonts/loader";

type Props = {
  textQcf2: string;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  colorClassName?: string;
  highlightWordPos?: number;
};

export function Qcf2AyahText({
  textQcf2,
  v2Page,
  fontSize,
  lineHeight,
  colorClassName = "text-charcoal dark:text-neutral-100",
  highlightWordPos,
}: Props) {
  const [visible, setVisible] = useState(() => isQpcFontLoaded(v2Page));

  useEffect(() => {
    if (isQpcFontLoaded(v2Page)) {
      setVisible(true);
      return;
    }
    let cancelled = false;
    loadQpcFont(v2Page).then(() => {
      if (!cancelled) requestAnimationFrame(() => setVisible(true));
    }).catch(console.warn);
    return () => {
      cancelled = true;
    };
  }, [v2Page]);

  const tokens = textQcf2.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  const highlightIndex = typeof highlightWordPos === "number" ? highlightWordPos - 1 : -1;

  return (
    <View
      style={{
        direction: "ltr",
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: Math.max(3, fontSize * 0.16),
        rowGap: Math.max(4, fontSize * 0.2),
        opacity: visible ? 1 : 0,
      }}
    >
      {tokens.map((token, index) => {
        const highlighted = index === highlightIndex;
        return (
          <Text
            key={`${token}-${index}`}
            className={highlighted ? "text-primary-accent dark:text-primary-bright" : colorClassName}
            style={{
              fontFamily: qpcFontName(v2Page),
              fontSize,
              lineHeight,
              paddingHorizontal: highlighted ? 7 : 1,
              borderRadius: highlighted ? 10 : 0,
              backgroundColor: highlighted ? "rgba(13, 148, 136, 0.13)" : "transparent",
            }}
          >
            {token}
          </Text>
        );
      })}
    </View>
  );
}
