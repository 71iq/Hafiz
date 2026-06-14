import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "components/profile/ProfileModalContent.tsx"), "utf8");
const strings = fs.readFileSync(path.join(root, "lib/i18n/strings.ts"), "utf8");

describe("profile edit modal contract", () => {
  it("uses the wider reference-style edit profile modal layout", () => {
    expect(source).toContain("const EDIT_PROFILE_MODAL_MAX_WIDTH = 780;");
    expect(source).toContain("const EDIT_PROFILE_AVATAR_SIZE = 118;");
    expect(source).toContain("maxWidth={EDIT_PROFILE_MODAL_MAX_WIDTH}");
    expect(source).toContain("surfaceColor={isDark ? themeColors.surfaceLow : themeColors.surfaceBright}");
    expect(source).toContain("ProfileEditActionButton");
    expect(source).toContain("ProfileEditFieldLabel");
    expect(source).toContain("profileEditIntroSubtitle");
  });

  it("keeps profile edit copy bilingual and aligned with the new reference", () => {
    expect(strings).toContain('profileEditIntroSubtitle: "Update how your profile appears"');
    expect(strings).toContain('profileEditIntroSubtitle: "حدّث طريقة ظهور ملفك"');
    expect(strings).toContain('profileCountryPlaceholder: "Select your country"');
    expect(strings).toContain('profileCountryPlaceholder: "اختر بلدك"');
    expect(strings).toContain('profileRemovePhoto: "Remove"');
    expect(strings).toContain('profileRemovePhoto: "إزالة"');
  });
});
