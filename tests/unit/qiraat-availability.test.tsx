import { renderHook, waitFor } from "@testing-library/react-native";
import { useHasQiraat } from "@/lib/qiraat/availability";
import type { DatabaseExecutor } from "@/lib/database/types";

function db(rows: { surah: number; ayah: number }[] | Error) {
  const getAllAsync = jest.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  return { getAllAsync } as unknown as DatabaseExecutor & { getAllAsync: jest.Mock };
}

describe("Qira'at availability for the verse-card pill", () => {
  it("knows which ayahs have data and reads the table once per connection", async () => {
    const connection = db([{ surah: 2, ayah: 255 }]);
    const first = renderHook(() => useHasQiraat(connection, 2, 255));
    await waitFor(() => expect(first.result.current).toBe(true));
    const second = renderHook(() => useHasQiraat(connection, 1, 1));
    await waitFor(() => expect(second.result.current).toBe(false));
    expect(connection.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it("treats a failed read as unknown, not as absent", async () => {
    const connection = db(new Error("no such table"));
    const { result } = renderHook(() => useHasQiraat(connection, 2, 255));
    await waitFor(() => expect(connection.getAllAsync).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
