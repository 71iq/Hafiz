import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expectContains(relativePath: string, snippets: string[]) {
  const source = read(relativePath);
  for (const snippet of snippets) {
    expect(source).toContain(snippet);
  }
}

describe("RTL disclosure chevron contract", () => {
  it("mirrors reciter selection rows as whole disclosure rows", () => {
    expectContains("components/mushaf/RecitationRangeSheet.tsx", [
      'import { DisclosureRow, MirroredRow } from "@/components/ui/MirroredRow";',
      "const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;",
      "<DisclosureRow",
      'dir={isRTL ? "rtl" : "ltr"}',
      'leading={',
      'trailing={',
    ]);

    expectContains("components/settings/ReciterPicker.tsx", [
      'import { DisclosureRow } from "@/components/ui/MirroredRow";',
      "const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;",
      "<DisclosureRow",
      'className="w-full items-center justify-between gap-3 rounded-2xl px-3 py-3"',
      'dir={isRTL ? "rtl" : "ltr"}',
      'leading={',
      'trailing={',
    ]);
  });

  it("mirrors picker and settings disclosure rows without relying on ambient RTL direction", () => {
    for (const relativePath of ["components/settings/TranslationLanguagePicker.tsx", "components/settings/TafsirSourcePicker.tsx"]) {
      expectContains(relativePath, [
        'import { DisclosureRow } from "@/components/ui/MirroredRow";',
        "const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;",
        "<DisclosureRow",
        'dir={isRTL ? "rtl" : "ltr"}',
        'trailing={',
      ]);
    }

    for (const relativePath of ["components/mushaf/ReadingSettingsSheet.tsx", "app/(tabs)/settings.tsx"]) {
      expectContains(relativePath, [
        'direction: "ltr",',
        'flexDirection: isRTL ? "row-reverse" : "row",',
      ]);
    }

    expectContains("app/(tabs)/settings.tsx", [
      'className="mb-4 items-center gap-3 rounded-3xl bg-surface p-4 dark:bg-surface-dark"',
      "<TranslationChevron size={18} color={isDark ? \"#525252\" : \"#DFD9D1\"} />",
    ]);
  });

  it("uses directional chevrons for collapsible search rows and word tooltip details", () => {
    expectContains("components/SearchCommand.tsx", [
      "const LemmaDisclosureChevron = isRTL ? ChevronLeft : ChevronRight;",
      "<LemmaDisclosureChevron size={14} color={tealColor} />",
      'style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}',
    ]);

    expectContains("components/mushaf/WordTooltip.tsx", [
      "const TooltipChevron = isRTL ? ChevronLeft : ChevronRight;",
      "<TooltipChevron size={12} color=\"rgba(255,255,255,0.6)\" />",
      'flexDirection: isRTL ? "row-reverse" : "row",',
    ]);
  });

  it("uses a directional icon for the flashcard forward control", () => {
    expectContains("app/flashcards/session.tsx", [
      "const NextIcon = isRTL ? ChevronLeft : ChevronRight;",
      "<NextIcon size={18} color=\"#fff\" />",
      'style={{ direction: "ltr", flexDirection: isRTL ? "row-reverse" : "row" }}',
    ]);
  });
});
