import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_TRANSLATION_LANGUAGE,
  TRANSLATION_LANGUAGES,
  getLanguageByCode,
} from "@/lib/translations/languages";
import { translationRequires } from "@/lib/translations/translation-requires";

const root = process.cwd();

describe("translation language contracts", () => {
  it("keeps the UI default and translation default valid", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(getLanguageByCode(DEFAULT_LANGUAGE)).toBeTruthy();
    expect(DEFAULT_TRANSLATION_LANGUAGE).toBe("en-bridges");
    expect(getLanguageByCode(DEFAULT_TRANSLATION_LANGUAGE)).toBeTruthy();
  });

  it("keeps language codes unique", () => {
    const codes = TRANSLATION_LANGUAGES.map((language) => language.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("keeps the expected translation catalog size", () => {
    expect(TRANSLATION_LANGUAGES).toHaveLength(22);
    expect(Object.keys(translationRequires)).toHaveLength(21);
  });

  it("keeps RTL translation languages marked correctly", () => {
    const rtlCodes = TRANSLATION_LANGUAGES
      .filter((language) => language.direction === "rtl")
      .map((language) => language.code)
      .sort();

    expect(rtlCodes).toEqual(["fa", "ku", "ps", "sd", "ur"]);
  });

  test.each(Object.keys(translationRequires).sort())("%s translation asset exists", (code) => {
    expect(fs.existsSync(path.join(root, `assets/data/translations/${code}.json`))).toBe(true);
  });

  it("keeps every non-base translation loadable through the static require membership map", () => {
    const importableCodes = TRANSLATION_LANGUAGES
      .map((language) => language.code)
      .filter((code) => code !== "en")
      .sort();

    expect(Object.keys(translationRequires).sort()).toEqual(importableCodes);
  });
});
