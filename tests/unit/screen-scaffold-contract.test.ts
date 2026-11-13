import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const screenContentSource = fs.readFileSync(path.join(root, "components/ui/ScreenContent.tsx"), "utf8");

describe("screen scaffold contract", () => {
  it("keeps the canonical screen shell and scroll defaults centralized", () => {
    expect(screenContentSource).toContain("export function Screen");
    expect(screenContentSource).toContain("export function ScreenScrollView");
    expect(screenContentSource).toContain("export const TAB_SCREEN_BOTTOM_INSET = 100;");
    expect(screenContentSource).toContain("export const COMPACT_SCREEN_BOTTOM_INSET = 48;");
    expect(screenContentSource).toContain('contentInsetAdjustmentBehavior = "automatic"');
    expect(screenContentSource).toContain('keyboardShouldPersistTaps = "handled"');
    expect(screenContentSource).toContain("showsVerticalScrollIndicator = false");
  });

  it("keeps main non-reader tab routes on the shared screen shell", () => {
    const tabRoutes = ["app/(tabs)/home.tsx", "app/(tabs)/progress.tsx", "app/(tabs)/settings.tsx"];
    // Halaqa and Board use SocialScreen, which is the shared shell with a title rail.
    const socialRoutes = ["app/(tabs)/halaqa.tsx", "app/(tabs)/leaderboard.tsx"];

    for (const route of [...tabRoutes, "components/social/SocialScreen.tsx", ...socialRoutes]) {
      const source = fs.readFileSync(path.join(root, route), "utf8");
      if (socialRoutes.includes(route)) {
        expect(source).toContain('from "@/components/social/SocialScreen"');
        expect(source).toContain("<SocialScreen");
      } else {
        expect(source).toContain('from "@/components/ui/ScreenContent"');
        expect(source).toContain("<Screen>");
      }
      expect(source).not.toContain("react-native-safe-area-context");
      expect(source).not.toContain('className="flex-1 bg-surface dark:bg-surface-dark"');
    }
  });
});
