#!/usr/bin/env node
/**
 * Writes lib/meanings/check-bank.ts, the item bank for "Check my level" (SPEC 3.6).
 *
 * usage: node scripts/build-meanings-check-bank.mjs
 *
 * Reads assets/data/quran.db read only. Bands and eligible positions come from lib/meanings/lemma-index.ts
 * itself, and the highlighted word from lib/mushaf/glyph-words.ts (Node 24 strips their types): the index
 * decides which positions may be shown, and this script decides which of them make a fair question.
 * Meanings are the ones lib/word/queries.ts shows: the bundled `word_meanings_ar` meaning in Arabic and
 * `word_translations.translation_en` in English.
 *
 * For each boundary b from 1 to 5 and each language, ITEMS_PER_GROUP items ask a word of band b - 1. The
 * check assumes that a reader who does not know the word picks the right meaning one time in four, so
 * nothing but the meaning may tell the options apart. Where it can, a rule makes a cue impossible rather
 * than unlikely. tests/unit/meanings-check-bank.test.ts restates the rules and checks every item.
 *
 * Fair positions, for the asked word and the wrong options alike:
 * - Fair lemmas only: a root, not mostly a proper name, and a usual English gloss with more than function
 *   words ("the", "before you", "(of)"). A gloss naming a person, place or transliterated term (Allah,
 *   Musa, Quran) is skipped.
 * - A verb or noun by its `word_irab` tag, of the class at least LEMMA_CLASS_SHARE of the lemma's
 *   positions have and its spelling agrees with, since some tags are wrong (55:2:1 عَلَّمَ is tagged as a
 *   gerund, حِلّ as a verb). The highlighted word is the `word_irab` word, so the tag describes it, and
 *   holds its `word_roots` stem, so its prefixes and endings are known.
 * - English glosses are at most MAX_EN characters, without square brackets, quotes, full stops or a comma
 *   without a space after it ("will surely,encompass").
 * - Arabic meanings are at most MAX_AR characters on one line, without a colon ("word: definition"), a
 *   comma at the end, two spaces in a row, a tatweel or two tanween on one word. They do not name a person,
 *   being or place (محمد, موسى, فرعون, الملائكة, الملكة, القرآن, مكة, جهنم, الجنة, أهل النار, الله), are
 *   not a note (المراد, يراد به, أي, يعني, بمعنى, كناية, قيل, جمع, ؛), and have no pronoun for the persons
 *   of their ayah ("لنا", "بك", "لي", "لهم", "صدرك"... unless the word carries a pronoun): such a meaning
 *   fits only its own ayah ("ملائكة الله" for رُسُلُنَا in 29:31, "مُناجيا لنا" for نَجِيًّا).
 *
 * The asked word, from a ranked list of the lemma's fair positions:
 * - Its usual sense. When a meaning recurs at the lemma's eligible positions, fair or not, the asked
 *   meaning is one within USUAL_SHARE of the commonest or shares a content word with them; otherwise
 *   كِتَٰب would be asked as "قضاء أو حكم" (8:68), though its usual meanings are القرآن and التوراة.
 * - Its plain sense: each word of the meaning is in FREQUENT_SHARE of the lemma's meanings or in a usual
 *   one, so حَيَوٰةٌ is not asked as "معيشة آمنة" (2:179), which fits that ayah only.
 * - An Arabic meaning that does not point to the word: it does not spell out the word's root, including
 *   roots with ا و ي or hamza ("للهداية" for مُهْتَدِينَ, "استعلى" for عَلَا, "الموعود" for ٱلْمِيعَاد,
 *   "آيات" for root أيي), use its stem or lemma, share four letters in a row with it or have a word with
 *   its core.
 * - No other word of its root in the ayah: يُعَذِّبُ beside عَذَابَهُۥ (89:25) or كَبِيرٌ beside أَكْبَرُ
 *   (2:219) is known from the other word.
 * - Then: no lead, a word without prefixes or attached pronouns, its commonest meaning, the meaning sharing
 *   the most with the lemma's other meanings, a shorter ayah, a shorter meaning, mushaf order. A lemma
 *   tries its next position when one cannot be completed.
 *
 * No form cue. All four options of an item have the same lead and shape:
 * - The word's shape, from the Arabic word and its tag: its class (verb, noun, comparative, other
 *   adjective, active or passive participle, number); for a verb its tense, voice by tag or by spelling
 *   (27:68 وُعِدْنَا is tagged active), person letter, ending after the stem, feminine ت and final vowel
 *   (the mood of يَأْتِ); for a noun its number (dual and plural by the tag, a broken plural by its English
 *   gloss), ending after the stem (an attached pronoun, رَبَّيَانِى's ـاني), and for an adjective or
 *   participle a feminine form. Each wrong option's word has the asked word's shape.
 * - English lead: leading joiners, articles, prepositions, pronouns and auxiliaries ("and", "the", "any",
 *   "We" apart from "we", "will"), the text in parentheses, "surely", an object pronoun at the end, and a
 *   capital other than on a pronoun (an ayah's first word, or a name such as "Most Merciful"). English
 *   shape: each remaining word's form, being plural or third person -s, -ed or an irregular past, -ing,
 *   -ly, an adjective by its ending or a list ("secure", "upright"; "tyrant" and "invent" are not), a
 *   comparative, a number, a function word or a base form.
 * - Arabic lead: the word's prefixes (و ف ل ب ك ال) that the meaning repeats, a doubled letter counting
 *   twice ("لَشَكَّ"), the article, a ب ل ك of the meaning's own ("بإخلاص") and a function word first
 *   ("ما", "لا", "الذي"). Arabic shape: the number of words, the first word's ending of two letters or
 *   more (ون, ين, ات, ان, وا, نا, تم, ني, هم...), tanween anywhere ("جَزاءٌ"), and for a verb a passive
 *   spelling ("حُسِّنَ").
 * - What an Arabic first word copies from the asked word is the same for all four: its ending of any
 *   length (ة, ا), the letter it rhymes on ("يَخْفِضُونَ" for يَغُضُّونَ), its pattern when distinctive
 *   (يُجَٰدِلُ and "يُناقِشُ"), and whether its case and, for a present verb, its opening vowel copy the
 *   asked word's, clash with it or show none: tanween by type, so "حُجَّةٍ" among three -an does not
 *   answer سُلْطَٰنٍ, "العَذابُ" does not stand beside ٱلْفُلْكَ, and "يُبْعِدُونَ" does not answer يُخْرِجُونَ
 *   among three يَـ.
 * - No Arabic option is the only one of the four voweled or bare, the only one with its final mark, its
 *   present verb's opening vowel or its rhyme.
 * - The longest option has at most twice the letters of the shortest, plus LENGTH_SLACK.
 *
 * Wrong options come from other lemmas of the same band, at any fair position, none in the asked ayah or
 * of a root in it, none asked in the same group, each offered once per group. Each has its own root, and a
 * meaning that differs from the others after removing the parenthesised text or only the brackets,
 * compared without case or Arabic marks and with one spelling of alef, hamza, ى and ة. Two options share
 * no content word, no English stem ("argue", "argument") or word one letter apart ("son", "sun"), no
 * Arabic word root by radical, whole or without its ending ("لقينا" and "ألقينا", "معين" and "أعوان"), no
 * use of the other's word ("يريد" against يُرِيدُ), and no frequent meaning word of their lemmas
 * (أَتِمُّوا۟ "complete" against أَوْفُوا۟ "fulfil"). No wrong option points to the asked word, which would
 * be a lure.
 *
 * No option, right or wrong, repeats a word of the asked ayah ("من مال" right after سَعَةً in 2:247,
 * "يخافون" in 13:21, "للأثر" beside ءَاثَارِهِمَا in 18:64): an Arabic word with the same core or a word
 * spelling out the root of one, or an English word whose stem begins or is begun by a word in the glosses
 * of the ayah's other words ("will punish" beside "(as) His punishment"). No option text appears twice in
 * a group, and since one check asks across groups, a text already used in the language is taken only when
 * no other candidate fits. In a language an ayah is asked once and never gives a wrong option to another
 * item.
 *
 * Preferred among the wrong options that fit: a text not used yet, an English stem not used yet, a lemma
 * that cannot be asked itself, the nearest length, then a seeded order. The asked lemmas are a seeded
 * shuffle of the fair lemmas in the index's order (commonest first), so a rerun writes the same file. A
 * depth-first search takes them in that order, each at its first item that fits the group or skipped, so
 * its first full group is the one a greedy pass would build. A group that cannot fill ITEMS_PER_GROUP items
 * keeps the largest the search finds and is reported in the output as a shortfall, not filled by relaxing a
 * rule.
 *
 * The module stores positions only.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const SEED = 20261125;
const ITEMS_PER_GROUP = 8;
const LANGUAGES = ["ar", "en"];
const MAX_EN = 40;
const MAX_AR = 60;
const LONG_AYAH_WORDS = 30;
const LEMMA_CLASS_SHARE = 0.75;
/** A meaning this share as common as the lemma's commonest one is one of its usual meanings. */
const USUAL_SHARE = 0.5;
/** A lemma's frequent meaning words, for near-synonyms: those at this share of its positions or more. */
const FREQUENT_SHARE = 0.2;
/** Letters the longest option may have beyond twice the shortest. */
const LENGTH_SLACK = 6;
/** The most items, each a target and its three wrong options, the group search considers per lemma. */
const ITEM_CHOICES = 60;
/** The most steps the search for a full group takes before it keeps the largest group found. */
const SEARCH_BUDGET = 5_000_000;

const ROOT = path.resolve(import.meta.dirname, "..");
const DB_PATH = path.join(ROOT, "assets", "data", "quran.db");
const OUT_PATH = path.join(ROOT, "lib", "meanings", "check-bank.ts");

// The package has no "type" field, so Node warns each time it reparses a TypeScript module as ESM.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.code !== "MODULE_TYPELESS_PACKAGE_JSON") console.warn(warning);
});
// The app's modules import each other through the "@/" alias, which Node does not know.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    return nextResolve(pathToFileURL(path.join(ROOT, `${specifier.slice(2)}.ts`)).href, context);
  },
});
const { loadLemmaIndex, positionKey, sameWord } = await import("../lib/meanings/lemma-index.ts");
const { mushafWordTexts } = await import("../lib/mushaf/glyph-words.ts");

