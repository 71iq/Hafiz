import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("progress heatmap layout contract", () => {
  it("uses expanded heatmap sizing only on the progress page", () => {
    const progress = read("app/(tabs)/progress.tsx");
    const profile = read("components/profile/ProfileModalContent.tsx");
    const heatmap = read("components/progress/ActivityHeatmap.tsx");

    expect(progress).toContain('size="expanded"');
    expect(profile).not.toContain('size="expanded"');
    expect(heatmap).toContain('size?: "compact" | "expanded"');
    expect(heatmap).toContain('size = "compact"');
    expect(heatmap).toContain("isDesktopWidth\n      ? 42");
  });
});
