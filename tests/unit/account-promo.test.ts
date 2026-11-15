import { isAccountPromoVisible, type AccountPromoState } from "@/lib/auth/account-promo";
import { ACCOUNT_PROMO_DISMISS_MS, isAccountPromoDismissed } from "@/lib/settings/context";

jest.mock("@/lib/supabase", () => ({ isSupabaseConfigured: () => true }));

const guest: AccountPromoState = {
  syncConfigured: true,
  authInitialized: true,
  authLoading: false,
  signedIn: false,
  dismissed: false,
  completedReviews: 0,
};

describe("account promotion visibility", () => {
  it("shows Home to a settled guest and waits for a first review on Progress", () => {
    expect(isAccountPromoVisible("home", guest)).toBe(true);
    expect(isAccountPromoVisible("progress", guest)).toBe(false);
    expect(isAccountPromoVisible("progress", { ...guest, completedReviews: 1 })).toBe(true);
  });

  it("hides both surfaces with one shared dismissal", () => {
    const dismissed = { ...guest, dismissed: true, completedReviews: 3 };
    expect(isAccountPromoVisible("home", dismissed)).toBe(false);
    expect(isAccountPromoVisible("progress", dismissed)).toBe(false);
  });

  it.each([
    ["sync is not configured", { syncConfigured: false }],
    ["auth has not initialized", { authInitialized: false }],
    ["auth is loading", { authLoading: true }],
    ["the user is signed in", { signedIn: true }],
  ])("hides while %s", (_case, change) => {
    expect(isAccountPromoVisible("home", { ...guest, ...change })).toBe(false);
  });

  it("lets the shared dismissal lapse after fourteen days", () => {
    const now = Date.parse("2026-11-15T12:00:00.000Z");
    expect(isAccountPromoDismissed(new Date(now - 1000).toISOString(), now)).toBe(true);
    expect(isAccountPromoDismissed(new Date(now - ACCOUNT_PROMO_DISMISS_MS - 1).toISOString(), now)).toBe(false);
  });
});
