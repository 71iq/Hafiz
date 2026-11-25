import React from "react";
import { render } from "@testing-library/react-native";
import { DefaultDeckProgressChart } from "@/components/progress/DefaultDeckProgressChart";
import { SMART_DECK_IDS } from "@/lib/fsrs/smart-decks";
import { applyPreset, DEFAULT_HIFZ_PLAN, writeHifzPlan } from "@/lib/hifz/plan";
import { strings } from "@/lib/i18n/strings";
import { getDefaultDeckProgress, type DefaultDeckProgressItem } from "@/lib/profile/progress";
import { writeMeaningsInDailyStudy } from "@/lib/study/daily-decks";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

jest.mock("@/lib/settings/context", () => ({
  useSettings: () => ({
    themeColors: { surfaceHigh: "#ddd", surfaceLow: "#eee" },
    uiLanguage: "en",
    effectiveTheme: "white",
  }),
}));

/** The deck chart marks decks outside daily study and shows no due count for them (SPEC 3.3). */
let store: OutboxDatabase;
beforeEach(async () => {
  store = await openOutboxDatabase();
});
afterEach(async () => {
  await store.close();
});

const daily = (items: DefaultDeckProgressItem[]) => Object.fromEntries(items.map((item) => [item.key, item.daily]));

it("flags the daily decks, and Retention only for a plan that reviews by ayah", async () => {
  expect(daily(await getDefaultDeckProgress(store.db))).toEqual({
    retention: false,
    mutashabihat: true,
    similarTails: true,
    qiraat: false,
    reasonsOfRevelation: false,
    vocabulary: true,
  });
  await writeMeaningsInDailyStudy(store.db, false);
  await writeHifzPlan(store.db, applyPreset(DEFAULT_HIFZ_PLAN, "short_surahs"));
  expect(daily(await getDefaultDeckProgress(store.db))).toMatchObject({ retention: true, vocabulary: false });
});

it("shows a deck outside daily study without its due count", () => {
  const s = strings.en;
  const item = (key: DefaultDeckProgressItem["key"], isDaily: boolean): DefaultDeckProgressItem => ({
    key,
    deckId: key === "qiraat" ? SMART_DECK_IDS.qiraat : SMART_DECK_IDS.mutashabihat,
    isSmartDeck: true,
    color: "#0d9488",
    total: 10,
    startedCount: 4,
    newCount: 6,
    dueCount: 3,
    daily: isDaily,
  });
  const view = render(
    <DefaultDeckProgressChart
      items={[item("mutashabihat", true), item("qiraat", false)]}
      isDark={false}
      isRTL={false}
      s={s}
    />,
  );
  expect(view.getAllByText(s.deckCardsFilterDue)).toHaveLength(1);
  expect(view.getByText(s.progressDeckNotDaily)).toBeTruthy();
});
