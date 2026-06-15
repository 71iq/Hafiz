import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "app/(tabs)/settings.tsx"), "utf8");

describe("settings account row contract", () => {
  it("keeps profile identity and chevron on one horizontal row", () => {
    const accountStart = source.indexOf('{activeCategory === "account"');
    const aboutStart = source.indexOf('{activeCategory === "about"', accountStart);
    const accountSource = source.slice(accountStart, aboutStart);

    expect(accountStart).toBeGreaterThan(-1);
    expect(aboutStart).toBeGreaterThan(accountStart);
    expect(accountSource).toContain('${isRTL ? "flex-row-reverse" : "flex-row"}');
    expect(accountSource).toContain('direction: "ltr"');
    expect(accountSource).toContain('flexDirection: isRTL ? "row-reverse" : "row"');
    expect(accountSource).toContain("<ProfileIdentity");
    expect(accountSource).toContain('avatarSize={52}');
    expect(accountSource).toContain('className="h-6 w-6 shrink-0 items-center justify-center"');
    expect(accountSource).toContain("<TranslationChevron size={18}");
  });
});
