import { useAuthStore } from "@/lib/auth/store";
import { startAppOAuth } from "@/lib/auth/oauth";
import { supabase } from "@/lib/supabase";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: {
      signUp: jest.fn(),
      resend: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      signInWithOAuth: jest.fn(),
    },
  },
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("expo-linking", () => ({ createURL: () => "hafiz://auth/callback" }));
jest.mock("@/lib/quran-foundation/user", () => ({
  connectQfFromSession: jest.fn(),
  connectQfProviderTokens: jest.fn(),
}));

describe("temporarily disabled account flows", () => {
  const originalEmailFlag = process.env.EXPO_PUBLIC_EMAIL_AUTH_FLOWS_ENABLED;
  const originalSocialFlag = process.env.EXPO_PUBLIC_SOCIAL_AUTH_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_EMAIL_AUTH_FLOWS_ENABLED = "false";
    process.env.EXPO_PUBLIC_SOCIAL_AUTH_ENABLED = "false";
  });
  afterAll(() => {
    if (originalEmailFlag === undefined) delete process.env.EXPO_PUBLIC_EMAIL_AUTH_FLOWS_ENABLED;
    else process.env.EXPO_PUBLIC_EMAIL_AUTH_FLOWS_ENABLED = originalEmailFlag;
    if (originalSocialFlag === undefined) delete process.env.EXPO_PUBLIC_SOCIAL_AUTH_ENABLED;
    else process.env.EXPO_PUBLIC_SOCIAL_AUTH_ENABLED = originalSocialFlag;
  });

  it("rejects signup, confirmation resend and recovery without a request", async () => {
    const store = useAuthStore.getState();
    await expect(store.signUp("qa@example.invalid", "password", "qauser", "QA")).rejects.toThrow(
      "temporarily unavailable",
    );
    await expect(store.resendSignupConfirmation("qa@example.invalid")).rejects.toThrow("temporarily unavailable");
    await expect(store.sendPasswordReset("qa@example.invalid")).rejects.toThrow("temporarily unavailable");
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
    expect(supabase.auth.resend).not.toHaveBeenCalled();
    expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("rejects Google sign-in and linking without a request", async () => {
    await expect(startAppOAuth("google")).rejects.toThrow("temporarily unavailable");
    await expect(startAppOAuth("google", "link")).rejects.toThrow("temporarily unavailable");
    expect(supabase.auth.signInWithOAuth).not.toHaveBeenCalled();
  });
});
