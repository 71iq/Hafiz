import { formatSocialDate } from "@/lib/social/text";

describe("social dates", () => {
  it("writes Arabic dates in Arabic-Indic digits, as the rest of the Arabic interface does", () => {
    expect(formatSocialDate("2026-11-14", "ar")).toContain("١٤");
    expect(formatSocialDate("2026-11-14", "ar")).not.toMatch(/[0-9]/);
    expect(formatSocialDate("2026-11-14", "en")).toContain("14");
  });

  it("keeps a calendar date on its own day, and shows an instant on the reader's day", () => {
    expect(formatSocialDate("2026-11-14", "en")).toMatch(/14/);
    const instant = new Date(2026, 10, 14, 0, 30);
    const day = new Intl.DateTimeFormat("en", { day: "numeric" }).format(instant);
    expect(formatSocialDate(instant.toISOString(), "en")).toContain(day);
  });
});
