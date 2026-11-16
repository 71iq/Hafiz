import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "components/ui/ResponsiveOverlay.tsx"), "utf8");

describe("ResponsiveOverlay phone sheet height contract", () => {
  it("fits phone sheets to their content up to the cap, with a fixed height only on request", () => {
    expect(source).toContain('phoneSheetHeight = "content"');
    expect(source).toContain("maxHeight: computedMaxHeight");
    expect(source).toContain('height: isPhoneSheet && phoneSheetHeight === "max" ? computedMaxHeight : undefined');
    expect(source).toContain("...(isPhoneSheet ? { flexShrink: 1, minHeight: 0 } : null)");
  });

  it("keeps the 92% phone cap below the status bar", () => {
    expect(source).toContain("Math.min(height - (isPhone ? insets.top + 8 : 48), isPhone ? height * 0.92 : 720)");
  });
});
