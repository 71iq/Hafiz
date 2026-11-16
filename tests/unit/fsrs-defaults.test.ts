import { DEFAULT_DECK_MAXIMUM_INTERVAL, DEFAULT_DECK_REQUEST_RETENTION, DEFAULT_ENABLED_MODES } from "@/lib/fsrs/types";

describe("FSRS deck defaults", () => {
  it("keeps Quran memorization FSRS defaults", () => {
    expect(DEFAULT_DECK_REQUEST_RETENTION).toBe(0.95);
    expect(DEFAULT_DECK_MAXIMUM_INTERVAL).toBe(365);
    expect(DEFAULT_ENABLED_MODES).toContain("nextAyah");
    expect(DEFAULT_ENABLED_MODES).toContain("translation");
  });
});
