import {
  DAILY_REVIEW_LIMIT_STEP,
  DEFAULT_DAILY_REVIEW_LIMIT,
  DEFAULT_FONT_SIZE_INDEX,
  DEFAULT_HIFZ_AUTO_DELAY_MS,
  FOCUS_SCROLL_SPEED_DEFAULT,
  FOCUS_SCROLL_SPEED_MAX,
  FOCUS_SCROLL_SPEED_MIN,
  FONT_SIZE_LINE_HEIGHTS,
  FONT_SIZE_LINE_HEIGHTS_MOBILE,
  FONT_SIZE_STEPS,
  FONT_SIZE_STEPS_MOBILE,
  HIFZ_AUTO_DELAY_STEP_MS,
  MAX_DAILY_REVIEW_LIMIT,
  MAX_HIFZ_AUTO_DELAY_MS,
  MIN_DAILY_REVIEW_LIMIT,
  MIN_HIFZ_AUTO_DELAY_MS,
  THEME_COLORS,
  withThemeOpacity,
} from "@/lib/settings/context";
import { isSyncableUserSetting, userSettingToSyncData } from "@/lib/database/user-settings";

describe("settings contracts", () => {
  it("keeps desktop and mobile Quran font scales aligned", () => {
    expect(FONT_SIZE_STEPS).toHaveLength(10);
    expect(FONT_SIZE_LINE_HEIGHTS).toHaveLength(FONT_SIZE_STEPS.length);
    expect(FONT_SIZE_STEPS_MOBILE).toHaveLength(FONT_SIZE_STEPS.length);
    expect(FONT_SIZE_LINE_HEIGHTS_MOBILE).toHaveLength(FONT_SIZE_STEPS.length);
    expect(DEFAULT_FONT_SIZE_INDEX).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_FONT_SIZE_INDEX).toBeLessThan(FONT_SIZE_STEPS.length);
  });

  it("keeps every Quran font step and line height strictly increasing", () => {
    for (const values of [
      FONT_SIZE_STEPS,
      FONT_SIZE_LINE_HEIGHTS,
      FONT_SIZE_STEPS_MOBILE,
      FONT_SIZE_LINE_HEIGHTS_MOBILE,
    ]) {
      for (let index = 1; index < values.length; index += 1) {
        expect(values[index]).toBeGreaterThan(values[index - 1]);
      }
    }
  });

  it("keeps daily review limits bounded to documented increments", () => {
    expect(MIN_DAILY_REVIEW_LIMIT).toBe(10);
    expect(MAX_DAILY_REVIEW_LIMIT).toBe(30);
    expect(DEFAULT_DAILY_REVIEW_LIMIT).toBe(20);
    expect(DEFAULT_DAILY_REVIEW_LIMIT).toBeGreaterThanOrEqual(MIN_DAILY_REVIEW_LIMIT);
    expect(DEFAULT_DAILY_REVIEW_LIMIT).toBeLessThanOrEqual(MAX_DAILY_REVIEW_LIMIT);
    expect((MAX_DAILY_REVIEW_LIMIT - MIN_DAILY_REVIEW_LIMIT) % DAILY_REVIEW_LIMIT_STEP).toBe(0);
  });

  it("keeps focus and hifz timing defaults inside their controls", () => {
    expect(FOCUS_SCROLL_SPEED_DEFAULT).toBeGreaterThanOrEqual(FOCUS_SCROLL_SPEED_MIN);
    expect(FOCUS_SCROLL_SPEED_DEFAULT).toBeLessThanOrEqual(FOCUS_SCROLL_SPEED_MAX);
    expect(DEFAULT_HIFZ_AUTO_DELAY_MS).toBeGreaterThanOrEqual(MIN_HIFZ_AUTO_DELAY_MS);
    expect(DEFAULT_HIFZ_AUTO_DELAY_MS).toBeLessThanOrEqual(MAX_HIFZ_AUTO_DELAY_MS);
    expect((MAX_HIFZ_AUTO_DELAY_MS - MIN_HIFZ_AUTO_DELAY_MS) % HIFZ_AUTO_DELAY_STEP_MS).toBe(0);
  });

  it("keeps every theme palette complete and hex-based", () => {
    expect(Object.keys(THEME_COLORS).sort()).toEqual(["amoled", "beige", "dark", "white"]);

    for (const palette of Object.values(THEME_COLORS)) {
      expect(Object.keys(palette).sort()).toEqual([
        "surface",
        "surfaceBright",
        "surfaceDim",
        "surfaceHigh",
        "surfaceLow",
        "surfaceMid",
      ]);
      for (const color of Object.values(palette)) {
        expect(color).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it("converts theme hex colors to clamped rgba values", () => {
    expect(withThemeOpacity("#fff", 0.25)).toBe("rgba(255,255,255,0.25)");
    expect(withThemeOpacity("#000000", -1)).toBe("rgba(0,0,0,0)");
    expect(withThemeOpacity("#0A141E", 2)).toBe("rgba(10,20,30,1)");
    expect(withThemeOpacity("transparent", 0.5)).toBe("transparent");
  });

  it("syncs only settings that are part of the cross-device contract", () => {
    for (const key of [
      "daily_review_limit",
      "last_mushaf_position",
      "deck_default",
      "review_settings_default",
      "smart_deck_filter_retention",
      "card_answer_2:255",
    ]) {
      expect(isSyncableUserSetting(key)).toBe(true);
    }

    for (const key of [
      "theme",
      "ui_language",
      "quran_font_style",
      "translation_language",
      "onboarding_completed",
      "hifz_auto_delay_ms",
    ]) {
      expect(isSyncableUserSetting(key)).toBe(false);
    }
  });

  it("normalizes user setting rows before enqueueing sync data", () => {
    expect(userSettingToSyncData({
      key: "daily_review_limit",
      value: "30",
      updated_at: "2026-05-28T00:00:00.000Z",
      deleted_at: "2026-05-28T01:00:00.000Z",
    })).toEqual({
      key: "daily_review_limit",
      value: "30",
      updated_at: "2026-05-28T00:00:00.000Z",
      deleted_at: "2026-05-28T01:00:00.000Z",
    });

    const normalized = userSettingToSyncData({
      key: "deck_default",
      value: "{}",
      updated_at: null,
    });

    expect(normalized.key).toBe("deck_default");
    expect(normalized.value).toBe("{}");
    expect(normalized.deleted_at).toBeNull();
    expect(typeof normalized.updated_at).toBe("string");
    expect(Number.isNaN(Date.parse(normalized.updated_at as string))).toBe(false);
  });
});
