import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { SurahProgressBrowser } from "@/components/progress/SurahProgressList";
import { AchievementGrid } from "@/components/achievements/AchievementGrid";
import type { AchievementDashboardItem } from "@/lib/achievements/queries";
import { strings } from "@/lib/i18n/strings";

const mockSettings = {
  isDark: false,
  isRTL: false,
  uiLanguage: "en" as "en" | "ar",
  effectiveTheme: "white",
  themeColors: { surface: "#fff", surfaceMid: "#eee", surfaceHigh: "#ddd", surfaceDim: "#ccc" },
};
jest.mock("@/lib/settings/context", () => {
  const actual = jest.requireActual<typeof import("@/lib/settings/context")>("@/lib/settings/context");
  return { ...actual, useSettings: () => mockSettings };
});
jest.mock("nativewind", () => ({ useColorScheme: () => ({ colorScheme: "light" }) }));
const mockOpenMushaf = jest.fn();
jest.mock("@/lib/navigation/open-mushaf", () => ({ useOpenMushaf: () => mockOpenMushaf }));

const surahs = [
  { surah: 1, nameEnglish: "Al-Fatihah", nameArabic: "الفاتحة", totalCards: 7, memorized: 7 },
  { surah: 2, nameEnglish: "Al-Baqarah", nameArabic: "البقرة", totalCards: 286, memorized: 20 },
  { surah: 112, nameEnglish: "Al-Ikhlas", nameArabic: "الإخلاص", totalCards: 4, memorized: 1 },
];

function names(view: ReturnType<typeof render>) {
  return view.getAllByText(/^Al-/).map((node) => node.props.children);
}

describe("surah progress View all", () => {
  it("searches by name in either script or by number and sorts by memorized share", () => {
    const view = render(<SurahProgressBrowser data={surahs} isDark={false} s={strings.en} />);
    expect(names(view)).toEqual(["Al-Fatihah", "Al-Baqarah", "Al-Ikhlas"]);

    fireEvent.press(view.getByText(strings.en.surahSortLeast));
    expect(names(view)).toEqual(["Al-Baqarah", "Al-Ikhlas", "Al-Fatihah"]);
    fireEvent.press(view.getByText(strings.en.surahSortMost));
    expect(names(view)).toEqual(["Al-Fatihah", "Al-Ikhlas", "Al-Baqarah"]);

    const search = view.getByLabelText(strings.en.surahSearchPlaceholder);
    fireEvent.changeText(search, "baq");
    expect(names(view)).toEqual(["Al-Baqarah"]);
    fireEvent.press(view.getByRole("button", { name: /Al-Baqarah/ }));
    expect(mockOpenMushaf).toHaveBeenCalledWith({ surah: 2, ayah: 1 });
    fireEvent.changeText(search, "الإخلاص");
    expect(names(view)).toEqual(["Al-Ikhlas"]);
    fireEvent.changeText(search, "١١٢");
    expect(names(view)).toEqual(["Al-Ikhlas"]);
    fireEvent.changeText(search, "zzz");
    expect(view.getByText(strings.en.surahNoMatches)).toBeTruthy();
  });
});

function badge(
  id: string,
  unlocked: boolean,
  overrides: Partial<AchievementDashboardItem> = {},
): AchievementDashboardItem {
  return {
    id,
    category: "completion",
    titleKey: "achievement.juzCompleted.title",
    descriptionKey: "achievement.juzCompleted.description",
    icon: "book",
    rarity: "rare",
    target: 1,
    unlockedAt: unlocked ? "2026-11-01T00:00:00.000Z" : null,
    seenAt: null,
    localPayload: {},
    publicPayload: {},
    progress: null,
    ...overrides,
  } as AchievementDashboardItem;
}

describe("all achievements dialog", () => {
  it("collapses the juz completion badges into one expandable row and names rarity in text", () => {
    const items = [
      badge("first_review", true, { category: "reviews", titleKey: "achievement.firstReview.title" }),
      ...Array.from({ length: 30 }, (_, index) =>
        badge(`juz_${String(index + 1).padStart(2, "0")}_completed`, index < 3),
      ),
    ];
    const view = render(<AchievementGrid items={items} />);
    const group = view.getByRole("button", { name: "Juz completions ⁦3/30⁩" });
    expect(group.props.accessibilityState?.expanded).toBe(false);
    expect(view.getAllByText(strings.en["achievementRarity.rare"])).toHaveLength(1);

    fireEvent.press(group);
    expect(view.getAllByText(strings.en["achievementRarity.rare"])).toHaveLength(31);
  });
});
