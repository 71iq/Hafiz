import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { TeacherSabaqAssignment } from "@/components/social/TeacherSabaqAssignment";
import type { AppDatabase } from "@/lib/database/types";
import { loadSabaqRangePreview } from "@/lib/halaqa/sabaq-preview";
import { strings } from "@/lib/i18n/strings";
import { interpolate } from "@/lib/i18n/useStrings";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

let mockDb: AppDatabase | null = null;
jest.mock("@/lib/database/provider", () => ({ useDatabase: () => mockDb }));

/** Synthetic page-font glyphs: none may reach the preview, which shows the Unicode text. */
const GLYPH = /\bg\d+\b/;

/**
 * SOC-03: the next-sabaq form previews what a teacher's page and lines hold, read from the local
 * Quran tables, before anything is sent.
 */
describe("the next sabaq preview (SOC-03)", () => {
  let store: OutboxDatabase;

  /**
   * Page 562, laid out from its line table, with synthetic words:
   *   1 surah name, 2 basmalah (Al-Mulk)
   *   3 ayah 67:1 whole (5 words)
   *   4 ayah 67:2 words 1 to 3
   *   5 ayah 67:2 word 4 and its end, then 67:3 words 1 to 3
   *   6 ayah 67:3 words 4 to 7
   *   7 surah name, 8 basmalah (Al-Qalam)
   *   9 ayah 68:1, whose page-font glyphs carry one more mark than its words
   *   10 to 15 nothing
   */
  function seedPage() {
    store.sql.exec(`
      INSERT INTO surahs (number, name_arabic, name_english, ayah_count, revelation_type) VALUES
        (67, 'الملك', 'Al-Mulk', 3, 'Meccan'), (68, 'القلم', 'Al-Qalam', 1, 'Meccan');
    `);
    const words: Record<string, string[]> = {
      "67:1": ["أول", "ثان", "ثالث", "رابع", "خامس"],
      "67:2": ["سادس", "سابع", "ثامن", "تاسع"],
      "67:3": ["عاشر", "حادي", "ثاني", "ثالث", "رابع", "خامس", "سادس"],
      "68:1": ["نون", "قلم", "سطر"],
    };
    const ayah = store.sql.prepare(
      "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, ?, ?, ?, 562)",
    );
    let glyph = 0;
    for (const [ref, list] of Object.entries(words)) {
      const [surah, n] = ref.split(":").map(Number);
      // Each word's glyph, an extra mark for 68:1, then the ayah's end marker.
      const glyphs = [...list, ...(ref === "68:1" ? ["mark"] : []), "end"].map(() => `g${(glyph += 1)}`);
      ayah.run(surah, n, list.join(" "), list.join(" "), glyphs.join(" "));
    }
    const line = store.sql.prepare(
      "INSERT INTO page_lines (page_number, line_number, line_type, is_centered, first_word_id, last_word_id, surah_number) VALUES (562, ?, ?, ?, ?, ?, ?)",
    );
    line.run(1, "surah_name", 1, null, null, 67);
    line.run(2, "basmallah", 1, null, null, 67);
    line.run(3, "ayah", 0, 1, 6, null);
    line.run(4, "ayah", 0, 7, 9, null);
    line.run(5, "ayah", 0, 10, 14, null);
    line.run(6, "ayah", 0, 15, 19, null);
    line.run(7, "surah_name", 1, null, null, 68);
    line.run(8, "basmallah", 1, null, null, 68);
    line.run(9, "ayah", 0, 20, 24, null);
  }

  beforeEach(async () => {
    store = await openOutboxDatabase();
    mockDb = store.db;
    seedPage();
  });
  afterEach(async () => {
    cleanup();
    mockDb = null;
    // Reads a test left running finish before the database closes.
    await store.db.getFirstAsync("SELECT 1");
    await store.close();
    jest.restoreAllMocks();
  });

  function renderForm(language: "en" | "ar" = "en") {
    const onSave = jest.fn();
    const screen = render(
      <TeacherSabaqAssignment
        memberName="Yusuf"
        current={null}
        pending={false}
        error={null}
        saved={null}
        disabled={false}
        language={language}
        isRTL={language === "ar"}
        s={strings[language]}
        onSave={onSave}
        onClear={jest.fn()}
      />,
    );
    const type = (page: string, from: string, to: string) => {
      fireEvent.changeText(screen.getByLabelText(strings[language].teacherAssignPage), page);
      fireEvent.changeText(screen.getByLabelText(strings[language].teacherAssignFrom), from);
      fireEvent.changeText(screen.getByLabelText(strings[language].teacherAssignTo), to);
    };
    const save = () => fireEvent.press(screen.getByRole("button", { name: strings[language].teacherAssignSave }));
    return { screen, onSave, type, save };
  }

  it("shows the surah, the ayat and the first line's opening words in Uthmani text", async () => {
    const { screen, onSave, type, save } = renderForm();
    expect(
      screen.getByText(
        `${interpolate(strings.en.teacherAssignHint, { name: "Yusuf" })} ${strings.en.teacherAssignMushaf}`,
      ),
    ).toBeTruthy();
    type("562", "3", "6");
    expect(await screen.findByText("Al-Mulk 67:1 to 67:3")).toBeTruthy();
    // Line 3's first four words; its fifth and the ayah's end follow.
    const opening = screen.getByText("أول ثان ثالث رابع …");
    expect(opening.props.children).not.toMatch(GLYPH);
    expect(screen.queryByText(/mid-ayah/)).toBeNull();

    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ page: 562, fromLine: 3, toLine: 6 }));
  });

  it("shows the Arabic surah name and Arabic-Indic digits to an Arabic teacher", async () => {
    const { screen, type } = renderForm("ar");
    type("٥٦٢", "٣", "٦");
    expect(await screen.findByText("سورة الملك، من ٦٧:١ إلى ٦٧:٣")).toBeTruthy();
    expect(screen.getByText("أول ثان ثالث رابع …")).toBeTruthy();

    // Across a surah's end: both names. Line 6 ends its ayah and line 9's opening is not shown, since
    // its words cannot be matched to their glyphs.
    type("٥٦٢", "٦", "٩");
    expect(await screen.findByText("من سورة الملك ٦٧:٣ إلى سورة القلم ٦٨:١")).toBeTruthy();
    expect(screen.getByText("ثالث رابع خامس سادس (٣)")).toBeTruthy();
  });

  it("warns, without refusing, when the lines start or end inside an ayah", async () => {
    const { screen, onSave, type, save } = renderForm();
    type("562", "4", "4");
    expect(await screen.findByText("Al-Mulk 67:2")).toBeTruthy();
    expect(screen.getByText(interpolate(strings.en.teacherAssignMidEnd, { line: "4" }))).toBeTruthy();
    expect(screen.queryByText(interpolate(strings.en.teacherAssignMidStart, { line: "4" }))).toBeNull();

    type("562", "5", "5");
    expect(await screen.findByText("Al-Mulk 67:2 to 67:3")).toBeTruthy();
    // Line 5 opens with the end of 67:2, shown as its number.
    expect(screen.getByText("تاسع (٢) عاشر حادي ثاني")).toBeTruthy();
    expect(screen.getByText(interpolate(strings.en.teacherAssignMidStart, { line: "5" }))).toBeTruthy();
    expect(screen.getByText(interpolate(strings.en.teacherAssignMidEnd, { line: "5" }))).toBeTruthy();

    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ page: 562, fromLine: 5, toLine: 5 }));
  });

  it("names the mid-ayah line in Arabic", async () => {
    const { screen, type } = renderForm("ar");
    type("٥٦٢", "٥", "٦");
    expect(await screen.findByText(interpolate(strings.ar.teacherAssignMidStart, { line: "٥" }))).toBeTruthy();
    expect(screen.queryByText(interpolate(strings.ar.teacherAssignMidEnd, { line: "٦" }))).toBeNull();
  });

  it.each([
    ["a surah name and basmalah", "1", "2"],
    ["lines past the page's last line", "10", "15"],
  ])("refuses lines with no ayat (%s) and sends nothing", async (_case, from, to) => {
    const { screen, onSave, type, save } = renderForm();
    type("562", from, to);
    expect(await screen.findByText(strings.en.teacherAssignNoAyat)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(strings.en.teacherAssignNoAyat);
    expect(onSave).not.toHaveBeenCalled();
    // Changing a number clears the refusal.
    fireEvent.changeText(screen.getByLabelText(strings.en.teacherAssignTo), "3");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses an empty range even when Save comes before the preview, in Arabic", async () => {
    const { screen, onSave, type, save } = renderForm("ar");
    type("٥٦٢", "١", "٢");
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(strings.ar.teacherAssignNoAyat);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the number check and shows no preview for numbers it refuses", async () => {
    const { screen, onSave, type, save } = renderForm();
    type("562", "9", "3");
    save();
    expect(screen.getByText(strings.en.teacherAssignInvalid)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Al-Mulk/)).toBeNull());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("brackets an ayah end inside the opening, so it never reads as a letter", async () => {
    const preview = await loadSabaqRangePreview(store.db, { page: 562, fromLine: 5, toLine: 6 });
    expect(preview).toMatchObject({ kind: "ayat", opening: "تاسع (٢) عاشر حادي ثاني", startsMidAyah: true });
  });

  it("stops the opening before a word whose glyph position is unknown", async () => {
    const preview = await loadSabaqRangePreview(store.db, { page: 562, fromLine: 9, toLine: 15 });
    expect(preview).toMatchObject({ kind: "ayat", first: { surah: 68, ayah: 1 }, opening: "", endsMidAyah: false });
  });
});
