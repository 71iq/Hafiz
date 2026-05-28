import { spawnSync } from "node:child_process";

describe("Mushaf page-token data", () => {
  it("keeps page-word rendering tokens aligned with canonical QCF2 page data", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-mushaf-page-tokens.js"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verified 604 pages");
  });
});
