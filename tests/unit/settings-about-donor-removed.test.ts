import fs from "node:fs";
import path from "node:path";
import { strings } from "@/lib/i18n/strings";

const settingsSource = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/settings.tsx"), "utf8");

describe("settings About without a donor placeholder (W14)", () => {
  it("shows no donor row or coming-soon dialog while there is no way to donate", () => {
    expect(settingsSource).not.toContain("settingsBecomeDonor");
    expect(settingsSource).not.toContain("donorModalVisible");
    for (const locale of [strings.en, strings.ar]) {
      expect(Object.keys(locale).some((key) => key.startsWith("settingsBecomeDonor"))).toBe(false);
    }
  });
});
