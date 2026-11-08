import React from "react";
import { View } from "react-native";
import { renderWithDirection, flattenStyle, type RtlTestNode } from "../rtl/rtl-test-utils";
import { ThemeColorSwatch } from "@/components/ui/ThemeColorSwatch";
import { THEME_COLORS, type ThemeMode } from "@/lib/settings/context";

type SwatchCase = {
  theme: ThemeMode;
  systemTheme: "dark" | "white";
};

const swatches: SwatchCase[] = [
  { theme: "white", systemTheme: "white" },
  { theme: "beige", systemTheme: "white" },
  { theme: "dark", systemTheme: "white" },
  { theme: "amoled", systemTheme: "white" },
  { theme: "system", systemTheme: "white" },
  { theme: "system", systemTheme: "dark" },
];

function expectedAccent({ theme, systemTheme }: SwatchCase) {
  const palette = theme === "system" ? systemTheme : theme;
  return palette === "dark" || palette === "amoled" ? "#2DD4BF" : "#0D9488";
}

describe("ThemeColorSwatch", () => {
  it.each(["ltr", "rtl"] as const)("preserves decorative rendering in %s", (dir) => {
    for (const swatchCase of swatches) {
      for (const selected of [false, true]) {
        const { UNSAFE_getAllByType, queryByText, getByText } = renderWithDirection(
          <ThemeColorSwatch
            theme={swatchCase.theme}
            systemTheme={swatchCase.systemTheme}
            selected={selected}
            size={42}
          />,
          dir,
        );
        const [swatch, ...children] = UNSAFE_getAllByType(View);
        const swatchStyle = flattenStyle(swatch.props.style);
        const accent = expectedAccent(swatchCase);

        expect(swatch.props.accessible).toBe(false);
        expect(swatchStyle).toMatchObject({
          width: "100%",
          height: 42,
          borderRadius: 6,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? accent : "rgba(127,127,127,0.45)",
          backgroundColor: swatchCase.theme === "system" ? undefined : THEME_COLORS[swatchCase.theme].surface,
          overflow: "hidden",
          pointerEvents: "none",
        });

        if (swatchCase.theme === "system") {
          const renderedViews: RtlTestNode[] = swatch.findAllByType(View);
          const [, systemRow, ...systemHalves] = renderedViews;
          expect(systemHalves).toHaveLength(2);
          expect(flattenStyle(systemRow.props.style)).toEqual({ flex: 1, flexDirection: "row" });
          expect(systemHalves.map((child) => flattenStyle(child.props.style))).toEqual([
            { flex: 1, backgroundColor: THEME_COLORS.white.surface },
            { flex: 1, backgroundColor: THEME_COLORS.dark.surface },
          ]);
        } else {
          expect(children).toHaveLength(0);
        }

        if (selected) {
          const marker = getByText("✓");
          expect(marker.type).toBe("Text");
          expect(marker.props.accessible).toBe(false);
          expect(flattenStyle(marker.props.style)).toEqual({
            position: "absolute",
            top: 1,
            right: 5,
            color: accent,
            fontSize: 13,
            lineHeight: 16,
            fontFamily: "Manrope_700Bold",
          });
        } else {
          expect(queryByText("✓")).toBeNull();
        }
      }
    }
  });
});
