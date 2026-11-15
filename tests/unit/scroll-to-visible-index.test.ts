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

  it("jumps to an estimated offset after twelve failed attempts and confirms the target once more", async () => {
    jest.useFakeTimers();
    try {
      let visible = { startIndex: 10, endIndex: 12 };
      const list = {
        scrollToIndex: jest.fn(async (_params: { index: number; animated?: boolean }) => {}),
        computeVisibleIndices: jest.fn(() => visible),
        scrollToOffset: jest.fn((_params: { offset: number; animated?: boolean }) => {
          visible = { startIndex: 499, endIndex: 501 };
        }),
        getLayout: jest.fn((index: number) =>
          index <= 20 ? { x: 0, y: index * 100, width: 300, height: 100 } : undefined,
        ),
      };
      const scrolling = scrollToVisibleIndex(
        () => list as never,
        500,
        false,
        () => true,
      );
      await jest.advanceTimersByTimeAsync(12 * 80);
      expect(list.scrollToIndex).toHaveBeenCalledTimes(12);
      expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 50000, animated: false });
      await jest.advanceTimersByTimeAsync(300);
      await expect(scrolling).resolves.toBe("estimated");
      expect(list.scrollToIndex).toHaveBeenCalledTimes(13);
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports a failure the reader can retry when the estimate still does not show the target", async () => {
    jest.useFakeTimers();
    try {
      const list = {
        scrollToIndex: jest.fn(async () => {}),
        computeVisibleIndices: jest.fn(() => ({ startIndex: 0, endIndex: 2 })),
        scrollToOffset: jest.fn(),
        getLayout: jest.fn(() => ({ x: 0, y: 0, width: 300, height: 80 })),
      };
      const scrolling = scrollToVisibleIndex(
        () => list as never,
        400,
        false,
        () => true,
      );
      await jest.advanceTimersByTimeAsync(12 * 80 + 300);
      await expect(scrolling).resolves.toBe("failed");
    } finally {
      jest.useRealTimers();
    }
  });
});
