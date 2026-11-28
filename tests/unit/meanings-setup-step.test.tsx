import React, { useEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { MeaningsLevelCheck } from "@/components/hifz/MeaningsLevelCheck";
import {
  draftLanguage,
  draftLevel,
  initialMeaningsDraft,
  MeaningsSetupStep,
  meaningsSetupOf,
  type MeaningsDraft,
  type StoredMeanings,
} from "@/components/hifz/MeaningsSetupStep";
import type { DatabaseExecutor } from "@/lib/database/types";
import { strings } from "@/lib/i18n/strings";
import type { CheckItem } from "@/lib/meanings/check-bank";
import { MAX_QUESTIONS } from "@/lib/meanings/level-check";
import { DirectionProvider } from "@/lib/ui/direction";

// The ayah is drawn in its page font on device; the check's logic only needs the item to load.
jest.mock("@/components/flashcards/Qcf2AyahText", () => ({ Qcf2AyahText: () => null }));

/** The setup step's "Word meanings" choices and its level check (SPEC 3.6), over a synthetic bank. */
const s = strings.en;
const position = (ayah: number) => ({ surah: 2, ayah, pos: 1 });
// Eight English items per boundary; every right answer is an ayah below 100, every wrong one above.
const bank: CheckItem[] = [1, 2, 3, 4, 5].flatMap((boundary) =>
  Array.from({ length: 8 }, (_, i) => ({
    boundary: boundary as CheckItem["boundary"],
    language: "en" as const,
    word: position(boundary * 10 + i),
    distractors: [position(100 + i), position(110 + i), position(120 + i)] as const,
  })),
);
const db = {
  getFirstAsync: jest.fn(async (sql: string, params: number[]) => {
    if (sql.includes("quran_text")) return { textQcf2: "x", textUthmani: "x", v2Page: 1 };
    if (sql.includes("word_translations")) return { translation_en: `meaning ${params[0]}:${params[1]}:${params[2]}` };
    return null;
  }),
} as unknown as DatabaseExecutor;

let latest: MeaningsDraft;
const record = (draft: MeaningsDraft) => {
  latest = draft;
};
function Harness({
  stored = null,
  checkBank = bank,
}: {
  stored?: StoredMeanings | null;
  checkBank?: readonly CheckItem[];
}) {
  const [draft, setDraft] = useState(() => initialMeaningsDraft(stored));
  useEffect(() => record(draft), [draft]);
  return (
    <DirectionProvider dir="ltr">
      <MeaningsSetupStep
        db={db}
        draft={draft}
        stored={stored}
        onChange={(update) => setDraft(update)}
        language="en"
        fontSize={20}
        lineHeight={40}
        s={s}
        bank={checkBank}
      />
    </DirectionProvider>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) });
const isChecked = (name: string) => radio(name).props.accessibilityState?.checked;

it("starts with neither level choice made and has Choose for me name the level from the two answers", () => {
  render(<Harness />);
  expect(isChecked(s.meaningsCheckMyLevel)).toBe(false);
  expect(isChecked(s.meaningsChooseForMe)).toBe(false);
  expect(screen.queryByText(s.meaningsKeepLevel)).toBeNull();

  fireEvent.press(radio(s.meaningsChooseForMe));
  expect(screen.getByText(s.meaningsRateFirst)).toBeTruthy();
  fireEvent.press(radio(s.meaningsRateArabic1));
  fireEvent.press(radio(s.meaningsRateRecited1));
  // One and one of six is level 2: the commonest 400 words.
  expect(screen.getByText("You know the commonest 400 words.")).toBeTruthy();
  expect(screen.getByText(s.meaningsLevelAdjusts)).toBeTruthy();
  expect(draftLevel(latest)).toBe(2);
});

it("suggests the meaning language from the Arabic answer until the user picks one", () => {
  render(<Harness />);
  // Nothing answered: the interface language.
  expect(isChecked(s.meaningsLanguageEnglish)).toBe(true);
  fireEvent.press(radio(s.meaningsRateArabic3));
  expect(isChecked(s.meaningsLanguageArabic)).toBe(true);
  fireEvent.press(radio(s.meaningsRateArabic0));
  expect(isChecked(s.meaningsLanguageEnglish)).toBe(true);
  fireEvent.press(radio(s.meaningsLanguageArabic));
  fireEvent.press(radio(s.meaningsRateArabic0));
  expect(isChecked(s.meaningsLanguageArabic)).toBe(true);
  expect(draftLanguage(latest, null, "en")).toBe("ar");
  expect(meaningsSetupOf(latest, null, "en").languagePicked).toBe(true);
});

it("offers Check my level only when the bank has items in the meaning language", () => {
  const view = render(<Harness checkBank={[]} />);
  expect(screen.queryByText(s.meaningsCheckMyLevel)).toBeNull();
  view.unmount();

  render(<Harness />);
  expect(screen.getByText(s.meaningsCheckMyLevel)).toBeTruthy();
  // The synthetic bank is English only.
  fireEvent.press(radio(s.meaningsLanguageArabic));
  expect(screen.queryByText(s.meaningsCheckMyLevel)).toBeNull();
});

