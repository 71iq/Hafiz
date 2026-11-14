import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { DriftPairPrompt } from "@/components/hifz/DriftPairPrompt";
import { SimilarVerseComparison } from "@/components/hifz/SimilarVerseComparison";
import { similarGroupsForAyahs, similarPair, type SimilarPair } from "@/lib/hifz/similar";
import { strings } from "@/lib/i18n/strings";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/**
 * Tail-only similar-verse groups carry no text segments (4.7), and some pairs read the same word for
 * word. The pair prompt (MUT-04) and the sabaq comparison (MUT-01) still need two readable, distinct
 * verses, and show each verse's meaning (MUT-05). Quran text, translations and the Muyassar tafsir are
 * copied from the bundled database.
 */

const VERSES: Record<string, [page: number, text: string]> = {
  "8:75": [
    186,
    "وَٱلَّذِينَ ءَامَنُوا۟ مِنۢ بَعْدُ وَهَاجَرُوا۟ وَجَٰهَدُوا۟ مَعَكُمْ فَأُو۟لَٰٓئِكَ مِنكُمْ وَأُو۟لُوا۟ ٱلْأَرْحَامِ بَعْضُهُمْ أَوْلَىٰ بِبَعْضٍ فِى كِتَٰبِ ٱللَّهِ إِنَّ ٱللَّهَ بِكُلِّ شَىْءٍ عَلِيمٌۢ",
  ],
  "9:115": [
    205,
    "وَمَا كَانَ ٱللَّهُ لِيُضِلَّ قَوْمًۢا بَعْدَ إِذْ هَدَىٰهُمْ حَتَّىٰ يُبَيِّنَ لَهُم مَّا يَتَّقُونَ إِنَّ ٱللَّهَ بِكُلِّ شَىْءٍ عَلِيمٌ",
  ],
  "26:8": [367, "إِنَّ فِى ذَٰلِكَ لَـَٔايَةً وَمَا كَانَ أَكْثَرُهُم مُّؤْمِنِينَ"],
  "26:9": [367, "وَإِنَّ رَبَّكَ لَهُوَ ٱلْعَزِيزُ ٱلرَّحِيمُ"],
  "26:10": [367, "وَإِذْ نَادَىٰ رَبُّكَ مُوسَىٰٓ أَنِ ٱئْتِ ٱلْقَوْمَ ٱلظَّٰلِمِينَ"],
  "26:67": [370, "إِنَّ فِى ذَٰلِكَ لَـَٔايَةً وَمَا كَانَ أَكْثَرُهُم مُّؤْمِنِينَ"],
  "26:68": [370, "وَإِنَّ رَبَّكَ لَهُوَ ٱلْعَزِيزُ ٱلرَّحِيمُ"],
  "26:69": [370, "وَٱتْلُ عَلَيْهِمْ نَبَأَ إِبْرَٰهِيمَ"],
  "26:139": [373, "فَكَذَّبُوهُ فَأَهْلَكْنَٰهُمْ إِنَّ فِى ذَٰلِكَ لَـَٔايَةً وَمَا كَانَ أَكْثَرُهُم مُّؤْمِنِينَ"],
  "26:140": [373, "وَإِنَّ رَبَّكَ لَهُوَ ٱلْعَزِيزُ ٱلرَّحِيمُ"],
  "23:6": [342, "إِلَّا عَلَىٰٓ أَزْوَٰجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَٰنُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ"],
  "23:7": [342, "فَمَنِ ٱبْتَغَىٰ وَرَآءَ ذَٰلِكَ فَأُو۟لَٰٓئِكَ هُمُ ٱلْعَادُونَ"],
  "23:8": [342, "وَٱلَّذِينَ هُمْ لِأَمَٰنَٰتِهِمْ وَعَهْدِهِمْ رَٰعُونَ"],
  "70:30": [569, "إِلَّا عَلَىٰٓ أَزْوَٰجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَٰنُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ"],
  "70:31": [569, "فَمَنِ ٱبْتَغَىٰ وَرَآءَ ذَٰلِكَ فَأُو۟لَٰٓئِكَ هُمُ ٱلْعَادُونَ"],
  "70:32": [569, "وَٱلَّذِينَ هُمْ لِأَمَٰنَٰتِهِمْ وَعَهْدِهِمْ رَٰعُونَ"],
};
const SURAH_NAMES: Record<number, string> = { 8: "الأنفال", 9: "التوبة", 23: "المؤمنون", 26: "الشعراء", 70: "المعارج" };
/** Tail-only groups, as bundled: no pre, similar or post text. */
const TAIL_GROUPS: Record<string, string[]> = {
  "nq-tail-a": ["8:75", "9:115"],
  "nq-tail-b": ["26:9", "26:68", "26:140"],
  "nq-tail-c": ["23:7", "70:31"],
};
const MEANINGS: Record<string, { en: string; ar: string }> = {
  "8:75": {
    en: "And those who believed after [the initial emigration] and emigrated and fought with you - they are of you. But those of [blood] relationship are more entitled [to inheritance] in the decree of Allah. Indeed, Allah is Knowing of all things",
    ar: "والذين آمنوا مِن بعد هؤلاء المهاجرين والأنصار، وهاجروا وجاهدوا معكم في سبيل الله، فأولئك منكم -أيها المؤمنون- لهم ما لكم وعليهم ما عليكم، وأولو القرابة بعضهم أولى ببعض في التوارث في حكم الله من عامة المسلمين. إن الله بكل شيء عليم يعلم ما يصلح عباده مِن توريث بعضهم من بعض في القرابة والنسب دون التوارث بالحِلْف، وغير ذلك مما كان في أول الإسلام.",
  },
  "9:115": {
    en: "And Allah would not let a people stray after He has guided them until He makes clear to them what they should avoid. Indeed, Allah is Knowing of all things",
    ar: "وما كان الله ليضلَّ قومًا بعد أن مَنَّ عليهم بالهداية والتوفيق حتى يبيِّن لهم ما يتقونه به، وما يحتاجون إليه في أصول الدين وفروعه. إن الله بكل شيء عليم، فقد علَّمكم ما لم تكونوا تعلمون، وبيَّن لكم ما به تنتفعون، وأقام الحجة عليكم بإبلاغكم رسالته.",
  },
};

