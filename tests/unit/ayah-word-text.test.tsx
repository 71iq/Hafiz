import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { AyahWordText } from "@/components/mushaf/WordSpan";

const mockOpenDetail = jest.fn();
const mockMarkActivity = jest.fn();

jest.mock("@/lib/word/context", () => ({
  useWordInteraction: () => ({ tooltipWord: null, setTooltipWord: jest.fn(), openDetail: mockOpenDetail }),
}));
jest.mock("@/lib/ui/chrome", () => ({ useChrome: () => ({ markActivity: mockMarkActivity }) }));

function renderAyah() {
  return render(
    <AyahWordText
      words={["ﱁ", "ﱂ", "ﱃ"]}
      surah={1}
      ayah={1}
      v2Page={1}
      fontSize={28}
      lineHeight={50}
      testID="ayah-text"
      wordHighlightColor={() => undefined}
    />,
  );
}

beforeEach(() => {
  mockOpenDetail.mockClear();
  mockMarkActivity.mockClear();
});

describe("RF-184 Android single-Text ayah words", () => {
  it("opens the detail sheet for the word under the finger when the ayah text is long-pressed", () => {
    const view = renderAyah();

    fireEvent(view.getByText("ﱂ"), "pressIn");
    fireEvent(view.getByTestId("ayah-text"), "longPress");

    expect(mockMarkActivity).toHaveBeenCalledTimes(1);
    expect(mockOpenDetail).toHaveBeenCalledWith({ surah: 1, ayah: 1, wordPos: 2, v2Page: 1 });
  });

  it("does nothing on a long press that did not start on a word", () => {
    const view = renderAyah();

    fireEvent(view.getByTestId("ayah-text"), "longPress");

    expect(mockOpenDetail).not.toHaveBeenCalled();
  });

  it("does not reopen the previous word after the touch ends", () => {
    const view = renderAyah();
    const ayahText = view.getByTestId("ayah-text");

    fireEvent(view.getByText("\uFC42"), "pressIn");
    fireEvent(ayahText, "longPress");
    fireEvent(ayahText, "pressOut");
    fireEvent(view.getByText("\uFC43"), "pressIn");
    fireEvent(ayahText, "pressOut");
    fireEvent(ayahText, "longPress");

    expect(mockOpenDetail).toHaveBeenCalledTimes(1);
    expect(mockOpenDetail).toHaveBeenCalledWith({ surah: 1, ayah: 1, wordPos: 2, v2Page: 1 });
  });
});
