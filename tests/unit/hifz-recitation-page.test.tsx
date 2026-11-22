import { fireEvent, render, screen } from "@testing-library/react-native";
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
