import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { isQpcFontLoaded, loadQpcFont, qpcFontName } from "@/lib/fonts/loader";

type Props = {
  textQcf2: string;
  v2Page: number;
  fontSize: number;
  lineHeight: number;
  colorClassName?: string;
};

export function Qcf2AyahText({
  textQcf2,
  v2Page,
  fontSize,
  lineHeight,
  colorClassName = "text-charcoal dark:text-neutral-100",
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
      {tokens.map((token, index) => (
        <Text
          key={`${token}-${index}`}
          className={colorClassName}
          style={{
            fontFamily: qpcFontName(v2Page),
            fontSize,
            lineHeight,
            paddingHorizontal: 1,
          }}
        >
          {token}
        </Text>
      ))}
    </View>
  );
}
