import { errorMessage } from "@/lib/error-message";

describe("RF-194 errorMessage", () => {
  it("reads the message of Error instances and plain Supabase error objects unchanged", () => {
    expect(errorMessage(new Error("Invalid login credentials"))).toBe("Invalid login credentials");
    expect(errorMessage({ code: "42501", message: "permission denied", details: null })).toBe("permission denied");
    expect(errorMessage({ message: "" })).toBe("");
  });

  it("returns undefined when there is no text message, so callers keep their fallback", () => {
    expect(errorMessage(null)).toBeUndefined();
    expect(errorMessage(undefined)).toBeUndefined();
    expect(errorMessage("offline")).toBeUndefined();
    expect(errorMessage({ message: 5 })).toBeUndefined();
  });
});
