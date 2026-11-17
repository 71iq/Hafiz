import { readFileSync } from "fs";
import path from "path";

jest.mock("@/lib/supabase", () => ({ supabase: { auth: {} }, isSupabaseConfigured: () => false }));

import { buildInsertUsername } from "@/lib/auth/store";

// The sign-up trigger and the app's missing-profile fallback must give a provider account the same
// handle, so whichever creates the profile first, the user sees one stable @handle.
describe("provider sign-up username", () => {
  const migration = readFileSync(
    path.join(__dirname, "../../supabase/migrations/20261117213000_provider_signup_username.sql"),
    "utf8",
  );

  it("falls back to user_ plus the first eight hex digits of the account id in the trigger", () => {
    expect(migration).toContain("account_hex text := replace(NEW.id::text, '-', '');");
    expect(migration).toContain("'user_' || left(account_hex, 8)");
  });

  it("matches the app's fallback for an account without a provider handle", () => {
    const user = {
      id: "11111111-2222-3333-4444-555555555555",
      email: "someone@example.com",
      user_metadata: { full_name: "Real Name", email: "someone@example.com" },
    } as unknown as Parameters<typeof buildInsertUsername>[0];
    expect(buildInsertUsername(user)).toBe("user_11111111");
  });
});
