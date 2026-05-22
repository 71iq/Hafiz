import React, { createContext, useContext } from "react";
import { I18nManager } from "react-native";

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

export function isRTLDirection(dir: Direction) {
  return dir === "rtl";
}

export function textAlignForDirection(dir: Direction, align: "start" | "center" | "end" = "start") {
  if (align === "center") return "center";
  if (align === "end") return dir === "rtl" ? "left" : "right";
  return dir === "rtl" ? "right" : "left";
}

export function rowClassForDirection(dir: Direction) {
  return dir === "rtl" ? "flex-row-reverse" : "flex-row";
}
