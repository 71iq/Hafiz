import { scrollToVisibleIndex } from "@/lib/mushaf/scroll-to-visible-index";

describe("variable-height verse navigation", () => {
  it("waits for FlashList's scroll promise before checking the measured viewport", async () => {
    let complete!: () => void;
    const list = {
      scrollToIndex: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      ),
      computeVisibleIndices: jest.fn(() => ({ startIndex: 255, endIndex: 256 })),
    };
    const scrolling = scrollToVisibleIndex(
      () => list,
      255,
      false,
      () => true,
    );
    expect(list.computeVisibleIndices).not.toHaveBeenCalled();
    complete();
    await scrolling;
    expect(list.computeVisibleIndices).toHaveBeenCalledTimes(1);
  });

  it("realigns when the first estimate leaves the requested index outside the viewport", async () => {
    jest.useFakeTimers();
    try {
      const list = {
        scrollToIndex: jest.fn(async (_params: { index: number; animated?: boolean }) => {}),
        computeVisibleIndices: jest
          .fn()
          .mockReturnValueOnce({ startIndex: 149, endIndex: 151 })
          .mockReturnValue({ startIndex: 255, endIndex: 256 }),
      };
      const scrolling = scrollToVisibleIndex(
        () => list,
        255,
        true,
        () => true,
      );
      await jest.advanceTimersByTimeAsync(80);
      await scrolling;
      expect(list.scrollToIndex).toHaveBeenCalledTimes(2);
      expect(list.scrollToIndex.mock.calls[1][0]).toMatchObject({ index: 255, animated: false });
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops a canceled navigation after its outstanding scroll completes", async () => {
    let current = true;
    let complete!: () => void;
    const list = {
      scrollToIndex: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      ),
      computeVisibleIndices: jest.fn(),
    };
    const scrolling = scrollToVisibleIndex(
      () => list,
      255,
      false,
      () => current,
    );
    current = false;
    complete();
    await scrolling;
    expect(list.scrollToIndex).toHaveBeenCalledTimes(1);
    expect(list.computeVisibleIndices).not.toHaveBeenCalled();
  });
});
