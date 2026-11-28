import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { HIDDEN, RecitationPage } from "@/components/hifz/RecitationPage";
import { buildRecitationPage } from "@/lib/hifz/page-data";

jest.mock("@/lib/fonts/loader", () => ({
  quranPageFontName: () => "test-page-font",
  quranPageFontPaletteStyle: () => null,
  quranPageMarkerFontPaletteStyle: () => null,
}));
jest.mock("@/lib/fonts/use-quran-page-font", () => ({ useQuranPageFontReady: () => true }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({}) }));

const glyphs = "\ue001 \ue002 \ue003";
const text = "بِسْمِ ٱللَّهِ";
const page = buildRecitationPage(1, [{ surah: 1, ayah: 1, text_qcf2: glyphs, text_uthmani: text }], [], { "1": glyphs });
const props = { page, surahNames: new Map<number, string>(), width: 350, isDark: false, wordLabel: () => "1:1" };
const shown = { ...HIDDEN, all: true };

it("exposes Unicode for a readable line while rendering the page-font glyphs", () => {
  render(<RecitationPage {...props} level={0} reveal={shown} />);

  expect(screen.getByLabelText(text)).toBeOnTheScreen();
  expect(screen.queryByText(glyphs)).toBeNull();
  expect(screen.getByText(glyphs, { includeHiddenElements: true })).toHaveStyle({ fontFamily: "test-page-font" });
});

it("keeps neighboring web glyphs in their printed positions while revealing only the selected ayah", () => {
  const platform = jest.replaceProperty(Platform, "OS", "web");
  try {
    const nextGlyphs = "\ue004 \ue005";
    const line = `${glyphs} ${nextGlyphs}`;
    const shared = buildRecitationPage(1, [
      { surah: 1, ayah: 1, text_qcf2: glyphs, text_uthmani: text },
      { surah: 2, ayah: 1, text_qcf2: nextGlyphs, text_uthmani: "الٓمٓ" },
    ], [], { "1": line });
    render(<RecitationPage {...props} page={shared} level={4} reveal={shown} ayahs={[{ surah: 1, ayah: 1 }]} />);

    const printed = { includeHiddenElements: true };
    expect(screen.getByText(line, printed)).toHaveStyle({ fontFamily: "test-page-font" });
    expect(screen.getByText("\ue001", printed)).not.toHaveStyle({ opacity: 0 });
    for (const glyph of nextGlyphs.split(" ")) expect(screen.getByText(glyph, printed)).toHaveStyle({ opacity: 0 });
    expect(screen.getByText(text)).toBeOnTheScreen();
    expect(screen.queryByText("الٓمٓ")).toBeNull();
  } finally {
    platform.restore();
  }
});

it("only exposes the available cue and keeps cloze answers and hidden words private", () => {
  const { rerender } = render(<RecitationPage {...props} level={1} reveal={HIDDEN} />);
  expect(screen.getByLabelText("بِ ٱ")).toBeOnTheScreen();

  const cloze = { surah: 1, ayah: 1, wordPos: 2 };
  rerender(<RecitationPage {...props} level={1} reveal={HIDDEN} cloze={cloze} />);
  expect(screen.getByLabelText("بِ")).toBeOnTheScreen();
  expect(screen.queryByLabelText(/ٱ/)).toBeNull();

  rerender(<RecitationPage {...props} level={0} reveal={HIDDEN} cloze={cloze} />);
  expect(screen.getByLabelText("بِسْمِ")).toBeOnTheScreen();
  expect(screen.queryByLabelText(/ٱ/)).toBeNull();

  rerender(<RecitationPage {...props} level={4} reveal={HIDDEN} />);
  expect(screen.queryByLabelText(/ب|ٱ/)).toBeNull();
});

it("marks the same word through its visible glyph and its accessible self-check button", () => {
  const onWordPress = jest.fn();
  const key = "1:1:1:0";
  render(<RecitationPage {...props} level={4} reveal={shown} marked={new Set([key])} onWordPress={onWordPress} />);

  const button = screen.getByRole("button", { name: "بِسْمِ, 1:1", selected: true });
  expect(screen.getAllByRole("button")).toHaveLength(2);
  fireEvent(button, "accessibilityTap");
  fireEvent.press(screen.getByText("\ue001", { includeHiddenElements: true }));
  expect(onWordPress).toHaveBeenCalledTimes(2);
  expect(onWordPress).toHaveBeenNthCalledWith(1, page.lines[0].tokens[0], key);
  expect(onWordPress).toHaveBeenNthCalledWith(2, page.lines[0].tokens[0], key);
});

it("reads an unaligned ayah intact only when the whole ayah is visible", () => {
  const unaligned = buildRecitationPage(
    1,
    [{ surah: 1, ayah: 1, text_qcf2: glyphs, text_uthmani: "بِسْمِ" }],
    [],
    { "1": "\ue001", "2": "\ue002 \ue003" },
  );
  const { rerender } = render(<RecitationPage {...props} page={unaligned} level={0} reveal={shown} />);
  expect(screen.getByLabelText("بِسْمِ")).toBeOnTheScreen();

  rerender(<RecitationPage {...props} page={unaligned} level={0} reveal={shown} lineNumbers={new Set([1])} />);
  expect(screen.queryByLabelText("بِسْمِ")).toBeNull();

  rerender(<RecitationPage {...props} page={unaligned} level={4} reveal={{ ...HIDDEN, count: 1 }} />);
  expect(screen.queryByLabelText("بِسْمِ")).toBeNull();
});
