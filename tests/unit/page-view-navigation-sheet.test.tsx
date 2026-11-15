import { pageLayoutMenuItems } from "@/components/mushaf/PageViewNavigationSheet";
import { strings } from "@/lib/i18n/strings";

describe.each(["en", "ar"] as const)("Page layout choices (%s)", (locale) => {
  const s = strings[locale];

  it("offers Scroll and Swipe as one radio group that marks the current layout", () => {
    const items = pageLayoutMenuItems(s, "vertical", jest.fn());
    expect(items.map((item) => item.label)).toEqual([s.pageScrollVertical, s.pageScrollHorizontal]);
    expect(items.map((item) => item.checked)).toEqual([true, false]);
    expect(new Set(items.map((item) => item.group))).toEqual(new Set([s.pageLayoutGroup]));
  });

  it("uses the one shared direction handler for both choices", () => {
    const setPageScroll = jest.fn();
    const [scroll, swipe] = pageLayoutMenuItems(s, "horizontal", setPageScroll);
    swipe.onPress();
    scroll.onPress();
    expect(setPageScroll.mock.calls).toEqual([["horizontal"], ["vertical"]]);
    expect(swipe.checked).toBe(true);
  });
});

it("names the two Arabic layouts distinctly", () => {
  expect(strings.ar.pageScrollVertical).toBe("تمرير عمودي");
  expect(strings.ar.pageScrollHorizontal).toBe("تقليب الصفحات");
  expect(strings.en.pageScrollVertical).toBe("Scroll");
  expect(strings.en.pageScrollHorizontal).toBe("Swipe");
});
