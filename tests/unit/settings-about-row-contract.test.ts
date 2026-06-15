import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/settings.tsx"), "utf8");

describe("settings about row contract", () => {
  it("keeps About links as one horizontal row on phone", () => {
    const rowStart = source.indexOf("function SettingsLinkRow");
    const rowSource = source.slice(rowStart);

    expect(rowStart).toBeGreaterThan(-1);
    expect(rowSource).toContain('${isRTL ? "flex-row-reverse" : "flex-row"}');
    expect(rowSource).toContain('style={({ pressed }) => ({');
    expect(rowSource).toContain('direction: "ltr"');
    expect(rowSource).toContain('flexDirection: isRTL ? "row-reverse" : "row"');
    expect(rowSource).toContain('className="h-9 w-9 shrink-0 items-center justify-center rounded-full');
    expect(rowSource).toContain('className="min-w-0 flex-1"');
    expect(rowSource).toContain("numberOfLines={1}");
    expect(rowSource).toContain('className="h-6 w-6 shrink-0 items-center justify-center"');
  });
});