// --- Text rules ---------------------------------------------------------------------------------------

const AR_MARKS = new RegExp("[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640\\u200B-\\u200F]", "g");
/** Marks removed, and alef forms, hamza seats, ى and ة written one way, as lemma-index compares spellings. */
const bareArabic = (text) =>
  text
    .replace(AR_MARKS, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");

/** The two readings of "after removing parentheses": without the parenthesised text, and without the brackets. */
function meaningKeys(meaning) {
  const plain = bareArabic(meaning).toLowerCase();
  const tidy = (text) => text.replace(/\s+/g, " ").trim();
  return [tidy(plain.replace(/\([^)]*\)/g, " ")), tidy(plain.replace(/[()]/g, " "))];
}

const FUNCTION_WORDS = new Set(
  `a an the and or nor but so then thus yet if as than that this these those there here what which who whom whose
  when where why how whether while until till since because though although unless lest of to in on at by for with
  from into onto upon over under about above below between among against without within through during before
  after behind beside besides near toward towards except like unlike beyond around up down out off away i me my
  mine we us our ours you your yours he him his she her hers it its they them their theirs myself yourself
  himself herself itself ourselves yourselves themselves one ones none anyone anything someone something
  everyone everything nothing no not never ever indeed surely verily certainly truly rather nay yes all every each
  some any both either neither other others another more most much many few less least very only also even just
  too again still now already is are was were be been being am will would shall should can could may might must
  do does did done has have had having let lo o oh behold`.split(/\s+/),
);

/** Transliterated names and terms: a gloss that uses one does not test meaning. */
const NAME_WORDS = new Set(
  `allah allah's musa firaun ibrahim israel nuh maryam yusuf lut thamud adam isa aad ad harun sulaiman isaac ishaq
  taurat taurah yaqub dawood dawud ishmael ismail injeel iblis shuaib madyan quran zakariya hud haman yahya muhammad
  ahmad ayyub ayub yunus salih qarun jibreel meekael jalut talut imran samiri zaboor yajuj majuj idris luqman saba
  tubba shaitaan shaitan shayateen jinn zakah zakat makkah bakkah badr hunain uzair azar elijah elisha egypt sinai
  tuwa iram quraish yathrib zaid ramadhaan arafat safa marwah babylon harut marut sijjin illiyun tasneem zaqqum
  messiah christian christians jew jews`.split(/\s+/),
);

const AR_STOP = new Set(
  `الذي التي الذين اللاتي هو هي هم هما أنتم نحن ما من في على إلى عن أو ثم كل غير بعد قبل ذلك تلك هذا هذه هؤلاء الله
  المراد أي أن لا لم لن قد مع بين عند حتى إذا كان يكون شيء أمر بها به لها له لهم منه منها عليه عليها ونحوه`
    .split(/\s+/)
    .map(bareArabic),
);

/**
 * Persons, beings, scriptures and places an Arabic meaning may name, spelled as bareArabic writes them. A
 * meaning that names one, or Allah, describes its own ayah ("ملائكة الله" for رُسُلُنَا in 29:31, "مكة"
 * for ٱلْبَلَدَ in 14:35, "الجنة" for ٱلْحُسْنَىٰ in 4:95), not the word.
 */
const AR_NAMES = new Set(
  `محمد أحمد النبي الرسول عيسى المسيح موسى إبراهيم مريم يوسف نوح هارون داود سليمان فرعون إبليس لوط يعقوب إسرائيل
  يونس زكريا يحيى إسحاق إسماعيل آدم شعيب إدريس أيوب لقمان قارون هامان جالوت طالوت عزير جبريل ميكال ميكائيل إسرافيل
  القرآن قرآن التوراة الإنجيل الزبور مكة بكة مصر يثرب الكعبة سيناء بابل جهنم الجنة الجحيم الفردوس سقر اليهود
  النصارى الملكة`
    .split(/\s+/)
    .map(bareArabic),
);
/**
 * Phrases that name a being or make the meaning a note on the ayah or the word rather than a meaning:
 * "والمراد", "ويراد به", "أي", "يعني", "بمعنى", "كناية", "قيل", "يطلق على", "من أسماء", "جمع", "مفرده", "؛",
 * and "أهل النار", a group that only its own ayat speak of.
 */
const AR_NOTE = new RegExp(
  [
    "عليه السلام|عليهما السلام|عليهم السلام|الصلاه والسلام|ملايك|اهل النار|اصحاب النار",
    "مراد|يراد|المقصود|كنايه|يعني|بمعني|يطلق|تطلق|في الايه|من اسماء|مفرد|؛",
    "(^|[^ء-ي])(و?قيل|اي|هنا|جمع)([^ء-ي]|$)",
    "(^|[^ء-ي])[وفبك]?ا?لله([^ء-ي]|$)",
  ].join("|"),
);

function namesOrExplains(meaning) {
  const bare = bareArabic(meaning);
  if (AR_NOTE.test(bare)) return true;
  return bare.split(/[^ء-ي]+/).some((word) => AR_NAMES.has(word) || AR_NAMES.has(word.replace(/^[وفبلك]/, "")));
}

/**
 * A pronoun that points at the persons of the meaning's own ayah: a particle with a first or second person
 * or a third person plural or dual ("لنا", "بك", "لِي", "لَهُمْ", "بِهِما", "عليكم"), "أنا", "نحن" or "أنت",
 * or a longer word ending in كم or هم ("لِأَبْدَانِكُمْ", "حياتكم"). "به", "له" and "فيه" describe the thing
 * itself and stay. Such a meaning fits its ayah only ("مُناجيا لنا" for نَجِيًّا, "مُلَازِمٌ لِي" for
 * قَرِينٌ), unless the word itself carries an attached pronoun.
 */
const TIED_PRONOUN =
  /^(?:[وف]?(?:(?:ل|ب|من|عن|في|علي|الي|مع|عند|لدي|ان|لان|كان)(?:ك|كم|كما|كن|نا|هم|هما|هن)|منا|عنا|لي|بي|مني|عني|معي|عندي)|انا|نحن|انت|انتم|انتما|انتن)$/;
