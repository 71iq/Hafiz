import React, { createContext, useContext } from "react";
import { I18nManager, Platform, type TextStyle } from "react-native";

export type Direction = "ltr" | "rtl";

const DirectionContext = createContext<Direction>(I18nManager.isRTL ? "rtl" : "ltr");

export function DirectionProvider({
  dir,
  children,
}: {
  dir: Direction;
  children: React.ReactNode;
}) {
  return <DirectionContext.Provider value={dir}>{children}</DirectionContext.Provider>;
}

export function useUIDirection(explicitDir?: Direction): Direction {
  const contextDir = useContext(DirectionContext);
  return explicitDir ?? contextDir;
}

export function textAlignForDirection(dir: Direction, align: "start" | "center" | "end" = "start") {
  if (align === "center") return "center";
  if (align === "end") return dir === "rtl" ? "left" : "right";
  return dir === "rtl" ? "right" : "left";
}

type DirectionInput = Direction | boolean | undefined;

function isRtl(dir: DirectionInput): boolean {
  return dir === true || dir === "rtl";
}

/**
 * Text style that aligns to the reading start. React Native's native text layout treats textAlign
 * "left"/"right" as start/end once a text's layout direction is RTL, while web keeps them physical,
 * so the web-style `isRTL ? "right" : "left"` drew Arabic labels on the left on Android whenever
 * an ancestor set `direction: "rtl"`. Native pins the text's own direction and aligns to its start;
 * web keeps the physical side.
 */
export function textStartStyle(dir: DirectionInput): TextStyle {
  const rtl = isRtl(dir);
  if (Platform.OS === "web") return { textAlign: rtl ? "right" : "left" };
  return { direction: rtl ? "rtl" : "ltr", textAlign: "left" };
}

/** Text style that aligns to the reading end; see textStartStyle. */
export function textEndStyle(dir: DirectionInput): TextStyle {
  const rtl = isRtl(dir);
  if (Platform.OS === "web") return { textAlign: rtl ? "left" : "right" };
  return { direction: rtl ? "rtl" : "ltr", textAlign: "right" };
}

/** Start, center or end alignment as a style; see textStartStyle for why native pins direction. */
export function textAlignStyle(dir: DirectionInput, align: "start" | "center" | "end" = "start"): TextStyle {
  if (align === "center") return { textAlign: "center" };
  return align === "end" ? textEndStyle(dir) : textStartStyle(dir);
}
