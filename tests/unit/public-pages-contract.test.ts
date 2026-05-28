import {
  PUBLIC_PAGE_CONTENT,
  PUBLIC_PAGE_LABELS,
  type PublicPageContent,
  type PublicPageKey,
  type PublicPageLanguage,
  type PublicPageLink,
} from "@/lib/public-pages/content";

const pageKeys = Object.keys(PUBLIC_PAGE_CONTENT) as PublicPageKey[];
const languages = Object.keys(PUBLIC_PAGE_LABELS) as PublicPageLanguage[];

function allText(content: PublicPageContent): string {
  return [
    content.eyebrow,
    content.title,
    content.description,
    content.lastUpdated ?? "",
    ...content.sections.flatMap((section) => [
      section.title,
      ...(section.body ?? []),
      ...(section.bullets ?? []),
      ...(section.links ?? []).flatMap((link) => [link.label, link.href]),
    ]),
    ...content.actions.flatMap((link) => [link.label, link.href]),
  ].join("\n");
}

function collectLinks(content: PublicPageContent): PublicPageLink[] {
  return [
    ...content.actions,
    ...content.sections.flatMap((section) => section.links ?? []),
  ];
}

describe("public page content contracts", () => {
  it("keeps the public page inventory stable", () => {
    expect(pageKeys.sort()).toEqual(["about", "privacy", "terms"]);
    expect(languages.sort()).toEqual(["ar", "en"]);
  });

  test.each(pageKeys)("%s has English and Arabic structural parity", (pageKey) => {
    const english = PUBLIC_PAGE_CONTENT[pageKey].en;
    const arabic = PUBLIC_PAGE_CONTENT[pageKey].ar;

    expect(arabic.sections).toHaveLength(english.sections.length);
    expect(arabic.actions).toHaveLength(english.actions.length);
    expect(arabic.lastUpdated ? true : false).toBe(english.lastUpdated ? true : false);

    for (let index = 0; index < english.sections.length; index += 1) {
      const enSection = english.sections[index];
      const arSection = arabic.sections[index];
      expect(arSection.body?.length ?? 0).toBe(enSection.body?.length ?? 0);
      expect(arSection.bullets?.length ?? 0).toBe(enSection.bullets?.length ?? 0);
      expect(arSection.links?.length ?? 0).toBe(enSection.links?.length ?? 0);
      expect(arSection.id ?? null).toBe(enSection.id ?? null);
    }

    expect(arabic.actions.map((link) => link.href)).toEqual(english.actions.map((link) => link.href));
  });

  test.each(pageKeys.flatMap((pageKey) => languages.map((language) => [pageKey, language] as const)))(
    "%s.%s has complete visible content",
    (pageKey, language) => {
      const content = PUBLIC_PAGE_CONTENT[pageKey][language];

      expect(content.eyebrow.trim()).toBeTruthy();
      expect(content.title.trim()).toBeTruthy();
      expect(content.description.trim()).toBeTruthy();
      expect(content.sections.length).toBeGreaterThanOrEqual(3);
      expect(content.actions.length).toBeGreaterThanOrEqual(2);

      for (const section of content.sections) {
        expect(section.title.trim()).toBeTruthy();
        expect((section.body?.length ?? 0) + (section.bullets?.length ?? 0) + (section.links?.length ?? 0)).toBeGreaterThan(0);
      }
    }
  );

  test.each(pageKeys.flatMap((pageKey) => languages.map((language) => [pageKey, language] as const)))(
    "%s.%s links are explicitly classified",
    (pageKey, language) => {
      for (const link of collectLinks(PUBLIC_PAGE_CONTENT[pageKey][language])) {
        expect(link.label.trim()).toBeTruthy();
        expect(link.href).toMatch(/^(\/[a-z-]+|https:\/\/|mailto:)/);
        expect(link.external === true).toBe(link.href.startsWith("https://") || link.href.startsWith("mailto:"));
      }
    }
  );

  it("keeps public shell labels bilingual", () => {
    for (const labels of Object.values(PUBLIC_PAGE_LABELS)) {
      expect(Object.keys(labels).sort()).toEqual(["back", "external", "home", "language", "linkFailed"]);
      for (const value of Object.values(labels)) {
        expect(value.trim()).toBeTruthy();
      }
    }
  });

  it("keeps privacy disclosures aligned with the QF and Supabase boundary", () => {
    const english = allText(PUBLIC_PAGE_CONTENT.privacy.en);
    const arabic = allText(PUBLIC_PAGE_CONTENT.privacy.ar);

    expect(english).toMatch(/Supabase/);
    expect(english).toMatch(/Quran Foundation/);
    expect(english).toMatch(/We do not sell your personal data/);
    expect(arabic).toMatch(/Supabase/);
    expect(arabic).toMatch(/Quran Foundation/);
    expect(arabic).toMatch(/لا نبيع بياناتك الشخصية/);
  });

  it("keeps terms tied to third-party source notices", () => {
    expect(allText(PUBLIC_PAGE_CONTENT.terms.en)).toMatch(/third-party sources/);
    expect(allText(PUBLIC_PAGE_CONTENT.terms.ar)).toMatch(/مصادر خارجية/);
  });

  it("keeps public contact routes reachable from about content", () => {
    const english = allText(PUBLIC_PAGE_CONTENT.about.en);
    const arabic = allText(PUBLIC_PAGE_CONTENT.about.ar);

    expect(english).toMatch(/support@hafizquran\.app/);
    expect(english).toMatch(/privacy@hafizquran\.app/);
    expect(arabic).toMatch(/support@hafizquran\.app/);
    expect(arabic).toMatch(/privacy@hafizquran\.app/);
  });
});
