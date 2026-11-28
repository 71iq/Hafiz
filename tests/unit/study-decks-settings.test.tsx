import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StudyDecksSettings } from "@/components/settings/StudyDecksSettings";
import { strings } from "@/lib/i18n/strings";
import { MEANINGS_SETTING_KEYS } from "@/lib/meanings/settings";
import { DirectionProvider } from "@/lib/ui/direction";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

jest.mock("@/lib/settings/context", () => ({ useSettings: () => ({ fontSize: 20, lineHeight: 40 }) }));
// One English item, so the check is offered for English meanings and not for Arabic ones.
jest.mock("@/lib/meanings/check-bank", () => ({
  CHECK_BANK: [{ boundary: 1, language: "en", word: { surah: 1, ayah: 1, pos: 1 }, distractors: [] }],
}));
// The check itself is covered in meanings-setup-step; here it reports level 4 when finished.
jest.mock("@/components/hifz/MeaningsLevelCheck", () => {
  const actual = jest.requireActual<typeof import("@/components/hifz/MeaningsLevelCheck")>(
    "@/components/hifz/MeaningsLevelCheck",
  );
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ...actual,
    MeaningsLevelCheck: ({ onDone, centre }: { onDone: (level: number) => void; centre: number }) => (
      <Pressable accessibilityRole="button" onPress={() => onDone(4)}>
        <Text>{`Finish the check from ${centre}`}</Text>
      </Pressable>
    ),
  };
});

/** Settings > Daily study: the word-meaning language and level (SPEC 3.6). */
const s = strings.en;
let store: OutboxDatabase;

beforeEach(async () => {
  store = await openOutboxDatabase();
  const put = store.sql.prepare("INSERT INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)");
  put.run(MEANINGS_SETTING_KEYS.language, "en", "2026-11-25T08:00:00.000Z");
  put.run(MEANINGS_SETTING_KEYS.level, "2", "2026-11-25T08:00:00.000Z");
});

afterEach(async () => {
  await store.close();
});

const stored = (key: string) =>
  (store.sql.prepare("SELECT value FROM user_settings WHERE key = ?").get(key) as { value: string } | undefined)
    ?.value ?? null;

async function renderSettings() {
  render(
    <DirectionProvider dir="ltr">
      <StudyDecksSettings db={store.db} language="en" s={s} />
    </DirectionProvider>,
  );
  await act(async () => {});
}

it("names the stored level and moves it one band toward commoner or rarer words", async () => {
  await renderSettings();
  expect(screen.getByText("You know the commonest 400 words.")).toBeTruthy();

  await act(async () => fireEvent.press(screen.getByText(s.meaningsLevelHigher)));
  expect(stored(MEANINGS_SETTING_KEYS.level)).toBe("3");
  expect(screen.getByText("You know the commonest 700 words.")).toBeTruthy();

  for (let i = 0; i < 3; i += 1) await act(async () => fireEvent.press(screen.getByText(s.meaningsLevelLower)));
  expect(stored(MEANINGS_SETTING_KEYS.level)).toBe("0");
  expect(screen.getByText(s.meaningsLevelStart)).toBeTruthy();
  expect(screen.getByRole("button", { name: s.meaningsLevelLower }).props.accessibilityState).toMatchObject({
    disabled: true,
  });
});

it("retakes the check from the stored level and saves its result", async () => {
  await renderSettings();
  fireEvent.press(screen.getByText(s.meaningsCheckMyLevel));
  await act(async () => fireEvent.press(screen.getByText("Finish the check from 2")));
  expect(stored(MEANINGS_SETTING_KEYS.level)).toBe("4");
  expect(screen.getByText("You know the commonest 1,500 words.")).toBeTruthy();
});

it("saves the meaning language and offers the check only in a language the bank covers", async () => {
  await renderSettings();
  await act(async () => fireEvent.press(screen.getByText(s.meaningsLanguageArabic)));
  expect(stored(MEANINGS_SETTING_KEYS.language)).toBe("ar");
  expect(screen.queryByText(s.meaningsCheckMyLevel)).toBeNull();
});

it("follows an interface language switch for values the user never chose", async () => {
  store.sql.exec("DELETE FROM user_settings");
  const view = render(
    <DirectionProvider dir="ltr">
      <StudyDecksSettings db={store.db} language="en" s={s} />
    </DirectionProvider>,
  );
  await act(async () => {});
  expect(screen.getByText(s.meaningsLevelStart)).toBeTruthy();
  // The app language switches in the same panel; nothing remounts it.
  const ar = strings.ar;
  view.rerender(
    <DirectionProvider dir="rtl">
      <StudyDecksSettings db={store.db} language="ar" s={ar} />
    </DirectionProvider>,
  );
  await act(async () => {});
  expect(screen.queryByText(ar.meaningsLevelStart)).toBeNull();
  // Arabic readers start past three bands; Rarer words moves on from there, not from the old 0.
  await act(async () => fireEvent.press(screen.getByText(ar.meaningsLevelHigher)));
  expect(stored(MEANINGS_SETTING_KEYS.level)).toBe("4");
});
