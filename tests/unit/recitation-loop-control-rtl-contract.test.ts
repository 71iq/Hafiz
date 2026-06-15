import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "components/mushaf/RecitationRangeSheet.tsx"), "utf8");

describe("Recitation loop control RTL contract", () => {
  it("mirrors repeat and delay rows plus their steppers in RTL", () => {
    const loopStart = source.indexOf("function LoopControl");
    const parseStart = source.indexOf("function parseAyahReference", loopStart);
    const loopSource = source.slice(loopStart, parseStart);

    expect(loopStart).toBeGreaterThan(-1);
    expect(parseStart).toBeGreaterThan(loopStart);
    expect(source).toContain('import { DisclosureRow, MirroredRow } from "@/components/ui/MirroredRow";');
    expect(loopSource).toContain("<MirroredRow");
    expect(loopSource).toContain('dir={isRTL ? "rtl" : "ltr"}');
    expect(loopSource).toContain('className="items-center gap-3"');
    expect(loopSource).toContain('className="items-center rounded-full bg-surface p-1 dark:bg-surface-dark"');
    expect(loopSource).toContain("<Pressable onPress={onDecrease}");
    expect(loopSource).toContain("<Minus size={15} color={iconColor} />");
    expect(loopSource).toContain("<Pressable onPress={onIncrease}");
    expect(loopSource).toContain("<Plus size={15} color={iconColor} />");
  });
});
