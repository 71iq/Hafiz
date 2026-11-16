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

export function textStartStyle(dir: DirectionInput): TextStyle {
  const rtl = isRtl(dir);
  if (Platform.OS === "web") return { textAlign: rtl ? "right" : "left" };
  return { direction: rtl ? "rtl" : "ltr", textAlign: "left" };
}

export function inputTextStartStyle(dir: DirectionInput): TextStyle {
  const rtl = isRtl(dir);
  return { textAlign: rtl ? "right" : "left", writingDirection: rtl ? "rtl" : "ltr" };
}

export function textEndStyle(dir: DirectionInput): TextStyle {
  const rtl = isRtl(dir);
  if (Platform.OS === "web") return { textAlign: rtl ? "left" : "right" };
  return { direction: rtl ? "rtl" : "ltr", textAlign: "right" };
}

export function textAlignStyle(dir: DirectionInput, align: "start" | "center" | "end" = "start"): TextStyle {
  if (align === "center") return { textAlign: "center" };
  return align === "end" ? textEndStyle(dir) : textStartStyle(dir);
}