async function runCheck(answerRight: boolean) {
  for (let question = 0; question < MAX_QUESTIONS; question += 1) {
    if (screen.queryByText(s.meaningsCheckAgain)) return question;
    await act(async () => {});
    if (answerRight) {
      const right = screen
        .getAllByText(/^meaning 2:\d+:1$/)
        .find((option) => Number(/2:(\d+):1/.exec(String(option.props.children))![1]) < 100);
      fireEvent.press(right!);
    } else {
      fireEvent.press(screen.getByText(s.meaningsCheckDontKnow));
    }
    await act(async () => {});
  }
  return MAX_QUESTIONS;
}

it("runs the check from the answers and reports the level, and Check again starts over", async () => {
  render(<Harness />);
  fireEvent.press(radio(s.meaningsRateArabic1));
  fireEvent.press(radio(s.meaningsRateRecited1));
  fireEvent.press(radio(s.meaningsCheckMyLevel));
  await act(async () => {});
  expect(screen.getByText(s.meaningsCheckPrompt)).toBeTruthy();
  expect(screen.getByText("Question 1 of up to 12")).toBeTruthy();

  const asked = await runCheck(true);
  expect(asked).toBeGreaterThanOrEqual(6);
  expect(screen.getByText("You know the commonest 2,400 words.")).toBeTruthy();
  expect(meaningsSetupOf(latest, null, "en")).toEqual({
    inDailyStudy: true,
    language: "en",
    languagePicked: false,
    level: 5,
  });

  fireEvent.press(screen.getByText(s.meaningsCheckAgain));
  await act(async () => {});
  expect(screen.getByText("Question 1 of up to 12")).toBeTruthy();
  await runCheck(false);
  expect(screen.getByText(s.meaningsLevelStart)).toBeTruthy();
  expect(screen.getByText(s.meaningsLevelAdjustsStart)).toBeTruthy();
  expect(draftLevel(latest)).toBe(0);
});

it("asks for the two answers before a check on a first setup", () => {
  render(<Harness />);
  fireEvent.press(radio(s.meaningsCheckMyLevel));
  expect(screen.getByText(s.meaningsRateFirst)).toBeTruthy();
  expect(screen.queryByText(s.meaningsCheckPrompt)).toBeNull();
});

it("starts a plan edit with a stored level on Keep, which saves no level", async () => {
  const stored: StoredMeanings = { on: true, language: "en", level: 2 };
  render(<Harness stored={stored} />);
  expect(isChecked(s.meaningsKeepLevel)).toBe(true);
  expect(screen.getByText("You know the commonest 400 words.")).toBeTruthy();
  expect(meaningsSetupOf(latest, stored, "ar")).toEqual({
    inDailyStudy: true,
    language: "en",
    languagePicked: false,
    level: null,
  });

  // A stored level is enough to start the check without the two answers.
  fireEvent.press(radio(s.meaningsCheckMyLevel));
  await act(async () => {});
  expect(screen.getByText(s.meaningsCheckPrompt)).toBeTruthy();
});

it("hides the questions while meanings are out of daily study", () => {
  render(<Harness />);
  fireEvent.press(screen.getByRole("switch", { name: s.studyDecksMeaningsHint }));
  expect(latest.on).toBe(false);
  expect(screen.queryByText(s.meaningsRateArabic)).toBeNull();
  expect(meaningsSetupOf(latest, null, "en")).toEqual({
    inDailyStudy: false,
    language: "en",
    languagePicked: false,
    level: null,
  });
});

it("names the marked word for screen readers", async () => {
  const ayahDb = {
    getFirstAsync: jest.fn(async (sql: string, params: number[]) => {
      if (sql.includes("quran_text")) return { textQcf2: "G1 G2 END", textUthmani: "بِسْمِ ٱللَّهِ", v2Page: 1 };
      if (sql.includes("word_translations"))
        return { translation_en: `meaning ${params[0]}:${params[1]}:${params[2]}` };
      return null;
    }),
  } as unknown as DatabaseExecutor;
  const item: CheckItem = {
    boundary: 1,
    language: "en",
    word: { surah: 1, ayah: 1, pos: 2 },
    distractors: [position(101), position(102), position(103)],
  };
  render(
    <DirectionProvider dir="ltr">
      <MeaningsLevelCheck
        db={ayahDb}
        language="en"
        centre={0}
        seed={1}
        uiLanguage="en"
        fontSize={20}
        lineHeight={40}
        s={s}
        onDone={jest.fn()}
        bank={[item]}
      />
    </DirectionProvider>,
  );
  await act(async () => {});
  expect(screen.getByRole("header").props.accessibilityLabel).toBe("What does the marked word, ٱللَّهِ, mean?");
});
