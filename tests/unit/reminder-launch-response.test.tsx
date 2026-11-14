import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReminderResponse } from "@/lib/notifications/platform-types";
import { recordReminderOpened, requestRemindLater } from "@/lib/notifications/schedule";
import { useReminderResponses } from "@/lib/notifications/use-reminder-scheduling";

// The remind-later action opens the app (platform.native.ts), so after Android ended the app's
// process the tap arrives as the launch response and must still set the follow-up.

const mockDb = { name: "synthetic" };
let mockLaunch: ReminderResponse | null = null;
let mockLive: ((response: ReminderResponse) => void) | null = null;

jest.mock("expo-router", () => ({
  usePathname: () => "/(tabs)/home",
  useRootNavigationState: () => ({ key: "root" }),
}));
jest.mock("@/lib/database/provider", () => ({ useDatabaseStatus: () => ({ db: mockDb, isReady: true }) }));
jest.mock("@/lib/auth/store", () => ({ useAuthStore: () => null }));
jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ isLoaded: true, uiLanguage: "en" }) }));
jest.mock("@/lib/notifications/platform", () => ({
  reminderPlatform: {
    takeLaunchResponse: async () => mockLaunch,
    subscribeResponses: (listener: (response: ReminderResponse) => void) => {
      mockLive = listener;
      return () => {
        if (mockLive === listener) mockLive = null;
      };
    },
  },
}));
jest.mock("@/lib/notifications/reminder-route", () => ({ openReminderRoute: jest.fn(async () => undefined) }));
jest.mock("@/lib/notifications/schedule", () => ({
  ...jest.requireActual<object>("@/lib/notifications/schedule"),
  requestRemindLater: jest.fn(async () => true),
  recordReminderOpened: jest.fn(async () => undefined),
}));

const data: ReminderResponse["data"] = {
  source: "hafiz-reminder",
  logId: "notif-1",
  type: "wird_reminder",
  localDate: "2026-11-14",
  route: "wird",
  at: Date.UTC(2026, 10, 14, 5, 0),
  contentKey: "synthetic",
};

beforeEach(() => {
  jest.mocked(requestRemindLater).mockClear();
  jest.mocked(recordReminderOpened).mockClear();
});

describe("a reminder action that opened the app (NOT-05b)", () => {
  it("sets the remind-later follow-up from the launch response", async () => {
    mockLaunch = { data, action: "remind_later" };
    renderHook(() => useReminderResponses());
    await waitFor(() => expect(requestRemindLater).toHaveBeenCalledWith(mockDb, mockLaunch));
    expect(recordReminderOpened).not.toHaveBeenCalled();
  });

  it("records a plain tap as opened instead", async () => {
    mockLaunch = { data, action: "open" } as ReminderResponse;
    renderHook(() => useReminderResponses());
    await waitFor(() => expect(recordReminderOpened).toHaveBeenCalledWith(mockDb, data));
    expect(requestRemindLater).not.toHaveBeenCalled();
  });

  it("acts once when a live response also arrives as the launch response, or on a new subscription", async () => {
    const live: ReminderResponse = { data: { ...data, logId: "notif-live" }, action: "remind_later" };
    mockLaunch = null;
    const first = renderHook(() => useReminderResponses());
    await waitFor(() => expect(mockLive).not.toBeNull());
    act(() => mockLive!(live));
    expect(requestRemindLater).toHaveBeenCalledTimes(1);

    // The OS kept it as the last response, and the listener subscribes again (database ready again).
    mockLaunch = live;
    first.unmount();
    const second = renderHook(() => useReminderResponses());
    await waitFor(() => expect(mockLive).not.toBeNull());
    act(() => mockLive!(live));
    await act(async () => undefined);
    expect(requestRemindLater).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("navigates once for a plain tap delivered twice", async () => {
    const tap: ReminderResponse = { data: { ...data, logId: "notif-tap" }, action: "open" };
    mockLaunch = tap;
    renderHook(() => useReminderResponses());
    await waitFor(() => expect(mockLive).not.toBeNull());
    act(() => mockLive!(tap));
    await act(async () => undefined);
    expect(recordReminderOpened).toHaveBeenCalledTimes(1);
  });
});