let store: OutboxDatabase;

function seed() {
  for (const [key, [page, text]] of Object.entries(VERSES)) {
    const [surah, ayah] = key.split(":").map(Number);
    store.sql
      .prepare(
        "INSERT INTO quran_text (surah, ayah, text_uthmani, text_clean, text_qcf2, v2_page) VALUES (?, ?, ?, 'x', 'x', ?)",
      )
      .run(surah, ayah, text, page);
  }
  Object.entries(TAIL_GROUPS).forEach(([id, refs], order) => {
    store.sql
      .prepare(
        "INSERT INTO mutashabihat_groups (id, kind, cue, source, sort_order) VALUES (?, 'tail', 'cue', 'test', ?)",
      )
      .run(id, order);
    refs.forEach((ref, index) => {
      const [surah, ayah] = ref.split(":").map(Number);
      store.sql
        .prepare(
          "INSERT INTO mutashabihat_refs (group_id, sort_order, surah, ayah, surah_name_ar) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, index, surah, ayah, SURAH_NAMES[surah]);
    });
  });
  for (const [key, meaning] of Object.entries(MEANINGS)) {
    const [surah, ayah] = key.split(":").map(Number);
    store.sql.prepare("INSERT INTO translations (surah, ayah, text_en) VALUES (?, ?, ?)").run(surah, ayah, meaning.en);
    store.sql
      .prepare("INSERT INTO tafseer (surah, ayah, source, text) VALUES (?, ?, 'muyassar', ?)")
      .run(surah, ayah, meaning.ar);
  }
}

const verse = (key: string) => {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
};

async function pairOf(self: string, sibling: string): Promise<SimilarPair> {
  const pair = await similarPair(store.db, verse(self), verse(sibling));
  if (!pair) throw new Error(`No pair for ${self} and ${sibling}`);
  return pair;
}

const NO_MEANINGS: ReadonlyMap<string, string> = new Map();

function renderPrompt(pair: SimilarPair, language: "en" | "ar", meanings = NO_MEANINGS) {
  return render(
    <DriftPairPrompt
      pair={pair}
      target="self"
      dir={language === "ar" ? "rtl" : "ltr"}
      s={strings[language]}
      accent="#0d9488"
      accentText="#0f766e"
      busy={false}
      error={null}
      meanings={meanings}
      onNext={() => undefined}
    />,
  );
}

beforeEach(async () => {
  store = await openOutboxDatabase();
  seed();
});
afterEach(async () => {
  await store.db.getFirstAsync("SELECT 1");
  await store.close();
});

describe("tail-only similar verses", () => {
  it("shows each verse's Unicode text with the shared ending marked", async () => {
    const pair = await pairOf("8:75", "9:115");
    // The display is the canonical text itself, split where the shared ending starts.
    expect(`${pair.self.pre} ${pair.self.similar}`).toBe(VERSES["8:75"][1]);
    expect(`${pair.sibling.pre} ${pair.sibling.similar}`).toBe(VERSES["9:115"][1]);
    expect(pair.self.similar).toBe("إِنَّ ٱللَّهَ بِكُلِّ شَىْءٍ عَلِيمٌۢ");
    expect(pair.sibling.similar).toBe("إِنَّ ٱللَّهَ بِكُلِّ شَىْءٍ عَلِيمٌ");
    expect(pair.self.context).toBeUndefined();
    // The sabaq comparison reads the same groups.
    const [group] = await similarGroupsForAyahs(store.db, [verse("8:75")]);
    expect(group.self.pre).not.toBe("");
    expect(group.siblings[0].similar).toBe("إِنَّ ٱللَّهَ بِكُلِّ شَىْءٍ عَلِيمٌ");
  });

  it.each(["en", "ar"] as const)(
    "renders two non-empty, distinct choices in the pair prompt (%s)",
    async (language) => {
      renderPrompt(await pairOf("8:75", "9:115"), language);
      const options = screen.getAllByRole("radio");
      expect(options).toHaveLength(2);
      // Mushaf order; the references stay hidden until a choice is made.
      expect(within(options[0]).getByText(VERSES["8:75"][1])).toBeTruthy();
      expect(within(options[1]).getByText(VERSES["9:115"][1])).toBeTruthy();
      expect(screen.queryByText(/التوبة \S+/)).toBeNull();
    },
  );
});

describe("pairs that read the same", () => {
  it("shows the end of the preceding ayah when that tells them apart", async () => {
    const pair = await pairOf("26:9", "26:140");
    expect(pair.self.context).toEqual({ before: VERSES["26:8"][1], after: null, surahName: false });
    // Long enough to differ: 26:139 ends with all of 26:8, so one more word is shown.
    expect(pair.sibling.context?.before).toBe(
      "فَأَهْلَكْنَٰهُمْ إِنَّ فِى ذَٰلِكَ لَـَٔايَةً وَمَا كَانَ أَكْثَرُهُم مُّؤْمِنِينَ",
    );
  });

  it.each(["en", "ar"] as const)(
    "shows the start of the following ayah when the preceding ones match too (%s)",
    async (language) => {
      const pair = await pairOf("26:9", "26:68");
      expect(pair.self.context).toEqual({ before: null, after: "وَإِذْ نَادَىٰ رَبُّكَ مُوسَىٰٓ", surahName: false });
      renderPrompt(pair, language);
      const options = screen.getAllByRole("radio");
      expect(within(options[0]).getByText("وَإِذْ نَادَىٰ رَبُّكَ مُوسَىٰٓ …")).toBeTruthy();
      expect(within(options[1]).getByText("وَٱتْلُ عَلَيْهِمْ نَبَأَ إِبْرَٰهِيمَ …")).toBeTruthy();
      expect(screen.queryByText("الشعراء")).toBeNull();
    },
  );

  it("falls back to the surah name when the neighbouring ayat match as well", async () => {
    renderPrompt(await pairOf("23:7", "70:31"), "en");
    const options = screen.getAllByRole("radio");
    expect(within(options[0]).getByText("المؤمنون")).toBeTruthy();
    expect(within(options[1]).getByText("المعارج")).toBeTruthy();
    // Only the name: the reference itself is still hidden.
    expect(screen.queryByText("المعارج\u200E 70:31")).toBeNull();
  });
});

describe("meaning anchor (MUT-05)", () => {
  const meaningMap = (language: "en" | "ar") =>
    new Map(Object.entries(MEANINGS).map(([key, meaning]) => [key, meaning[language]]));

  it.each(["en", "ar"] as const)(
    "shows each verse's meaning in the pair prompt only after a choice (%s)",
    async (language) => {
      const s = strings[language];
      renderPrompt(await pairOf("8:75", "9:115"), language, meaningMap(language));
      expect(screen.queryByText(MEANINGS["8:75"][language])).toBeNull();
      expect(screen.queryByText(s.hifzSimilarMeaning)).toBeNull();
      fireEvent.press(screen.getAllByRole("radio")[1]);
      expect(screen.getByText(MEANINGS["8:75"][language])).toBeTruthy();
      expect(screen.getByText(MEANINGS["9:115"][language])).toBeTruthy();
      expect(screen.getAllByText(s.hifzSimilarMeaning)).toHaveLength(2);
    },
  );

  it.each(["en", "ar"] as const)(
    "shows the translation in English and the Muyassar tafsir in Arabic in the comparison (%s)",
    async (language) => {
      const s = strings[language];
      const groups = await similarGroupsForAyahs(store.db, [verse("8:75")]);
      const reads = jest.spyOn(store.db, "getAllAsync");
      const view = (list: typeof groups) => (
        <SimilarVerseComparison
          db={store.db}
          groups={list}
          language={language}
          isRTL={language === "ar"}
          accent="#0f766e"
          s={s}
          width={358}
        />
      );
      const { rerender } = render(view(groups));
      expect(await screen.findByText(MEANINGS["8:75"][language])).toBeTruthy();
      expect(screen.getByText(MEANINGS["9:115"][language])).toBeTruthy();
      expect(screen.getAllByText(s.hifzSimilarMeaning)).toHaveLength(2);
      // The other language's text is not shown.
      expect(screen.queryByText(MEANINGS["8:75"][language === "ar" ? "en" : "ar"])).toBeNull();
      // A new render with the same verses reads nothing again.
      rerender(view([...groups]));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(reads.mock.calls.filter(([source]) => /FROM (translations|tafseer)/.test(String(source)))).toHaveLength(1);
    },
  );
});
