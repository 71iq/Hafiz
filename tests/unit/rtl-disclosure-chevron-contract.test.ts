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
  it("mirrors reciter selection rows and keeps controls on one row", () => {
    expectContains("components/mushaf/RecitationRangeSheet.tsx", [
      'import { DisclosureRow, MirroredRow } from "@/components/ui/MirroredRow";',
      "const DisclosureChevron = isRTL ? ChevronLeft : ChevronRight;",
      "<DisclosureRow",
      'dir={isRTL ? "rtl" : "ltr"}',
      'leading={',
      'trailing={',
    ]);

    // Reciter rows show name, style and the selected check (no ID badge or chevron), with a separate
    // 44px preview button, mirrored by hand so the RTL reader root does not flip them back.
    expectContains("components/settings/ReciterPicker.tsx", [
      "<Pressable",
      'direction: "ltr",',
      'flexDirection: isRTL ? "row-reverse" : "row",',
      'width: "100%",',
      'className={`min-w-0 flex-1 gap-0.5 ${isRTL ? "items-end" : "items-start"}`}',
      'className="mx-1 h-11 w-11 shrink-0 items-center justify-center rounded-full"',
    ]);
    expect(read("components/settings/ReciterPicker.tsx")).not.toContain("toArabicNumber(reciter.id)");
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
      'className={`mb-4 items-center gap-3 rounded-3xl bg-surface p-4 dark:bg-surface-dark ${isRTL ? "flex-row-reverse" : "flex-row"}`}',
      'className="h-6 w-6 shrink-0 items-center justify-center"',
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
      "<TooltipChevron size={12} color={colors.muted} />",
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
