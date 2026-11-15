import { act, renderHook } from "@testing-library/react-native";
import type { AyahAudioTarget } from "@/lib/audio/ayah-audio";
import { useFollowRecitation } from "@/lib/audio/use-follow-recitation";

type Props = { followEnabled: boolean; rangeActive: boolean; recitingAyah: AyahAudioTarget | null };

function setup(initial: Props) {
  const follow = jest.fn();
  const view = renderHook((props: Props) => useFollowRecitation({ ...props, follow }), { initialProps: initial });
  return { follow, view };
}

describe("follow recitation", () => {
  it("follows each new range ayah until a manual scroll suspends it, without a second control", () => {
    const { follow, view } = setup({ followEnabled: true, rangeActive: true, recitingAyah: { surah: 2, ayah: 1 } });
    expect(follow).toHaveBeenLastCalledWith({ surah: 2, ayah: 1 });

    view.rerender({ followEnabled: true, rangeActive: true, recitingAyah: { surah: 2, ayah: 2 } });
    expect(follow).toHaveBeenCalledTimes(2);

    act(() => view.result.current.suspend());
    expect(view.result.current.suspended).toBe(true);
    view.rerender({ followEnabled: true, rangeActive: true, recitingAyah: { surah: 2, ayah: 3 } });
    expect(follow).toHaveBeenCalledTimes(2);

    act(() => view.result.current.backToAyah());
    expect(view.result.current.suspended).toBe(false);
    expect(follow).toHaveBeenLastCalledWith({ surah: 2, ayah: 3 });
    view.rerender({ followEnabled: true, rangeActive: true, recitingAyah: { surah: 2, ayah: 4 } });
    expect(follow).toHaveBeenLastCalledWith({ surah: 2, ayah: 4 });
  });

  it("does not move on re-renders that keep the same ayah", () => {
    const { follow, view } = setup({ followEnabled: true, rangeActive: true, recitingAyah: { surah: 1, ayah: 1 } });
    view.rerender({ followEnabled: true, rangeActive: true, recitingAyah: { surah: 1, ayah: 1 } });
    expect(follow).toHaveBeenCalledTimes(1);
  });

  it("ends the suspension with the recitation, so the next one follows again", () => {
    const { follow, view } = setup({ followEnabled: true, rangeActive: true, recitingAyah: { surah: 1, ayah: 1 } });
    act(() => view.result.current.suspend());
    view.rerender({ followEnabled: true, rangeActive: false, recitingAyah: null });
    expect(view.result.current.suspended).toBe(false);
    view.rerender({ followEnabled: true, rangeActive: true, recitingAyah: { surah: 3, ayah: 1 } });
    expect(follow).toHaveBeenLastCalledWith({ surah: 3, ayah: 1 });
  });

  it("keeps the saved preference separate: off never follows or suspends, on recenters", () => {
    const { follow, view } = setup({ followEnabled: false, rangeActive: true, recitingAyah: { surah: 1, ayah: 1 } });
    expect(follow).not.toHaveBeenCalled();
    act(() => view.result.current.suspend());
    expect(view.result.current.suspended).toBe(false);

    view.rerender({ followEnabled: true, rangeActive: true, recitingAyah: { surah: 1, ayah: 2 } });
    expect(follow).toHaveBeenLastCalledWith({ surah: 1, ayah: 2 });
  });

  it("never follows when no range recites (single ayahs are not followed)", () => {
    const { follow, view } = setup({ followEnabled: true, rangeActive: false, recitingAyah: null });
    act(() => view.result.current.suspend());
    expect(view.result.current.suspended).toBe(false);
    expect(follow).not.toHaveBeenCalled();
  });
});
