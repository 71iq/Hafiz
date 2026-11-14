import { renderHook, waitFor } from "@testing-library/react-native";
import type { DatabaseExecutor } from "@/lib/database/types";
import { loadMySabaqAssignment } from "@/lib/halaqa/sabaq-assignment";
import { useAssignedSabaq } from "@/lib/halaqa/use-assigned-sabaq";
import { assignedSabaqOpen } from "@/lib/hifz/sabaq";

jest.mock("@/lib/halaqa/sabaq-assignment", () => ({ loadMySabaqAssignment: jest.fn() }));
jest.mock("@/lib/hifz/sabaq", () => ({ assignedSabaqOpen: jest.fn() }));
let mockOffline = false;
jest.mock("@/lib/social/use-social-query", () => ({ useIsOffline: () => mockOffline }));

const db = {} as DatabaseExecutor;
const USER = "00000000-0000-4000-8000-00000000000a";
const ASSIGNED = { page: 582, fromLine: 3, toLine: 9 };

beforeEach(() => {
  jest.clearAllMocks();
  mockOffline = false;
  jest.mocked(loadMySabaqAssignment).mockResolvedValue(ASSIGNED);
  jest.mocked(assignedSabaqOpen).mockResolvedValue(true);
});

describe("Home's teacher sabaq (SOC-03)", () => {
  it("shows an assignment while its lines wait, and hides it once they are memorized", async () => {
    const { result, rerender } = renderHook(({ key }: { key: number }) => useAssignedSabaq(db, USER, key), {
      initialProps: { key: 1 },
    });
    await waitFor(() => expect(result.current).toEqual(ASSIGNED));
    jest.mocked(assignedSabaqOpen).mockResolvedValue(false);
    rerender({ key: 2 });
    await waitFor(() => expect(result.current).toBeNull());
    // A minute has not passed, so the server is not asked again; only the lines are checked.
    expect(loadMySabaqAssignment).toHaveBeenCalledTimes(1);
    expect(assignedSabaqOpen).toHaveBeenCalledTimes(2);
  });

  it("asks the server again once a copy read offline can be refreshed", async () => {
    mockOffline = true;
    const { result, rerender } = renderHook(({ key }: { key: number }) => useAssignedSabaq(db, USER, key), {
      initialProps: { key: 1 },
    });
    await waitFor(() => expect(result.current).toEqual(ASSIGNED));
    expect(loadMySabaqAssignment).toHaveBeenLastCalledWith(USER, true);
    mockOffline = false;
    jest.mocked(loadMySabaqAssignment).mockResolvedValue(null);
    rerender({ key: 1 });
    await waitFor(() => expect(result.current).toBeNull());
    expect(loadMySabaqAssignment).toHaveBeenLastCalledWith(USER, false);
  });

  it("shows nothing when the lines cannot be checked, or for another account", async () => {
    jest.mocked(assignedSabaqOpen).mockRejectedValue(new Error("database closed"));
    const { result, rerender } = renderHook(({ user }: { user: string | null }) => useAssignedSabaq(db, user, 1), {
      initialProps: { user: USER as string | null },
    });
    await waitFor(() => expect(assignedSabaqOpen).toHaveBeenCalled());
    expect(result.current).toBeNull();
    jest.mocked(loadMySabaqAssignment).mockResolvedValue(null);
    rerender({ user: null });
    await waitFor(() => expect(loadMySabaqAssignment).toHaveBeenLastCalledWith(null, false));
    expect(result.current).toBeNull();
  });
});