const tiesToAyah = (meaning) =>
  // Hamza stays, so that "بِنَاءً" does not read as "بنا"; a longer word counts only كم and هم, since a
  // noun ends in -hma or -kma ("فَهْمًا", "حُكْمًا").
  meaning
    .replace(AR_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .split(/[^ء-ي]+/)
    .some((word) => TIED_PRONOUN.test(word) || (word.length >= 5 && !word.startsWith("ال") && /(كم|هم)$/.test(word)));

/** A gloss with a typing slip or a quotation: a comma without a space, quotes, a full stop or a colon. */
const MALFORMED_EN = /\[|,(?=\S)|[.;:!?"]|(^|[^A-Za-z])'|'(?![A-Za-z])/;
/**
 * An Arabic meaning with a colon, quotes, a backslash, a space before a comma, a comma or stop at its end
 * ("الزمان،"), two spaces in a row ("اختاروا  وقَبِلوا"), a tatweel ("مُـترقّـبا") or two tanween on one
 * word ("اسْتِخفافًاً"): a slip that sets the option apart.
 */
const MALFORMED_AR = /[:"\\\u0640]|\s[،,]|[،,.;]\s*$|\s\s|[\u064B-\u064D]\S*[\u064B-\u064D]/;

const englishWords = (gloss) =>
  gloss
    .toLowerCase()
    .replace(/[()[\]]/g, " ")
    .split(/[^a-z'-]+/)
    .filter(Boolean);
const stem = (word) =>
  word
    .replace(/'s$/, "")
    .replace(/ies$/, "y")
    .replace(/(?<=\w{3})s$/, "")
    .replace(/(?<=\w{3})ll$/, "l");

/**
 * English words for the looser comparisons, hyphenated words apart ("good-doers"), each reduced by stem()
 * and a final e ("argue" to "argu"), so that a prefix finds "punishment" for "punish".
 */
const looseStems = (gloss) =>
  englishWords(gloss)
    .flatMap((word) => word.split("-"))
    .filter((word) => word && !FUNCTION_WORDS.has(word))
    .map((word) => stem(word).replace(/(?<=\w{4})e$/, ""));
/**
 * Two English words of one stem: the same, or one of four letters or more beginning the other, as "punish" and
 * "punishment", "great" and "greater", "thunder" and "thunderclaps".
 */
function sameStem(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short === long || (short.length >= 4 && long.startsWith(short));
}
const shareStem = (a, b) => a.some((word) => b.some((other) => sameStem(word, other)));
/** Two English words of three letters or more one letter apart ("son", "sun", "sin"), which set a fourth apart. */
function oneLetterApart(a, b) {
  if (a === b || Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return [a.slice(i + 1) === b.slice(i + 1), a.slice(i + 1) === b.slice(i), a.slice(i) === b.slice(i + 1)].some(
    Boolean,
  );
}

/** An Arabic word without its article or a leading و, read before alef forms are unified so that أل stays. */
const arabicCore = (word) => bareArabic(word.replace(/^(?:[وفبك]?[اٱ]ل|لل|و)(?=\S{3})/, ""));

/** The words of a meaning that carry its sense, for the "no shared content word" rule. */
function contentWords(language, meaning) {
  if (language === "en")
    return englishWords(meaning)
      .filter((word) => !FUNCTION_WORDS.has(word))
      .map(stem);
  return meaning
    .replace(AR_MARKS, "")
    .split(/[^\u0621-\u064A\u0671]+/)
    .filter((word) => word && !AR_STOP.has(bareArabic(word)))
    .map(arabicCore)
    .filter((word) => word.length >= 3 && !AR_STOP.has(word));
}

const isNameGloss = (gloss) => englishWords(gloss).some((word) => NAME_WORDS.has(word) || /^a[lrdnszt]-/.test(word));

/**
 * Part of speech from a MASAQ tag: a name, a verb, a number, a comparative (أَزْكَىٰ), another adjective,
 * an active or passive participle, another noun-like word, or a particle.
 */
function wordClass(tag) {
  const parts = (tag ?? "").split("|");
  if (parts.some((part) => part.includes("NOUN_PROP"))) return "name";
  if (parts.some((part) => /^(PV|IV|CV)(_PASS)?$/.test(part) || /^IV\d/.test(part))) return "verb";
  if (parts.some((part) => part.startsWith("NOUN_NUM"))) return "number";
  if (parts.some((part) => part.startsWith("ADJ_COMP"))) return "comparative";
  if (parts.some((part) => part.startsWith("ADJ"))) return "adjective";
  if (parts.some((part) => part.startsWith("NOUN_ACTIVE_PART"))) return "active";
  if (parts.some((part) => part.startsWith("NOUN_PASSIVE_PART"))) return "passive";
  if (parts.some((part) => /^(NOUN|GERUND)/.test(part))) return "noun";
  return "other";
}
/** Verbs, and the noun-like classes together, for the lemma's part of speech. */
const broadClass = (cls) => (cls === "verb" || cls === "name" || cls === "other" ? cls : "noun");

// --- Arabic words: roots, cores and patterns ------------------------------------------------------------

const WEAK = "اوي";
/** A root's letters with hamza read as a weak letter, since a derived word may drop it or seat it on ا و ي. */
const rootLetters = (root) => [
  ...root
    .replace(AR_MARKS, "")
    .replace(/[أإآءؤئٱ]/g, "ا")
    .replace(/ى/g, "ي"),
];

/**
 * A pattern for the words that spell out a root, matched against words written as bareArabic writes them.
 * Two strong letters may have one letter between them ("إنزال" for نزل, "اهتدى" for هدي). A weak letter
 * or hamza at the start or end of the root is written as ا و ي (or ت where it assimilates, "اتقى" for
 * وقي): "الموعود" and "ميعاد" for وعد, "استعلى" for علو, "هداية" for هدي. One in the middle may also
 * vanish: "قال", "قل" for قول. A doubled root may be written with one letter at the end: "ظل" for ظلل.
 * A root of weak letters only, أوي or أيي, is matched as a whole word of those letters, with the article,
 * a joiner or ب ل ك before it, a م or person letter, and an ending after it: "آوى", "مأواهم", "آية", "بآيات".
 */
function rootPattern(root) {
  const letters = rootLetters(root);
  if (letters.length < 3) return null;
  if (letters.every((letter) => WEAK.includes(letter))) {
    const ends = "ات|ين|ون|وا|نا|ها|هم|كم|ه|ت|ك|ي|ا";
    const core = letters.includes("و") ? "او[اوي]?" : "اي?ي";
    return new RegExp(`^(?:[وف]?[بلك]?(?:ال)?)[يتنم]?${core}(?:${ends})?$`);
  }
  if (letters.length === 3 && letters[1] === letters[2] && !WEAK.includes(letters[1])) {
    const head = WEAK.includes(letters[0]) ? "[اويت]" : letters[0];
    return new RegExp(`${head}.?${letters[1]}(.?${letters[1]}|[اويهت]?$)`);
  }
  let source = "";
  letters.forEach((letter, i) => {
    if (WEAK.includes(letter)) {
      if (i === 0) source += "[اويت]";
      else source += i === letters.length - 1 ? "[اوي]" : "[اوي]?";
    } else {
      if (i > 0 && !WEAK.includes(letters[i - 1])) source += ".?";
      source += letter;
    }
  });
  return new RegExp(source);
}

/** Each word of an Arabic text, with marks removed and as bareArabic writes it, and its core without the article or و. */
const arabicTokens = (text) =>
  text
    .replace(AR_MARKS, "")
    .split(/[^\u0621-\u064A\u0671]+/)
    .filter((word) => word && !AR_STOP.has(bareArabic(word)))
    .flatMap((word) => [bareArabic(word), arabicCore(word)]);

/** Whether an Arabic text spells out the root, in any word other than a function word. */
function spellsRoot(root, text) {
  const pattern = rootPattern(root);
  return !!pattern && arabicTokens(text).some((word) => pattern.test(word));
}

/** Endings read off a word before its core: plural and dual, person, attached pronouns. Longest first. */
const CORE_SUFFIXES = ["تموه", "تما", "هما", "كما", "ون", "ين", "ات", "ان", "وا", "نا", "تم", "تن", "ني", "ها", "هم"]
  .concat(["هن", "كم", "ه", "ك", "ت", "ي", "ا"])
  .map(bareArabic);

/**
 * An Arabic word's core: without the article, a leading و or ف, ة or an ending of CORE_SUFFIXES, and a
 * person or participle letter (ي ت ن ا م) before four letters. Its radical is the core without ا و ي and doubled
 * letters, so that "لقينا" and "ألقينا" both read لق, and "علمنا" and "معلوم" both read علم. Its whole radical
 * keeps the ending, for a broken plural whose last letters look like one: "أعوان" and "معين" both read عن.
 */
function arabicCoreForms(word) {
  const plain = word.replace(AR_MARKS, "").replace(/^(?:[وف]?[بكل]?[اٱ]ل|[وف]?لل)(?=\S{2})/, "");
  let core = bareArabic(plain.replace(/(?<=\S{2})ة$/, ""));
  core = core.replace(/^[وف](?=\S{3})/, "");
  const whole = core.length >= 4 ? core.replace(/^[يتنام]/, "") : core;
  const suffix = CORE_SUFFIXES.find((ending) => core.length - ending.length >= 3 && core.endsWith(ending));
  if (suffix) core = core.slice(0, -suffix.length);
  if (core.length >= 4) core = core.replace(/^[يتنام]/, "");
  const radicalOf = (text) => text.replace(/[اوي]/g, "").replace(/(.)\1+/g, "$1");
  return { core, radical: radicalOf(core), whole: radicalOf(whole) };
}
const arabicCores = (text) =>
  text
    .replace(AR_MARKS, "")
    .split(/[^\u0621-\u064A\u0671]+/)
    .filter((word) => word && !AR_STOP.has(bareArabic(word)))
    .map(arabicCoreForms);

/** Two Arabic word cores that read as the same word: one core, or one radical of three letters or more. */
const sameCore = (a, b) => a.core === b.core || (a.radical.length >= 3 && a.radical === b.radical);
/** Two cores from one root by their radicals, whole or not ("لقينا", "ألقينا"), the looser test between options. */
const sameRadical = (a, b) =>
  [a.radical, a.whole].some((radical) => radical.length >= 2 && (radical === b.radical || radical === b.whole));

/** Uthmani's small alef, waw and ya written as the long vowels they are read as (يُجَٰدِلُ as يجادل). */
const longVowels = (word) =>
  word
    .replace(/\u0670/g, "ا")
    .replace(/\u06E5/g, "و")
    .replace(/\u06E6/g, "ي");

/**
 * A word's pattern as a reader sees it, without an ending of two letters or more: letters as C except
 * ا و ي after the first letter, and a first letter that marks a form (ي ت ن of a present verb, م of a
 * participle, ا or أ of أَفْعَلَ). It is distinctive when an ا و ي stands inside it (يُجَٰدِلُ is يCاCC,
 * فَاعِل is CاCC) or a form letter starts it, except the person letter of a present verb, which every
 * option of such an item has.
 */
function arabicPattern(word, presentVerb = false) {
  let letters = bareArabic(longVowels(word));
  const ending = AR_ENDINGS.find(
    (end) => end.length >= 2 && letters.length - end.length >= 3 && letters.endsWith(bareArabic(end)),
  );
  if (ending) letters = letters.slice(0, -bareArabic(ending).length);
  const shape = [...letters].map((letter, i) =>
    i === 0 ? ("يتنما".includes(letter) ? letter : "C") : WEAK.includes(letter) ? letter : "C",
  );
  const inside = shape.slice(1, -1).some((letter) => WEAK.includes(letter));
  const formLetter = !presentVerb && "ما".includes(shape[0]);
  return { pattern: shape.join(""), distinctive: shape.length >= 4 && (inside || formLetter) };
}

// --- Form: what an option's wording says about the word it belongs to --------------------------------

/**
 * Leading words that render something visible on the Arabic word or its place in the ayah: a joiner (و,
 * ف), the vocative, the article or tanween ("a", "any"), a preposition (ل, ب, ك), a possessive suffix, a
 * verb's person or tense, a participle ("those who"), or a negation around it.
 */
const LEAD_WORDS = new Set(
  `and so then but or nor while o a an any every no not the of to in on at by for with from into upon over about
  against like as than that those who whom which my our your his her its their i we you he she it they will shall
  would should can could may might must is are was were be been being am has have had do does did`.split(/\s+/),
);
/** Object pronouns that end a gloss, rendering a suffix on the Arabic word ("drive them out"). */
const OBJECT_WORDS = new Set(["me", "us", "you", "him", "her", "it", "them"]);
/** Pronouns a gloss capitalises wherever they stand. Any other capital marks an ayah's first word or a name. */
const ALWAYS_CAPITAL = new Set(["I", "He", "Him", "His", "We", "Us", "Our", "Me", "My"]);

/**
 * An English gloss's lead and the rest: its leading lead words ("an" read as "a"), the text of its
 * parentheses, "surely" (the emphatic لَ), an object pronoun near its end, and "Aa" for a capital other
 * than on a pronoun, which marks an ayah's first word ("Turning") or a name ("Most Merciful").
 */
function englishLead(gloss) {
  const words = gloss.trim().split(/\s+/);
  const lead = [];
  let start = 0;
  for (; start < words.length - 1; start++) {
    if (/^\(.*\)$/.test(words[start])) continue;
    const bare = words[start].toLowerCase().replace(/[^a-z]/g, "");
    if (!LEAD_WORDS.has(bare)) break;
    // "We" for Allah and "we" for people read differently, so a pronoun keeps its capital.
    const capital = ALWAYS_CAPITAL.has(words[start].replace(/[^A-Za-z]/g, ""));
    lead.push(bare === "an" ? "a" : capital ? words[start].replace(/[^A-Za-z]/g, "") : bare);
  }
  lead.push(...(gloss.toLowerCase().match(/\([^)]*\)/g) ?? []));
  if (/\b(surely|indeed|verily|certainly)\b/i.test(gloss)) lead.push("surely");
  const tail = words.slice(Math.max(start + 1, words.length - 2)).map((word) => word.toLowerCase());
  if (tail.some((word) => OBJECT_WORDS.has(word))) lead.push("~obj");
  const capital = gloss.split(/[^A-Za-z]+/).some((word) => /^[A-Z]/.test(word) && !ALWAYS_CAPITAL.has(word));
  if (capital) lead.push("Aa");
  const rest = words
    .slice(start)
    .join(" ")
    .replace(/\([^)]*\)/g, " ");
  return { lead: lead.join(" "), rest: rest.trim() || gloss };
}

const wordList = (text) => new Set(text.split(/\s+/).filter(Boolean));
const NUMBER_WORDS = wordList(`two three four five six seven eight nine ten eleven twelve nineteen twenty thirty forty
  fifty sixty seventy eighty ninety hundred hundreds thousand thousands first second third fourth fifth sixth seventh
  eighth ninth tenth once twice thrice half double`);
const COMPARATIVE_WORDS = wordList(`best worst better worse greater greatest higher highest lower lowest nearer nearest
  larger largest smaller smallest stronger strongest older oldest younger youngest closer closest farther farthest
  further furthest richer purer wiser wisest longer shorter harder deeper swifter faster quicker sooner finer kinder
  mightier mightiest easier easiest heavier truer dearer fewer lesser worthier`);
const IRREGULAR_PAST = wordList(`made took taken came went gone gave given said saw seen knew known found brought
  thought told became began begun sent spent left kept held stood sat fell fallen felt built caught taught fought
  sought bought won ran rose risen wrote written spoke spoken broke broken chose chosen drove driven ate eaten drank
  drunk forgot forgotten forgave forgiven hid hidden led lost meant met paid laid slew slain swore sworn threw thrown
  understood wore worn struck stricken overtook overtaken withheld upheld did shown drew drawn grew grown flew flown
  blew blown bore born borne tore torn woke bound fed fled bred dealt dwelt knelt slept swept wept crept bent lent
  sold heard stuck strove striven shook shaken forsook forsaken beheld befell bade bidden sank sunk sang sung rang
  rung sprang sprung swam swum spun hung clung flung stung swung got gotten forbade forbidden sent`);
const NOT_PAST = wordList(`need needs seed deed creed breed speed steed weed feed heed bleed proceed succeed exceed
  hundred sacred naked wicked kindred shed bed red wed`);
const NOT_ING = wordList(`thing things nothing something anything everything offspring spring string sling bring
  cling fling sting swing king kings ring wing wings sing morning mornings evening evenings ceiling sibling`);
const NOT_LY = wordList(`family assembly supply reply apply comply multiply ally rally belly jelly bully lily folly
  fly butterfly anomaly monopoly`);
const NOT_PLURAL = wordList(`this thus was has his its hers ours yours theirs is as us yes less unless always perhaps
  news means chaos species series jesus moses whereas besides sometimes`);
const ADJECTIVE_WORDS = wordList(`great good bad evil clear true right wrong wise new old near far high low big small
  little strong weak rich poor mighty severe firm straight pure equal blind deaf dumb dead alive free full empty open
  secret sure certain aware hard soft heavy dark black white green yellow red blue deep wide broad long short sweet
  bitter hot cold dry clean sincere just unjust kind gentle harsh proud humble holy sacred noble lawful unlawful
  manifest evident apparent obvious eternal everlasting abundant pleasant distant ignorant arrogant patient obedient
  disobedient innocent excellent sufficient permanent absent silent worthy ready happy angry guilty easy fair foul
  vile base fine dear late early wild calm safe sound secure false chaste upright same submissive steadfast private
  glad vain afraid difficult swift alone alike wealthy barren needy unaware averse lofty molten mad intense foremost
  distinct paternal maternal appropriate vast trustworthy superior inferior interior exterior subtle stealthy sick
  perfect obligatory moderate legal large impure ill foolish foreign enough embryonic diverse decisive blameworthy
  young supreme stingy stern steep sexual salty sacrificial polytheistic modest loud laden immortal idle hollow fresh
  exemplary appreciative ample asleep weary warm unintentional uneasy unchaste transitory tight thirsty thick
  temporary sunken stubborn stormy single similar sharp several remote quarrelsome prone precise perpetual obstinate
  obscure necessary narrow naked mutual murky lewd lazy lame inner immediate immature hostile haughty gradual
  extreme extinct extensive exclusive excessive eldest eastern decorative conclusive compassionate collective cloven
  ceremonial attractive additional abject rocky rhythmic wicked opposite solemn cool`);
/** Adjective endings, with nouns that happen to end so; -ment is a noun. */
const ADJECTIVE_ENDING = /(ful|ous|less|ible|able|ical|[^m]ant|[^m]ent)$/;
const NOT_ADJECTIVE = wordList(`table cable fable parable vegetable stable bible bless unless servant servants covenant
  parent descendant inhabitant merchant tenant giant elephant agent client talent event student president resident
  accident incident torrent current serpent continent opponent recipient ingredient instant infant plant grant want
  rent tent scent dent vent consent assent content intent extent percent garment tyrant tyrants migrant emigrant
  occupant claimant applicant assistant attendant defendant informant peasant warrant chant enchant implant recant
  supplant slant invent prevent repent relent resent represent dissent descent ascent accent advent cent component
  element adherent proponent`);

/**
 * The visible form of one English word: a number, a comparative, a function word, an adjective, -ed or an
 * irregular past, -ing, -ly, a plural or third person -s, or a base form.
 */
function englishWordForm(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  if (NUMBER_WORDS.has(w)) return "number";
  if (COMPARATIVE_WORDS.has(w) || /^(more|most)$/.test(w)) return "comparative";
  if (FUNCTION_WORDS.has(w)) return "function";
  if (ADJECTIVE_WORDS.has(w) || (ADJECTIVE_ENDING.test(w) && !NOT_ADJECTIVE.has(w))) return "adjective";
  if (IRREGULAR_PAST.has(w) || IRREGULAR_PAST.has(w.replace(/^un/, ""))) return "past";
  if (w.length >= 4 && w.endsWith("ed") && !NOT_PAST.has(w)) return "past";
  if (w.length >= 5 && w.endsWith("ing") && !NOT_ING.has(w)) return "ing";
  if (w.length >= 5 && w.endsWith("ly") && !NOT_LY.has(w)) return "ly";
  if (/^(men|women|people|children|feet|teeth|brethren|cattle)$/.test(w)) return "s";
  if (w.length >= 3 && /[^sui']s$/.test(w) && !NOT_PLURAL.has(w)) return "s";
  return "base";
}
/** Whether an English gloss reads as plural: its last word, as englishWordForm reads it. */
const englishPlural = (gloss) => englishWordForm(englishLead(gloss).rest.split(/\s+/).at(-1) ?? "") === "s";

/** A word's prefixes as units: one-letter particles and the article, which after ل is written "ل". */
function prefixUnits(prefix) {
  const units = [];
  for (let rest = prefix; rest; ) {
    if (rest.startsWith("ال")) {
      units.push("ال");
      rest = rest.slice(2);
    } else if (rest === "ل" && units.at(-1) === "ل") {
      units.push("ال");
      rest = "";
    } else {
      units.push(rest[0]);
      rest = rest.slice(1);
    }
  }
  return units;
}

/**
 * An Arabic meaning's lead and the rest: the word's prefixes that the meaning's first word repeats, in
 * order (ل in "لوالدي" for لِأَبِى), the article when the meaning starts with one, a ب ل ك of the meaning's
 * own before the article or a hamza ("بإخلاص" for مُخْلِصِينَ), and a function word first ("ما وُورِيَ").
 */
function arabicLead(prefix, meaning) {
  // Marks removed but alef forms kept, so that "ألهمنا" does not read as the article.
  let rest = meaning.replace(AR_MARKS, "").trim();
  // The same with a letter under shadda written twice, so that the ل of "لَشَكَّ" reads as a prefix.
  let doubled = meaning
    .replace(/(\S)[\u064B-\u0650\u0652]*\u0651/g, "$1$1")
    .replace(AR_MARKS, "")
    .trim();
  const startsWith = (unit) => (unit === "ا" ? /^[اأإآٱ]/.test(rest) : rest.startsWith(unit));
  const lead = [];
  for (const unit of prefixUnits(prefix)) {
    if (unit === "ال" && lead.at(-1) === "ل" && rest.startsWith("ل") && !rest.startsWith("ال")) {
      lead.push(unit);
      rest = rest.slice(1);
      doubled = doubled.slice(1);
    } else if (startsWith(unit) && /^\S{3}/.test(doubled.slice(unit.length))) {
      lead.push(unit);
      rest = rest.slice(unit.length);
      doubled = doubled.slice(unit.length);
    }
  }
  const own = /^([بلك])(?=(?:[اٱ]ل|[أإآ])\S{2})/.exec(rest);
  if (own) {
    lead.push(`~${own[1]}`);
    rest = rest.slice(1);
  }
  // "الذي" and "التي" are function words, not the article.
  if (!lead.includes("ال") && /^[اٱ]ل\S{2}/.test(rest) && !AR_STOP.has(bareArabic(rest.split(/\s+/)[0]))) {
    lead.push("ال");
    rest = rest.slice(2);
  }
  const first = rest.split(/\s+/)[0] ?? "";
  if (AR_STOP.has(bareArabic(first))) lead.push(`~${bareArabic(first)}`);
  return { lead: lead.join("+"), rest };
}

/**
 * Endings an Arabic word can show, longest first; ة stays apart from the pronoun ه. The ones of two letters
 * or more carry number, person or a pronoun (ون, وا, نا, تم, هم), so every option's first word has the same
 * one of those; any ending, one letter included, is copied from the asked word by all four options or none.
 */
const AR_ENDINGS = ["تموه", "تموها", "تموني", "تما", "هما", "كما", "ونا", "وني", "ون", "ين", "ات", "ان", "وا", "نا"]
  .concat(["تم", "تن", "ني", "ها", "هم", "هن", "كم", "ة", "ه", "ك", "ت", "ي", "ا"])
  .sort((a, b) => b.length - a.length);

const QURAN_MARKS = /[\u06D6-\u06ED]/g;

/** The three tanween, which show the case: -an (accusative), -un (nominative), -in (genitive). */
const TANWEEN = { "\u064B": "an", "\u064C": "un", "\u064D": "in" };
const tanweenOf = (text) => [...new Set(text.match(/[\u064B-\u064D]/g) ?? [])].map((mark) => TANWEEN[mark]);
/** The case a final mark shows: fatha and -an, damma and -un, kasra and -in, or a sukun. */
const CASE_OF = { an: "a", un: "u", in: "i", "\u064E": "a", "\u064F": "u", "\u0650": "i", "\u0652": "o" };

/**
 * An Arabic word's ending (AR_ENDINGS), the letter before it, and its final mark: its tanween by type,
 * else its final short vowel or sukun, punctuation and Quranic signs aside. A word rhymes on its last
 * letter before an ending of two letters or more, a ة or the alef of -an: "يَخْفِضُونَ" rhymes with
 * يَغُضُّونَ on ض, "ناصرًا" with أَمْرًا on ر.
 */
function arabicEnd(word) {
  const text = word.replace(QURAN_MARKS, "").replace(/[^\u0621-\u0652\u0670\u0671]/g, "");
  const letters = text
    .replace(AR_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي");
  const ending = AR_ENDINGS.find((end) => letters.length > end.length + 1 && letters.endsWith(end)) ?? "";
  const final = tanweenOf(text)[0] ?? /[\u064E-\u0652](?=\u0651?$)/.exec(text)?.[0] ?? "";
  const body = ending.length >= 2 ? letters.slice(0, -ending.length) : letters.replace(/(?<=\S{2})[ةا]$/, "");
  const rhyme = body.at(-1) ?? "";
  return { ending, final, rhyme };
}

/**
 * Whether an Arabic text shows its vowels: a fatha, damma, kasra or sukun inside a word, not only on its
 * last letter ("حُكْماً" is voweled, "ناصرًا" and "ينطقُ" are not). A shadda alone does not count.
 */
const voweled = (text) =>
  text
    .replace(QURAN_MARKS, "")
    .split(/\s+/)
    .some((word) => /[\u064E-\u0650\u0652]/.test(word.replace(/[\u064B-\u0652]*[اى]?[\u064B-\u0652]*$/, "")));

/** The vowel on a word's first letter after a joiner, which shows a present verb's form: يُفْعِلُ, not يَفْعُلُ. */
function openingMark(word) {
  const text = word.replace(QURAN_MARKS, "").replace(/^[وف][\u064B-\u0652]*(?=\S{3})/, "");
  return /^[\u0621-\u064A]\u0651?([\u064E-\u0650\u0652])/.exec(text)?.[1] ?? "";
}

/** The vowel on a word's letter at this index, counting letters as bareArabic keeps them (يُ in وَيُخْرِجُونَ at 1). */
function vowelOn(word, index) {
  const units = word.replace(/[\u0670\u06D6-\u06ED]/g, "").match(/[\u0621-\u064A\u0671][\u064B-\u0652]*/g) ?? [];
  return /[\u064E-\u0650\u0652]/.exec(units[index] ?? "")?.[0] ?? "";
}

/**
 * An Arabic meaning's first word that is not a function word, and the meaning's shape as written: its
 * number of words, its first word's ending of two letters or more, and whether it has tanween anywhere,
 * which a meaning copies from its word ("أنكروا" for كذبوا, "جَزاءٌ" for أَجْرٌ).
 */
function arabicShape(meaning) {
  const words = meaning.trim().split(/\s+/);
  const first = words.find((word) => !AR_STOP.has(bareArabic(word))) ?? words[0];
  const { ending } = arabicEnd(first);
  const tanween = /[\u064B-\u064D]/.test(meaning);
  return { first, shape: [words.length, ending.length >= 2 ? ending : "", tanween].join(":") };
}

/** Letters of a meaning without marks, spaces or brackets, for the length rule. */
const letterCount = (meaning) => meaning.replace(AR_MARKS, "").replace(/[\s()[\],،]/g, "").length;
const lengthsApart = (a, b) => Math.max(a, b) > 2 * Math.min(a, b) + LENGTH_SLACK;

// --- Seeded choice ------------------------------------------------------------------------------------

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const streamSeed = (...parts) => createHash("sha256").update(parts.join(":")).digest().readUInt32BE(0);
function seededShuffle(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The hash the owner's review code carries: every item's positions, in bank order. */
function bankHash(items) {
  const at = (p) => `${p.surah}:${p.ayah}:${p.pos}`;
  const lines = items.map((item) =>
    [item.boundary, item.language, at(item.word), ...item.distractors.map(at)].join(" "),
  );
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 12);
}

// --- Data ---------------------------------------------------------------------------------------------

const sql = new DatabaseSync(DB_PATH, { readOnly: true });
const db = {
  getAllAsync: async (source, params = []) => sql.prepare(source).all(...params),
  getFirstAsync: async (source, params = []) => sql.prepare(source).get(...params) ?? null,
};
const index = await loadLemmaIndex(db);

const byPosition = (source) =>
  new Map(
    sql
      .prepare(source)
      .all()
      .map((row) => [positionKey(row.surah, row.ayah, row.word_pos), row]),
  );
const glosses = byPosition("SELECT surah, ayah, word_pos, translation_en FROM word_translations");
const irab = byPosition("SELECT surah, ayah, word_pos, arabic_word, morphological_tag FROM word_irab");
const arabic = byPosition("SELECT surah, ayah, word_pos, word, meaning FROM word_meanings_ar");
const stems = byPosition("SELECT surah, ayah, word_pos, word_text FROM word_roots");
const ayat = new Map(
  sql
    .prepare("SELECT surah, ayah, text_uthmani, text_qcf2 FROM quran_text")
    .all()
    .map((row) => [`${row.surah}:${row.ayah}`, row]),
);
sql.close();

/** The words a card highlights in each ayah, by position. */
const shownWords = new Map();
function ayahWords(p) {
  const key = `${p.surah}:${p.ayah}`;
  if (!shownWords.has(key)) {
    const row = ayat.get(key);
    shownWords.set(key, row ? mushafWordTexts(p.surah, p.ayah, row.text_uthmani, row.text_qcf2) : []);
  }
  return shownWords.get(key);
}
const shownAt = (p) => ayahWords(p)[p.pos - 1] ?? "";

/** The lemma pairs in each ayah, so a distractor never comes from the ayah the learner is reading. */
const ayahLemmas = new Map();
/** The roots in each ayah by position, so no option shares a root with a word the reader sees beside it. */
const ayahRoots = new Map();
for (const [key, entry] of index.lemmaAt) {
  const [surah, ayahNumber, pos] = key.split(":");
  const ayah = `${surah}:${ayahNumber}`;
  if (!ayahLemmas.has(ayah)) ayahLemmas.set(ayah, new Set());
  ayahLemmas.get(ayah).add(entry.key);
  if (!ayahRoots.has(ayah)) ayahRoots.set(ayah, []);
  if (entry.root) ayahRoots.get(ayah).push({ pos: Number(pos), root: entry.root });
}
/**
 * Whether the asked ayah has a word of this root at another position than the asked word. يُعَذِّبُ
 * beside عَذَابَهُۥ (89:25) or كَبِيرٌ beside أَكْبَرُ (2:219) lets a reader who knows the other word
 * find the meaning; a wrong option of a root in the ayah points to the word it belongs beside.
 */
const rootInAyah = (asked, root) =>
  (ayahRoots.get(`${asked.surah}:${asked.ayah}`) ?? []).some((word) => word.pos !== asked.pos && word.root === root);

const keyOf = (p) => positionKey(p.surah, p.ayah, p.pos);
const glossAt = (p) => glosses.get(keyOf(p))?.translation_en?.trim() ?? "";
const meaningAt = (language, p) => (language === "en" ? glossAt(p) : (arabic.get(keyOf(p))?.meaning?.trim() ?? ""));
const tagAt = (p) => irab.get(keyOf(p))?.morphological_tag ?? "";
const classAt = (p) => wordClass(tagAt(p));
const isLongAyah = (p) => ayahWords(p).length > LONG_AYAH_WORDS;

/** The highlighted word around its `word_roots` stem, without marks, or null when the stem is not in it. */
function affixesAt(p) {
  const word = bareArabic(shownAt(p)).replace(/\s+/g, "");
  const stemText = bareArabic(stems.get(keyOf(p))?.word_text ?? "");
  const at = stemText ? word.indexOf(stemText) : -1;
  return at < 0 ? null : { prefix: word.slice(0, at), stem: stemText, suffix: word.slice(at + stemText.length) };
}

/** What the reader sees of an asked ayah, to keep its words out of the options: Arabic cores, English glosses. */
const ayahText = new Map();
function ayahWordsFor(language, p) {
  const key = `${language}:${p.surah}:${p.ayah}`;
  if (!ayahText.has(key)) {
    const all = ayahWords(p).map((word, i) => ({ pos: i + 1, word }));
    ayahText.set(
      key,
      all.map(({ pos, word }) => ({
        pos,
        words: language === "ar" ? arabicCores(word) : looseStems(glossAt({ surah: p.surah, ayah: p.ayah, pos })),
      })),
    );
  }
  return ayahText.get(key);
}
/**
 * Whether a meaning repeats a word of the asked ayah: in Arabic any word of it, by its core or by spelling
 * out its root ("تتبعا للأثر" for قَصَصًا beside ءَاثَارِهِمَا), in English a word of another word's gloss by
 * its stem ("will punish" beside "(as) His punishment", "great" beside "(is) greater", "thunder" beside
 * "the thunderclaps").
 */
function repeatsAyah(language, asked, meaning) {
  const ayah = ayahWordsFor(language, asked);
  if (language === "ar") {
    const mine = arabicCores(meaning);
    if (ayah.some(({ words }) => words.some((word) => mine.some((own) => sameCore(own, word))))) return true;
    return (ayahRoots.get(`${asked.surah}:${asked.ayah}`) ?? []).some(({ root }) => spellsRoot(root, meaning));
  }
  const mine = looseStems(meaning);
  return ayah.some(({ pos, words }) => pos !== asked.pos && shareStem(mine, words));
}

/** A verb's tense by its tag: perfect, imperfect or imperative. */
function tenseOf(tag) {
  const parts = tag.split("|");
  if (parts.some((part) => /^CV/.test(part))) return "command";
  if (parts.some((part) => /^IV/.test(part))) return "present";
  return "past";
}

/** A noun's number: dual or plural by its tag, else plural when its English gloss is (a broken plural). */
function numberAt(p) {
  const tag = tagAt(p);
  if (/_DU/.test(tag)) return "dual";
  if (/_PL|SUBJ:\dMP|SUBJ:\dFP/.test(tag)) return "plural";
  return englishPlural(glossAt(p)) ? "plural" : "singular";
}

/**
 * Whether a verb is spelled in the passive, whatever its tag says (27:68 وُعِدْنَا, 65:7 قُدِرَ are tagged
 * active). In the past: a damma on the first letter and a kasra on the second or third (فُعِلَ, فُعِّلَ,
 * أُفْعِلَ), a damma and a doubled last letter (سُرَّ), or a kasra and ي (قِيلَ). In the present: a damma
 * on the person letter and a fatha or ا before the stem's last letter (يُفْعَلُ, يُضَٰعَفُ, يُزادُ), where an
 * active verb has a kasra (يُفْعِلُ, يُضَٰعِفُ). A joiner may come first.
 */
function spelledPassive(tense, word) {
  const text = word
    .replace(/[\u06D6-\u06ED]/g, "")
    .replace(/ى\u0670/g, "ى")
    .replace(/\u0670/g, "ا");
  if (tense === "past")
    return /^(?:[وف]\u064E)?[\u0621-\u064A](?:\u064F[\u0621-\u064A](?:\u0651?\u0650|\u0650\u0651|\u0652[\u0621-\u064A]\u0650|(?:\u0651\u064E?|\u064E\u0651)$)|\u0650ي)/.test(
      text,
    );
  if (tense !== "present" || !/^(?:[وف]\u064E)?[يتنأ]\u064F/.test(text)) return false;
  const units = text.match(/[\u0621-\u064A][\u064B-\u0652]*/g) ?? [];
  const letters = units.map((unit) => unit[0]).join("");
  const ending = /(ون|ين|ان|وا)$/.test(letters) && units.length >= 5 ? 2 : 0;
  const before = units[units.length - ending - 2] ?? "";
  return before[0] === "ا" || before.includes("\u064E");
}

/**
 * What the Arabic word shows besides its meaning, the same for all four options of an item: its class, and
 * for a verb its tense, voice (by tag or spelling), person letter, ending after the stem, a feminine ت and
 * its final vowel (the mood of يَأْتِ); for a noun its voice (a passive participle), number, ending after
 * the stem (an attached pronoun, ـاني) and, for an adjective or participle, a feminine form.
 */
function wordShapeAt(p) {
  const tag = tagAt(p);
  const cls = classAt(p);
  const affixes = affixesAt(p);
  const shown = shownAt(p);
  const tense = cls === "verb" ? tenseOf(tag) : "";
  const passive = /(^|\|)(PV|IV|CV)_PASS(\||$)/.test(tag) || cls === "passive" || spelledPassive(tense, shown);
  const voice = passive ? "passive" : "active";
  if (cls === "verb") {
    const person = tense === "present" ? affixes.stem[0] : "";
    const feminine = /SUFF_FEM_TA|SUBJ:3FS/.test(tag) ? "f" : "";
    return [cls, tense, voice, person, affixes.suffix, feminine, arabicEnd(shown).final].join(":");
  }
  const agrees = cls === "adjective" || cls === "active" || cls === "passive";
  const feminine = agrees && (/FEM/.test(tag) || /ة$/.test(shown.replace(/[^\u0621-\u064A]/g, ""))) ? "f" : "";
  return [cls, voice, numberAt(p), affixes.suffix, feminine].join(":");
}

/**
 * An option's form: its lead (see englishLead and arabicLead) and its shape, being the word's shape
 * (wordShapeAt) and the wording's own (englishWordForm per word, or arabicShape). All four options of an
 * item have the same lead and shape, so none stands out by its form.
 */
function formAt(language, p) {
  const word = wordShapeAt(p);
  if (language === "en") {
    const { lead, rest } = englishLead(glossAt(p));
    return { lead, rest, shape: `${word}|${rest.split(/\s+/).map(englishWordForm).join(" ")}` };
  }
  const meaning = meaningAt("ar", p);
  const { lead, rest } = arabicLead(affixesAt(p).prefix, meaning);
  const { first, shape } = arabicShape(meaning);
  // A verb's meaning spelled in the passive (يُسْكَبُ) reads differently from an active one. A present verb's
  // opening vowel shows its form, which copiesFrom compares with the asked word's.
  const tense = classAt(p) === "verb" ? tenseOf(tagAt(p)) : "";
  const spelled = spelledPassive(tense, first) ? "passive" : "";
  const opening = tense === "present" ? openingMark(first) : "";
  return { lead, rest, shape: `${word}|${shape}:${spelled}`, first, opening };
}
/** A word with a prefix (و, ل, ال) or an attached pronoun, whose meaning tends to carry it. */
const isAffixed = (p) => affixesAt(p).prefix !== "" || /(^|\|)(POSS_PRON|OBJ_PRON)/.test(tagAt(p));

/**
 * The Arabic word itself, without marks: its stem and its lemma, of three letters or more. An Arabic
 * meaning that uses another option's word points to it ("يريد" offered against يُرِيدُ), and one that
 * uses its own word gives it away ("متقيا" for تَقِيًّا).
 */
const wordForms = (entry, p) =>
  [affixesAt(p).stem, entry.lemma].map((form) => bareArabic(form)).filter((form) => form.length >= 3);
const usesWord = (words, forms) => [...words].some((word) => forms.some((form) => word.includes(form)));
/** Whether two words share a run of four letters ("انتصف" for انتصر), which a guess could match on. */
const looksLike = (a, b) => [...a].slice(3).some((_, i) => b.includes(a.slice(i, i + 4)));
/**
 * Whether an Arabic meaning points to the asked word: it spells out the word's root, uses its stem or
 * lemma, shares four letters in a row with its stem, or has a word with its core. For the right answer
 * this gives it away; for a wrong option it is a lure.
 */
function pointsTo(entry, p, meaning) {
  const words = contentWords("ar", meaning);
  const stemText = bareArabic(affixesAt(p).stem);
  const own = arabicCoreForms(shownAt(p));
  return (
    spellsRoot(entry.root, meaning) ||
    usesWord(words, wordForms(entry, p)) ||
    words.some((word) => looksLike(word, stemText)) ||
    arabicCores(meaning).some((core) => sameCore(core, own))
  );
}

function commonest(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count };
  return { best: best?.value ?? null, top: best?.count ?? 0, counts };
}

/**
 * The part of speech at least LEMMA_CLASS_SHARE of a lemma's verb and noun positions have, when the
 * lemma's spelling agrees, or null. A few tags are wrong (55:2:1 عَلَّمَ is a gerund), a lemma tagged both
 * ways (وَعْد) is left out, and so is a "verb" spelled as a noun (حِلّ, ending in a bare letter or shadda)
 * or a "noun" spelled as a verb (أُهِلَّ, ending in a fatha or damma).
 */
const lemmaClasses = new Map();
function lemmaClass(entry) {
  if (!lemmaClasses.has(entry.key)) {
    const classes = entry.positions.en.map((p) => broadClass(classAt(p))).filter((c) => c === "verb" || c === "noun");
    const { best, counts } = commonest(classes);
    const last = entry.lemma.at(-1) ?? "";
    const spelled = best === "verb" ? /[\u064E-\u0650\u0652اى]/.test(last) : !/[\u064E\u064F\u0652]/.test(last);
    const agreed = best && counts.get(best) >= LEMMA_CLASS_SHARE * classes.length && spelled;
    lemmaClasses.set(entry.key, agreed ? best : null);
  }
  return lemmaClasses.get(entry.key);
}

/** A lemma that makes a fair question: a root, not mostly a name, and a usual gloss with a content word. */
function fairLemma(entry) {
  if (!entry.root || !lemmaClass(entry)) return false;
  const positions = entry.positions.en;
  if (positions.length === 0) return false;
  const names = positions.filter((p) => classAt(p) === "name").length;
  if (names * 2 >= positions.length) return false;
  const usual = commonest(positions.map((p) => meaningKeys(glossAt(p))[0])).best ?? "";
  return contentWords("en", usual).length > 0 && !isNameGloss(usual);
}

/** Whether a lemma's eligible position makes a fair option, in that language. */
function fairPosition(language, entry, p) {
  if (broadClass(classAt(p)) !== lemmaClass(entry)) return false;
  if (!sameWord(shownAt(p), irab.get(keyOf(p))?.arabic_word ?? "") || !affixesAt(p)) return false;
  const gloss = glossAt(p);
  if (!gloss || MALFORMED_EN.test(gloss) || isNameGloss(gloss) || contentWords("en", gloss).length === 0) return false;
  if (language === "en") return gloss.length <= MAX_EN;
  const meaning = meaningAt("ar", p);
  // The check screen shows a meaning's first line, so a meaning here has only one.
  if (!meaning || meaning.length > MAX_AR || meaning.includes("\n") || MALFORMED_AR.test(meaning)) return false;
  // A pronoun is the word's own only when the word carries one ("زوجاتكم" for نِسَآؤُكُمْ).
  if (!/(^|\|)(POSS_PRON|OBJ_PRON)/.test(tagAt(p)) && tiesToAyah(meaning)) return false;
  return !namesOrExplains(meaning) && contentWords("ar", meaning).length > 0;
}

const byRank = (a, b) => {
  for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
  return 0;
};

/** The words of a meaning compared between options: English stems, or Arabic cores and radicals. */
const optionWords = (language, meaning) =>
  language === "en" ? contentWords("en", meaning).map((word) => ({ core: word, radical: "" })) : arabicCores(meaning);

/**
 * A lemma's meanings over all its eligible positions in a language, fair or not, without their leads:
 * how often each occurs, its usual ones (USUAL_SHARE of the commonest, when that recurs), and the words in
 * FREQUENT_SHARE of its positions or more, for near-synonyms.
 */
const lemmaMeanings = new Map();
function meaningsOf(entry, language) {
  const key = `${language}|${entry.key}`;
  if (!lemmaMeanings.has(key)) {
    const all = entry.positions[language]
      .filter((p) => affixesAt(p) && meaningAt(language, p))
      .map((p) => {
        const rest =
          language === "en" ? englishLead(glossAt(p)).rest : arabicLead(affixesAt(p).prefix, meaningAt("ar", p)).rest;
        return { key: meaningKeys(rest)[0], words: optionWords(language, rest) };
      });
    const { top, counts } = commonest(all.map((meaning) => meaning.key));
    const usual = top >= 2 ? all.filter((meaning) => counts.get(meaning.key) >= Math.max(2, USUAL_SHARE * top)) : [];
    const wordCounts = new Map();
    // Arabic words count by their radical when it has three letters ("كاملة", "أكملوا"), else by their core.
    const wordKey = (w) => (w.radical.length >= 3 ? w.radical : w.core);
    for (const meaning of all)
      for (const word of new Set(meaning.words.map(wordKey))) wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    const frequent = new Set(
      [...wordCounts].filter(([, count]) => count >= FREQUENT_SHARE * all.length).map(([word]) => word),
    );
    const usualWords = new Set(usual.flatMap((meaning) => meaning.words.map(wordKey)));
    // The plain sense reads every position's meaning, eligible or not: حياة has two one-word Arabic
    // entries, and its other entries ("الحياة الدنيا") tell its usual sense.
    const senses = entry.positions.en
      .map((p) => ({ p, meaning: meaningAt(language, p) }))
      .filter(({ p, meaning }) => meaning && affixesAt(p))
      .map(({ p, meaning }) => {
        const rest = language === "en" ? englishLead(meaning).rest : arabicLead(affixesAt(p).prefix, meaning).rest;
        return new Set(optionWords(language, rest).map(wordKey));
      });
    const senseCounts = new Map();
    for (const words of senses) for (const word of words) senseCounts.set(word, (senseCounts.get(word) ?? 0) + 1);
    const plainWords = new Set(
      [...senseCounts].filter(([, count]) => count >= FREQUENT_SHARE * senses.length).map(([word]) => word),
    );
    lemmaMeanings.set(key, { all, counts, usual, frequent, usualWords, plainWords, wordKey });
  }
  return lemmaMeanings.get(key);
}

/**
 * Whether a meaning is the lemma's plain sense: each of its words is in FREQUENT_SHARE of the meanings at
 * all the lemma's positions or in a usual one. "معيشة آمنة" for حَيَوٰةٌ in 2:179 fits that ayah only:
 * آمنة is in two of حياة's 25 Arabic meanings. A lemma with fewer than five meanings passes, since each of
 * its words is then frequent.
 */
function isPlain(language, entry, rest) {
  const { plainWords, usualWords, wordKey } = meaningsOf(entry, language);
  return optionWords(language, rest).every((word) => plainWords.has(wordKey(word)) || usualWords.has(wordKey(word)));
}

/** Whether a meaning is one of the lemma's usual ones, or shares a word with them. A lemma with no recurring meaning passes. */
function isUsual(language, entry, rest) {
  const { usual } = meaningsOf(entry, language);
  if (usual.length === 0) return true;
  const mine = { key: meaningKeys(rest)[0], words: optionWords(language, rest) };
  return usual.some(
    (other) =>
      other.key === mine.key ||
      other.words.some((word) =>
        mine.words.some((own) => (language === "en" ? word.core === own.core : sameCore(word, own))),
      ),
  );
}

/** Whether two lemmas mean nearly the same: their frequent meaning words meet, in either language. */
function nearSynonyms(a, b) {
  return LANGUAGES.some((language) => {
    const mine = meaningsOf(a, language).frequent;
    return [...meaningsOf(b, language).frequent].some((word) => mine.has(word));
  });
}

/** One fair position of a lemma as an option, with what the item rules compare. */
function candidateAt(language, entry, p, order) {
  const meaning = meaningAt(language, p);
  const { lead, rest, shape, first, opening } = formAt(language, p);
  return {
    entry,
    position: p,
    meaning,
    rest,
    lead,
    shape,
    signature: `${lead}||${shape}`,
    order,
    letters: letterCount(meaning),
    keys: meaningKeys(meaning),
    textKey: contentWords(language, meaning).sort().join(" "),
    words: new Set(contentWords(language, meaning)),
    stems: language === "en" ? looseStems(meaning) : [],
    cores: optionWords(language, meaning),
    forms: wordForms(entry, p),
    first: first ?? "",
    final: first ? arabicEnd(first).final : "",
    rhyme: first ? arabicEnd(first).rhyme : "",
    opening: opening ?? "",
    voweled: language === "ar" && voweled(meaning),
  };
}

/** The asked word's candidates for a lemma, best first: usual, not giving itself away, then the rank above. */
function askedCandidates(entry, language) {
  const fair = entry.positions[language].filter((p) => fairPosition(language, entry, p));
  const { all, counts } = meaningsOf(entry, language);
  return fair
    .map((p, order) => {
      const candidate = candidateAt(language, entry, p, order);
      const mine = { key: meaningKeys(candidate.rest)[0], words: optionWords(language, candidate.rest) };
      const related = all.filter(
        (other) =>
          other.key === mine.key ||
          other.words
            .slice(0, 1)
            .some((word) => mine.words.slice(0, 1).some((own) => word.core === own.core || sameCore(word, own))),
      ).length;
      const askable =
        isUsual(language, entry, candidate.rest) &&
        isPlain(language, entry, candidate.rest) &&
        !(language === "ar" && pointsTo(entry, p, candidate.meaning)) &&
        !repeatsAyah(language, p, candidate.meaning) &&
        !rootInAyah(p, entry.root);
      const rank = [
        !askable,
        candidate.lead !== "",
        isAffixed(p),
        -(counts.get(mine.key) ?? 0),
        -related,
        isLongAyah(p),
        candidate.meaning.length,
        order,
      ];
      return { candidate, askable, rank: rank.map(Number) };
    })
    .sort(byRank)
    .filter((ranked) => ranked.askable)
    .map((ranked) => ranked.candidate);
}

/** Two options that cannot stand together. */
function clash(language, a, b) {
  if (a.entry.root === b.entry.root) return true;
  if (a.keys.some((key) => b.keys.includes(key)) || a.textKey === b.textKey) return true;
  for (const word of a.words) if (b.words.has(word)) return true;
  if (shareStem(a.stems, b.stems)) return true;
  if (a.stems.some((word) => b.stems.some((other) => oneLetterApart(word, other)))) return true;
  if (usesWord(a.words, b.forms) || usesWord(b.words, a.forms)) return true;
  if (language === "ar" && a.cores.some((core) => b.cores.some((other) => sameRadical(core, other)))) return true;
  return nearSynonyms(a.entry, b.entry);
}

/**
 * A wrong option that repeats a word of the asked ayah, comes from a root of the asked ayah or, in Arabic,
 * points to the asked word (a lure).
 */
function unfitFor(language, target, option) {
  if (repeatsAyah(language, target.position, option.meaning)) return true;
  if (rootInAyah(target.position, option.entry.root)) return true;
  return language === "ar" && pointsTo(target.entry, target.position, option.meaning);
}

/** Whether one of four values differs from the other three, which agree: that option would stand out. */
function oddOneOut(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return values.length === 4 && counts.size === 2 && [...counts.values()].includes(1);
}
/**
 * Whether one Arabic option stands out among the four by its marks or its rhyme: alone voweled or alone
 * bare, alone with its final mark ("موعظةٌ" among three -an), for a present verb alone with its opening
 * vowel, or alone not rhyming with the other three ("هَلَاكًا" among "إِجباراً", "مُستَقَرًّا", "تَغْييراً").
 */
const standsOut = (four) =>
  oddOneOut(four.map((option) => option.voweled)) ||
  oddOneOut(four.map((option) => option.final)) ||
  oddOneOut(four.map((option) => option.opening)) ||
  oddOneOut(four.map((option) => option.rhyme));

/**
 * How a mark on an option's word stands to the same mark on the asked word: the same ("copy"), another
 * ("clash"), or nothing to compare when either has none. Case is compared, so "حُجَّةٍ" copies the kasra
 * of سُلْطَٰنٍ and "عطاءً" clashes with it; "العَذابُ" clashes with ٱلْفُلْكَ, which a reader can rule out.
 */
const markRelation = (asked, own, same = (a, b) => a === b) =>
  asked === "" || own === "" ? "" : same(asked, own) ? "copy" : "clash";
const sameCase = (a, b) => CASE_OF[a] === CASE_OF[b];

/**
 * What an Arabic option's first word copies from the asked word, which is the same for all four options:
 * its ending of any length, the letter before that ending ("يَخْفِضُونَ" rhymes with يَغُضُّونَ on ض), its
 * pattern when distinctive ("يُناقِشُ" for يُجَٰدِلُ), and whether its case ending and, for a present verb,
 * its opening vowel copy or clash with the asked word's ("يُبْعِدُونَ" for يُخْرِجُونَ). A meaning that
 * shows no vowel or ending copies nothing.
 */
function copiesFrom(target) {
  const shown = shownAt(target.position);
  const core = bareArabic(longVowels(shown)).replace(/\s+/g, "").slice(affixesAt(target.position).prefix.length);
  const presentVerb = classAt(target.position) === "verb" && tenseOf(tagAt(target.position)) === "present";
  const word = { ...arabicEnd(shown), pattern: arabicPattern(core, presentVerb), opening: "" };
  if (presentVerb) word.opening = vowelOn(shown, affixesAt(target.position).prefix.length);
  return (option) => {
    const first = option.first.replace(AR_MARKS, "").replace(/^(?:[وف]?[بكل]?[اٱ]ل|[وف]?لل|[وف])(?=\S{3})/, "");
    const own = { ...arabicEnd(option.first), pattern: arabicPattern(first) };
    return [
      word.ending !== "" && own.ending === word.ending,
      word.rhyme !== "" && own.rhyme === word.rhyme,
      markRelation(word.final, own.final, sameCase),
      word.pattern.distinctive && own.pattern.pattern === word.pattern.pattern,
      markRelation(word.opening, option.opening),
    ].join();
  };
}

// --- Items --------------------------------------------------------------------------------------------

const items = [];
const shortfalls = [];
const fair = index.lemmas.filter(fairLemma);
/** How many of each language's option texts are used more than once across its groups. */
const repeats = {};

for (const language of LANGUAGES) {
  /** Every option text used so far in this language, by its keys. */
  const usedTexts = new Set();
  const textsOf = (candidate) => [...candidate.keys, candidate.textKey];
  const used = (candidate) => textsOf(candidate).some((text) => usedTexts.has(text));
  /** English stems used so far, preferred against for variety ("exult" in three items). */
  const usedStems = [];
  const stemUsed = (candidate) => shareStem(candidate.stems, usedStems);
  /**
   * The ayat asked so far in this language, and those wrong options came from: one check can ask across
   * groups, so an ayah is asked once, and never offers a wrong option to another item.
   */
  const askedAyat = new Set();
  const optionAyat = new Set();
  const ayahOf = (candidate) => `${candidate.position.surah}:${candidate.position.ayah}`;
  repeats[language] = 0;

  for (let boundary = 1; boundary <= 5; boundary++) {
    const lemmas = fair.filter((entry) => entry.band === boundary - 1);
    // Wrong options: every fair position of the band's lemmas, one per lemma, meaning and form.
    const bySignature = new Map();
    const seen = new Set();
    for (const entry of lemmas) {
      entry.positions[language].forEach((p, order) => {
        if (!fairPosition(language, entry, p)) return;
        const candidate = candidateAt(language, entry, p, order);
        const id = `${entry.key}|${candidate.signature}|${candidate.keys[0]}`;
        if (seen.has(id)) return;
        seen.add(id);
        if (!bySignature.has(candidate.signature)) bySignature.set(candidate.signature, []);
        bySignature.get(candidate.signature).push(candidate);
      });
    }
    const askable = seededShuffle(
      lemmas.map((entry) => ({ entry, options: askedCandidates(entry, language) })).filter((a) => a.options.length > 0),
      mulberry32(streamSeed(SEED, boundary, language)),
    );

    /**
     * Every item a lemma can give, best first: its targets in rank order, and for each the triples of wrong
     * options that stand together, in the options' order, at most ITEM_CHOICES in all. The options are
     * those that fit the asked word whatever else the group holds; the search below checks the rest.
     */
    const itemsFor = (ask, spare) => {
      const items = [];
      for (const target of ask.options) {
        if (items.length >= ITEM_CHOICES) break;
        if (!ask.reuse && (used(target) || stemUsed(target))) continue;
        if (askedAyat.has(ayahOf(target)) || optionAyat.has(ayahOf(target))) continue;
        const inAyah = ayahLemmas.get(`${target.position.surah}:${target.position.ayah}`) ?? new Set();
        const copies = language === "ar" ? copiesFrom(target) : () => "";
        const answerCopies = copies(target);
        const draw = mulberry32(streamSeed(SEED, boundary, language, "distractors", ask.entry.key, target.order));
        // The same form as the asked word, from no lemma of the asked ayah.
        const options = seededShuffle(
          (bySignature.get(target.signature) ?? []).filter(
            (candidate) =>
              candidate.entry.key !== ask.entry.key &&
              !inAyah.has(candidate.entry.key) &&
              !lengthsApart(candidate.letters, target.letters) &&
              copies(candidate) === answerCopies &&
              !askedAyat.has(ayahOf(candidate)) &&
              ayahOf(candidate) !== ayahOf(target) &&
              !unfitFor(language, target, candidate),
          ),
          draw,
        )
          .map((candidate, order) => ({
            candidate,
            rank: [
              used(candidate),
              stemUsed(candidate),
              !spare.has(candidate.entry.key),
              Math.abs(candidate.letters - target.letters),
              order,
            ].map(Number),
          }))
          .sort(byRank)
          .map(({ candidate }) => candidate);
        const fits = (chosen, option) => {
          if (chosen.some((other) => other.entry.key === option.entry.key)) return false;
          const four = [target, ...chosen, option];
          if (four.some((a, i) => four.some((b, j) => i < j && lengthsApart(a.letters, b.letters)))) return false;
          if (four.length === 4 && standsOut(four)) return false;
          return !clash(language, target, option) && !chosen.some((other) => clash(language, other, option));
        };
        const walk = (chosen, from) => {
          for (let i = from; i < options.length && items.length < ITEM_CHOICES; i++) {
            if (!fits(chosen, options[i])) continue;
            if (chosen.length === 2) items.push({ key: ask.entry.key, target, chosen: [...chosen, options[i]] });
            else walk([...chosen, options[i]], i + 1);
          }
        };
        walk([], 0);
      }
      return items;
    };

    // A lemma that gives no item on its own is "spare": wrong options come from spare lemmas first, so that
    // a scarce band keeps its askable lemmas for questions.
    const spare = new Set(lemmas.map((entry) => entry.key));
    for (const ask of askable) if (itemsFor({ ...ask, reuse: true }, new Set()).length > 0) spare.delete(ask.entry.key);
    // Each lemma in the shuffled order with its items at texts not used yet in the language; a text already
    // used is asked only when no group of unused texts fills.
    const fresh = askable.map((ask) => itemsFor({ ...ask, reuse: false }, spare)).filter((items) => items.length > 0);
    /** Whether an item can join the items picked: no lemma, text or ayah twice in the group. */
    const joins = (state, item) => {
      const options = item.chosen;
      if (state.lemmas.has(item.key) || options.some((option) => state.lemmas.has(option.entry.key))) return false;
      if (state.ayat.has(ayahOf(item.target)) || options.some((option) => state.asked.has(ayahOf(option))))
        return false;
      return ![item.target, ...options].some((option) => textsOf(option).some((text) => state.texts.has(text)));
    };
    const join = (state, item) => ({
      lemmas: new Set([...state.lemmas, item.key, ...item.chosen.map((option) => option.entry.key)]),
      ayat: new Set([...state.ayat, ayahOf(item.target), ...item.chosen.map(ayahOf)]),
      asked: new Set([...state.asked, ayahOf(item.target)]),
      texts: new Set([...state.texts, ...[item.target, ...item.chosen].flatMap(textsOf)]),
    });
    // A depth-first search over the lemmas in order, each asked at its first item that joins or skipped:
    // its first full group is what a greedy pass would build when one fills, and when none does it finds
    // the largest group within SEARCH_BUDGET steps, since one item's wrong options can be lemmas others need.
    let group = [];
    const pack = (choices) => {
      let steps = 0;
      const search = (index, state, picked) => {
        if (picked.length > group.length) group = picked;
        if (picked.length === ITEMS_PER_GROUP) return true;
        if (++steps > SEARCH_BUDGET || picked.length + choices.length - index <= group.length) return false;
        // The lemmas left that could still join: the group cannot grow past them.
        const open = choices.slice(index).filter((items) => items.some((item) => joins(state, item))).length;
        if (picked.length + open <= group.length) return false;
        for (const item of choices[index])
          if (joins(state, item) && search(index + 1, join(state, item), [...picked, item])) return true;
        return search(index + 1, state, picked);
      };
      search(0, { lemmas: new Set(), ayat: new Set(), asked: new Set(), texts: new Set() }, []);
      return steps <= SEARCH_BUDGET;
    };
    let complete = pack(fresh);
    if (group.length < ITEMS_PER_GROUP)
      complete = pack(
        askable.map((ask) => itemsFor({ ...ask, reuse: true }, spare)).filter((items) => items.length > 0),
      );
    for (const { target, chosen } of group) {
      askedAyat.add(ayahOf(target));
      for (const option of [target, ...chosen]) {
        if (used(option)) repeats[language] += 1;
        for (const text of textsOf(option)) usedTexts.add(text);
        usedStems.push(...option.stems);
      }
      for (const option of chosen) optionAyat.add(ayahOf(option));
      items.push({ boundary, language, word: target.position, distractors: chosen.map((option) => option.position) });
    }
    if (group.length < ITEMS_PER_GROUP) {
      shortfalls.push({ boundary, language, items: group.length, askable: askable.length, complete });
    }
  }
}
items.sort((a, b) => a.boundary - b.boundary || LANGUAGES.indexOf(a.language) - LANGUAGES.indexOf(b.language));

// --- Output -------------------------------------------------------------------------------------------

const hash = bankHash(items);
const at = (p) => `{ surah: ${p.surah}, ayah: ${p.ayah}, pos: ${p.pos} }`;
const body = items
  .map(
    (item) =>
      `{ boundary: ${item.boundary}, language: "${item.language}", word: ${at(item.word)}, ` +
      `distractors: [${item.distractors.map(at).join(", ")}] },`,
  )
  .join("\n");

const source = `// Generated by scripts/build-meanings-check-bank.mjs (seed ${SEED}, content hash ${hash}). Do not edit by hand.
import type { MeaningLanguage, WordPosition } from "@/lib/meanings/lemma-index";

/**
 * The item bank for "Check my level" (SPEC 3.6). Each item is a word position plus three positions
 * whose meanings are the wrong options, all word-table positions. The boundary is the level the item
 * tests: a learner at that level or above knows its word, whose band is boundary - 1.
 *
 * Generated by scripts/build-meanings-check-bank.mjs. Do not edit by hand; the owner reviews the bank
 * before the branch merges. Until it is generated the bank is empty, and the check is not offered.
 */
export type CheckItem = Readonly<{
  /** 1 to 5: the level boundary the item tests; its word is in band boundary - 1. */
  boundary: 1 | 2 | 3 | 4 | 5;
  language: MeaningLanguage;
  /** The word asked about, shown highlighted in its ayah. */
  word: WordPosition;
  /** Three positions whose meanings are the wrong options. */
  distractors: readonly [WordPosition, WordPosition, WordPosition];
}>;

export const CHECK_BANK: readonly CheckItem[] = [
${body}
];
`;

const prettier = await import("prettier");
const config = (await prettier.resolveConfig(OUT_PATH)) ?? {};
writeFileSync(OUT_PATH, await prettier.format(source, { ...config, filepath: OUT_PATH }));

const counts = {};
for (const item of items)
  counts[`${item.boundary}${item.language}`] = (counts[`${item.boundary}${item.language}`] ?? 0) + 1;
console.log(JSON.stringify({ seed: SEED, hash, items: items.length, counts, shortfalls, repeats }));
