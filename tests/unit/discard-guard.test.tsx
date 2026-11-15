import { act, renderHook } from "@testing-library/react-native";
import { isEditableTextDirty, useDiscardGuard } from "@/components/ui/DiscardChangesDialog";

describe("discard guard (C02)", () => {
  it("compares normalized text against the loaded baseline", () => {
    expect(isEditableTextDirty("  note\r\n", "note")).toBe(false);
    expect(isEditableTextDirty("note!", "note")).toBe(true);
    expect(isEditableTextDirty("", null)).toBe(false);
  });

  it("proceeds at once when clean", () => {
    const proceed = jest.fn();
    const { result } = renderHook(() => useDiscardGuard(false));
    act(() => result.current.guard(proceed));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(result.current.confirming).toBe(false);
  });

  it("keeps editing without running the close, and discards only on confirmation", () => {
    const proceed = jest.fn();
    const onDiscard = jest.fn();
    const { result } = renderHook(() => useDiscardGuard(true, onDiscard));
    act(() => result.current.guard(proceed));
    expect(result.current.confirming).toBe(true);
    act(() => result.current.dialogProps.onKeepEditing());
    expect(proceed).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();

    act(() => result.current.guard(proceed));
    act(() => result.current.dialogProps.onDiscard());
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(result.current.confirming).toBe(false);
  });
});
