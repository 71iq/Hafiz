import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("settings reading spacing contract", () => {
  it("uses one stack gap instead of manual spacer rows", () => {
    const source = fs.readFileSync(path.join(root, "app/(tabs)/settings.tsx"), "utf8");
    const readingStart = source.indexOf("<SectionLabel>{s.sectionReading}</SectionLabel>");
    const contentStart = source.indexOf('{activeCategory === "content"', readingStart);
    const readingSection = source.slice(readingStart, contentStart);

    expect(readingStart).toBeGreaterThan(-1);
    expect(contentStart).toBeGreaterThan(readingStart);
    expect(readingSection).toContain('<View className="gap-4">');
    expect(readingSection).not.toContain('className="h-4"');
    expect(readingSection).not.toContain('className="my-4');
  });
});
