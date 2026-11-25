import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CHECK_BANK, type CheckItem } from "@/lib/meanings/check-bank";
import {
  loadLemmaIndex,
  positionKey,
  sameWord,
  type LemmaEntry,
  type LemmaIndex,
  type MeaningLanguage,
  type WordPosition,
} from "@/lib/meanings/lemma-index";
import { mushafWordTexts } from "@/lib/mushaf/glyph-words";
import { fetchWordMeaningAr, fetchWordTranslation } from "@/lib/word/queries";
import { openOutboxDatabase, type OutboxDatabase } from "@/tests/jest/outbox-sqlite";

/**
 * The "Check my level" item bank (SPEC 3.6), item by item against the bundled word tables, with the
 * meanings read the way the app reads them. A reader who does not know the asked word should pick the
 * right meaning one time in four, so besides the spec's rules the test checks the builder's fairness rules
 * (scripts/build-meanings-check-bank.mjs explains each): no option that stands out by its form or copies
 * the asked word or stands out among the four by its marks or rhyme, no meaning that gives the word away,
 * names a person, is a note on its ayah or points at its ayah's persons, no option repeating a word or a
 * root of the asked ayah, no two options from one root, of one stem or of nearly one meaning, the asked
 * word's usual and plain sense, no option text offered twice in a group or a language, and no ayah asked
 * twice or both asked and offered in a language. The rules are restated here rather than imported, so that
 * the bank file is checked on its own.
 */
const BANK_FILE = path.resolve(__dirname, "../../lib/meanings/check-bank.ts");
const LANGUAGES = ["ar", "en"] as const;

let store: OutboxDatabase;
let index: LemmaIndex;
/** Every eligible position per meaning language, from the index's lemmas. */
const eligible: Record<MeaningLanguage, Set<string>> = { ar: new Set(), en: new Set() };
/** The lemma keys at each "surah:ayah", and the roots there by position. */
const ayahLemmas = new Map<string, Set<string>>();
const ayahRoots = new Map<string, { pos: number; root: string }[]>();
/** The bundled tables by position, read once. */
const glosses = new Map<string, string>();
const arabicMeanings = new Map<string, string>();
const tags = new Map<string, string>();
const stems = new Map<string, string>();
const ayat = new Map<string, { uthmani: string; qcf2: string }>();

beforeAll(async () => {
  store = await openOutboxDatabase();
  store.sql.exec(`ATTACH DATABASE '${path.resolve(__dirname, "../../assets/data/quran.db")}' AS bundled`);
  for (const table of ["word_roots", "word_irab", "word_meanings_ar", "word_translations", "quran_text"]) {
    store.sql.exec(`DELETE FROM main.${table}`);
    store.sql.exec(`INSERT INTO main.${table} SELECT * FROM bundled.${table}`);
  }
  index = await loadLemmaIndex(store.db);
  for (const entry of index.lemmas) {
    for (const language of LANGUAGES) for (const p of entry.positions[language]) eligible[language].add(at(p));
  }
  for (const [key, entry] of index.lemmaAt) {
    const [surah, ayahNumber, pos] = key.split(":");
    const ayah = `${surah}:${ayahNumber}`;
    if (!ayahLemmas.has(ayah)) ayahLemmas.set(ayah, new Set());
    ayahLemmas.get(ayah)!.add(entry.key);
    if (!ayahRoots.has(ayah)) ayahRoots.set(ayah, []);
    if (entry.root) ayahRoots.get(ayah)!.push({ pos: Number(pos), root: entry.root });
  }
  type Row = { surah: number; ayah: number; word_pos: number; value: string | null };
  const load = (target: Map<string, string>, source: string) => {
    for (const row of store.sql.prepare(source).all() as Row[])
      target.set(positionKey(row.surah, row.ayah, row.word_pos), row.value ?? "");
  };
  load(glosses, "SELECT surah, ayah, word_pos, translation_en AS value FROM main.word_translations");
  load(arabicMeanings, "SELECT surah, ayah, word_pos, meaning AS value FROM main.word_meanings_ar");
  load(tags, "SELECT surah, ayah, word_pos, morphological_tag AS value FROM main.word_irab");
  load(stems, "SELECT surah, ayah, word_pos, word_text AS value FROM main.word_roots");
  const rows = store.sql.prepare("SELECT surah, ayah, text_uthmani, text_qcf2 FROM main.quran_text").all() as {
    surah: number;
    ayah: number;
    text_uthmani: string;
    text_qcf2: string;
  }[];
  for (const row of rows) ayat.set(`${row.surah}:${row.ayah}`, { uthmani: row.text_uthmani, qcf2: row.text_qcf2 });
}, 60_000);

afterAll(async () => {
  await store.close();
});

const at = (p: WordPosition) => positionKey(p.surah, p.ayah, p.pos);
const wordList = (text: string) => new Set(text.split(/\s+/).filter(Boolean));

// --- Text -----------------------------------------------------------------------------------------------

const MARKS = new RegExp("[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640\\u200B-\\u200F]", "g");

/** Marks removed, and alef forms, hamza seats, ى and ة written one way, as the builder compares meanings. */
function bare(text: string): string {
  return text
    .replace(MARKS, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

/** Both readings of "after removing parentheses", without case, Arabic marks or spelling variants. */
function meaningKeys(meaning: string): string[] {
  const plain = bare(meaning).toLowerCase();
  const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
  return [tidy(plain.replace(/\([^)]*\)/g, " ")), tidy(plain.replace(/[()]/g, " "))];
}

const FUNCTION_WORDS = wordList(`a an the and or nor but so then thus yet if as than that this these those there here
  what which who whom whose when where why how whether while until till since because though although unless lest
  of to in on at by for with from into onto upon over under about above below between among against without within
  through during before after behind beside besides near toward towards except like unlike beyond around up down
  out off away i me my mine we us our ours you your yours he him his she her hers it its they them their theirs
  myself yourself himself herself itself ourselves yourselves themselves one ones none anyone anything someone
  something everyone everything nothing no not never ever indeed surely verily certainly truly rather nay yes all
  every each some any both either neither other others another more most much many few less least very only also
  even just too again still now already is are was were be been being am will would shall should can could may
  might must do does did done has have had having let lo o oh behold`);
const AR_STOP = new Set(
  [
    ...wordList(`الذي التي الذين اللاتي هو هي هم هما أنتم نحن ما من في على إلى عن أو ثم كل غير بعد قبل ذلك تلك هذا هذه
    هؤلاء الله المراد أي أن لا لم لن قد مع بين عند حتى إذا كان يكون شيء أمر بها به لها له لهم منه منها عليه عليها ونحوه`),
  ].map(bare),
);

const englishWords = (gloss: string) =>
  gloss
    .toLowerCase()
    .replace(/[()[\]]/g, " ")
    .split(/[^a-z'-]+/)
    .filter(Boolean);
const stem = (word: string) =>
  word
    .replace(/'s$/, "")
    .replace(/ies$/, "y")
    .replace(/(?<=\w{3})s$/, "")
    .replace(/(?<=\w{3})ll$/, "l");
/** An Arabic word without its article or a leading و, read before alef forms are unified so that أل stays. */
const arabicCore = (word: string) => bare(word.replace(/^(?:[وفبك]?[اٱ]ل|لل|و)(?=\S{3})/, ""));
/** English words for the looser comparisons: hyphenated words apart, each by stem() and without a final e. */
const looseStems = (gloss: string) =>
  englishWords(gloss)
    .flatMap((word) => word.split("-"))
    .filter((word) => word && !FUNCTION_WORDS.has(word))
    .map((word) => stem(word).replace(/(?<=\w{4})e$/, ""));
/** Two English words of one stem: the same, or one of four letters or more beginning the other ("punish"). */
const sameStem = (a: string, b: string) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short === long || (short.length >= 4 && long.startsWith(short));
};
const shareStem = (a: string[], b: string[]) => a.some((word) => b.some((other) => sameStem(word, other)));
/** Two English words of three letters or more one letter apart ("son", "sun", "sin"). */
function oneLetterApart(a: string, b: string): boolean {
  if (a === b || Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}

/** The words of a meaning that carry its sense: no function words, Arabic without ال or a leading و. */
function contentWords(language: MeaningLanguage, meaning: string): string[] {
  if (language === "en")
    return englishWords(meaning)
      .filter((word) => !FUNCTION_WORDS.has(word))
      .map(stem);
  return meaning
    .replace(MARKS, "")
    .split(/[^ء-يٱ]+/)
    .filter((word) => word && !AR_STOP.has(bare(word)))
    .map(arabicCore)
    .filter((word) => word.length >= 3 && !AR_STOP.has(word));
}

/** Persons, beings, scriptures and places an Arabic meaning may not name, since such a meaning fits one ayah. */
const AR_NAMES = new Set(
  [
    ...wordList(`محمد أحمد النبي الرسول عيسى المسيح موسى إبراهيم مريم يوسف نوح هارون داود سليمان فرعون إبليس لوط يعقوب
    إسرائيل يونس زكريا يحيى إسحاق إسماعيل آدم شعيب إدريس أيوب لقمان قارون هامان جالوت طالوت عزير جبريل ميكال ميكائيل
    القرآن قرآن التوراة الإنجيل الزبور مكة بكة مصر يثرب الكعبة سيناء بابل جهنم الجنة الجحيم الفردوس سقر اليهود النصارى
    الملكة إسرافيل`),
  ].map(bare),
);
/** Phrases that make a meaning a note on its ayah or word: المراد, أي, يعني, بمعنى, كناية, قيل, جمع, ؛ and the like. */
const AR_NOTE = new RegExp(
  [
    "عليه السلام|عليهما السلام|عليهم السلام|الصلاه والسلام|ملايك|اهل النار|اصحاب النار",
    "مراد|يراد|المقصود|كنايه|يعني|بمعني|يطلق|تطلق|في الايه|من اسماء|مفرد|؛",
    "(^|[^ء-ي])(و?قيل|اي|هنا|جمع)([^ء-ي]|$)",
    "(^|[^ء-ي])[وفبك]?ا?لله([^ء-ي]|$)",
  ].join("|"),
);
function namesOrExplains(meaning: string): boolean {
  const text = bare(meaning);
  if (AR_NOTE.test(text)) return true;
  return text.split(/[^ء-ي]+/).some((word) => AR_NAMES.has(word) || AR_NAMES.has(word.replace(/^[وفبلك]/, "")));
}
/** An English gloss with a typing slip or a quotation: a comma without a space, a bracket, quotes or a stop. */
const EN_MALFORMED = /\[|,(?=\S)|[.;:!?"]|(^|[^A-Za-z])'|'(?![A-Za-z])/;
/**
 * An Arabic meaning with a colon, quotes, a backslash, a space before a comma, a comma or stop at its end,
 * two spaces in a row ("اختاروا  وقَبِلوا"), a tatweel ("مُـترقّـبا") or two tanween on one word.
 */
const AR_MALFORMED = /[:"\\\u0640]|\s[،,]|[،,.;]\s*$|\s\s|[\u064B-\u064D]\S*[\u064B-\u064D]/;
/**
 * A pronoun for the persons of a meaning's own ayah: a particle with a first or second person or a third
 * person plural or dual ("لنا", "بك", "لي", "لهم", "بهما"), "أنا", "نحن", "أنت", or a longer word ending in
 * كم or هم ("لأبدانكم"). Such a meaning fits its ayah only, unless the word carries a pronoun itself.
 */
const TIED_PRONOUN =
  /^(?:[وف]?(?:(?:ل|ب|من|عن|في|علي|الي|مع|عند|لدي|ان|لان|كان)(?:ك|كم|كما|كن|نا|هم|هما|هن)|منا|عنا|لي|بي|مني|عني|معي|عندي)|انا|نحن|انت|انتم|انتما|انتن)$/;
const tiesToAyah = (meaning: string) =>
  // Hamza stays, so that "بِنَاءً" does not read as "بنا"; a longer word counts only كم and هم, since a
  // noun ends in -hma or -kma ("فَهْمًا", "حُكْمًا").
  meaning
    .replace(MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .split(/[^ء-ي]+/)
    .some((word) => TIED_PRONOUN.test(word) || (word.length >= 5 && !word.startsWith("ال") && /(كم|هم)$/.test(word)));

// --- English form ---------------------------------------------------------------------------------------

const LEAD_WORDS = wordList(`and so then but or nor while o a an any every no not the of to in on at by for with from
  into upon over about against like as than that those who whom which my our your his her its their i we you he she it
  they will shall would should can could may might must is are was were be been being am has have had do does did`);
const OBJECT_WORDS = wordList("me us you him her it them");
const ALWAYS_CAPITAL = wordList("I He Him His We Us Our Me My");

/**
 * An English gloss's lead and the rest: leading joiners, articles, prepositions, pronouns and auxiliaries,
 * the text in parentheses, "surely", an object pronoun at the end, and "Aa" for a capital other than on a
 * pronoun. A pronoun keeps its capital: "We" (Allah) and "we" (people) read differently.
 */
function englishLead(gloss: string): { lead: string; rest: string } {
  const words = gloss.trim().split(/\s+/);
  const lead: string[] = [];
  let start = 0;
  for (; start < words.length - 1; start++) {
    if (/^\(.*\)$/.test(words[start])) continue;
    const letters = words[start].replace(/[^A-Za-z]/g, "");
    const lower = letters.toLowerCase();
    if (!LEAD_WORDS.has(lower)) break;
    lead.push(lower === "an" ? "a" : ALWAYS_CAPITAL.has(letters) ? letters : lower);
  }
  lead.push(...(gloss.toLowerCase().match(/\([^)]*\)/g) ?? []));
  if (/\b(surely|indeed|verily|certainly)\b/i.test(gloss)) lead.push("surely");
  const tail = words.slice(Math.max(start + 1, words.length - 2)).map((word) => word.toLowerCase());
  if (tail.some((word) => OBJECT_WORDS.has(word))) lead.push("~obj");
  if (gloss.split(/[^A-Za-z]+/).some((word) => /^[A-Z]/.test(word) && !ALWAYS_CAPITAL.has(word))) lead.push("Aa");
  const rest = words
    .slice(start)
    .join(" ")
    .replace(/\([^)]*\)/g, " ");
  return { lead: lead.join(" "), rest: rest.trim() || gloss };
}

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
const ADJECTIVE_ENDING = /(ful|ous|less|ible|able|ical|[^m]ant|[^m]ent)$/;
const NOT_ADJECTIVE = wordList(`table cable fable parable vegetable stable bible bless unless servant servants covenant
  parent descendant inhabitant merchant tenant giant elephant agent client talent event student president resident
  accident incident torrent current serpent continent opponent recipient ingredient instant infant plant grant want
  rent tent scent dent vent consent assent content intent extent percent garment tyrant tyrants migrant emigrant
  occupant claimant applicant assistant attendant defendant informant peasant warrant chant enchant implant recant
  supplant slant invent prevent repent relent resent represent dissent descent ascent accent advent cent component
  element adherent proponent`);

/** One English word's visible form: number, comparative, function word, adjective, past, -ing, -ly, -s or base. */
function englishWordForm(word: string): string {
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
const englishPlural = (gloss: string) => englishWordForm(englishLead(gloss).rest.split(/\s+/).at(-1) ?? "") === "s";

// --- Arabic form, roots and cores -------------------------------------------------------------------------

/** A word's prefixes as units: one-letter particles and the article, which after ل is written "ل". */
function prefixUnits(prefix: string): string[] {
  const units: string[] = [];
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
 * An Arabic meaning's lead: the word's prefixes that the meaning's first word repeats, the article, a ب ل ك
 * of the meaning's own before the article or a hamza ("بإخلاص"), and a function word first ("ما", "لا").
 */
function arabicLead(prefix: string, meaning: string): { lead: string; rest: string } {
  let rest = meaning.replace(MARKS, "").trim();
  // A letter under shadda counts twice in the three-letter test, so that the ل of "لَشَكَّ" is a prefix.
  let doubled = meaning
    .replace(/(\S)[\u064B-\u0650\u0652]*\u0651/g, "$1$1")
    .replace(MARKS, "")
    .trim();
  const startsWith = (unit: string) => (unit === "ا" ? /^[اأإآٱ]/.test(rest) : rest.startsWith(unit));
  const lead: string[] = [];
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
  if (!lead.includes("ال") && /^[اٱ]ل\S{2}/.test(rest) && !AR_STOP.has(bare(rest.split(/\s+/)[0]))) {
    lead.push("ال");
    rest = rest.slice(2);
  }
  const first = rest.split(/\s+/)[0] ?? "";
  if (AR_STOP.has(bare(first))) lead.push(`~${bare(first)}`);
  return { lead: lead.join("+"), rest };
}

/** Endings an Arabic word can show, longest first; ة stays apart from the pronoun ه. */
const AR_ENDINGS = ["تموه", "تموها", "تموني", "تما", "هما", "كما", "ونا", "وني", "ون", "ين", "ات", "ان", "وا", "نا"]
  .concat(["تم", "تن", "ني", "ها", "هم", "هن", "كم", "ة", "ه", "ك", "ت", "ي", "ا"])
  .sort((a, b) => b.length - a.length);

const QURAN_MARKS = /[\u06D6-\u06ED]/g;
const TANWEEN: Record<string, string> = { "\u064B": "an", "\u064C": "un", "\u064D": "in" };
const tanweenOf = (text: string) => [...new Set(text.match(/[\u064B-\u064D]/g) ?? [])].map((mark) => TANWEEN[mark]);
/** The case a final mark shows: fatha and -an, damma and -un, kasra and -in, or a sukun. */
const CASE_OF: Record<string, string> = {
  an: "a",
  un: "u",
  in: "i",
  "\u064E": "a",
  "\u064F": "u",
  "\u0650": "i",
  "\u0652": "o",
};

/**
 * An Arabic word's ending, the letter it rhymes on (before an ending of two letters or more, a ة or the
 * alef of -an), and its final mark: tanween by type, else the final short vowel or sukun.
 */
function arabicEnd(word: string): { ending: string; final: string; rhyme: string } {
  const text = word.replace(QURAN_MARKS, "").replace(/[^\u0621-\u0652\u0670\u0671]/g, "");
  const letters = text
    .replace(MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي");
  const ending = AR_ENDINGS.find((end) => letters.length > end.length + 1 && letters.endsWith(end)) ?? "";
  const final = tanweenOf(text)[0] ?? /[\u064E-\u0652](?=\u0651?$)/.exec(text)?.[0] ?? "";
  const body = ending.length >= 2 ? letters.slice(0, -ending.length) : letters.replace(/(?<=\S{2})[ةا]$/, "");
  return { ending, final, rhyme: body.at(-1) ?? "" };
}

/** Whether an Arabic text shows a fatha, damma, kasra or sukun inside a word, not only on its last letter. */
const voweled = (text: string) =>
  text
    .replace(QURAN_MARKS, "")
    .split(/\s+/)
    .some((word) => /[\u064E-\u0650\u0652]/.test(word.replace(/[\u064B-\u0652]*[اى]?[\u064B-\u0652]*$/, "")));
/** The vowel on a word's first letter after a joiner: a present verb's form, يُفْعِلُ against يَفْعُلُ. */
function openingMark(word: string): string {
  const text = word.replace(QURAN_MARKS, "").replace(/^[وف][\u064B-\u0652]*(?=\S{3})/, "");
  return /^[\u0621-\u064A]\u0651?([\u064E-\u0650\u0652])/.exec(text)?.[1] ?? "";
}
/** The vowel on a word's letter at this index, counting letters as bare() keeps them. */
function vowelOn(word: string, index: number): string {
  const units = word.replace(/[\u0670\u06D6-\u06ED]/g, "").match(/[\u0621-\u064A\u0671][\u064B-\u0652]*/g) ?? [];
  return /[\u064E-\u0650\u0652]/.exec(units[index] ?? "")?.[0] ?? "";
}

/** An Arabic meaning's first word that is not a function word, and its shape: word count, ending of two letters or more, tanween. */
function arabicShape(meaning: string): { first: string; shape: string } {
  const words = meaning.trim().split(/\s+/);
  const first = words.find((word) => !AR_STOP.has(bare(word))) ?? words[0];
  const { ending } = arabicEnd(first);
  const tanween = /[ً-ٍ]/.test(meaning);
  return { first, shape: [words.length, ending.length >= 2 ? ending : "", tanween].join(":") };
}

const WEAK = "اوي";
/**
 * A pattern for the words that spell out a root: two strong letters with at most one letter between, a
 * weak letter or hamza at the root's start or end written as ا و ي (or ت where it assimilates), one in the
 * middle that may vanish, and a doubled root that may end a word with one letter ("ظل" for ظلل).
 */
function rootPattern(root: string): RegExp | null {
  const letters = [
    ...root
      .replace(MARKS, "")
      .replace(/[أإآءؤئٱ]/g, "ا")
      .replace(/ى/g, "ي"),
  ];
  if (letters.length < 3) return null;
  // A root of weak letters only (أوي, أيي) is matched as a whole word: "آوى", "مأواهم", "آية", "بآيات".
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
      source += i === 0 ? "[اويت]" : i === letters.length - 1 ? "[اوي]" : "[اوي]?";
    } else {
      if (i > 0 && !WEAK.includes(letters[i - 1])) source += ".?";
      source += letter;
    }
  });
  return new RegExp(source);
}
function spellsRoot(root: string, text: string): boolean {
  const pattern = rootPattern(root);
  if (!pattern) return false;
  return text
    .replace(MARKS, "")
    .split(/[^ء-يٱ]+/)
    .filter((word) => word && !AR_STOP.has(bare(word)))
    .some((word) => pattern.test(bare(word)) || pattern.test(arabicCore(word)));
}

const CORE_SUFFIXES = ["تموه", "تما", "هما", "كما", "ون", "ين", "ات", "ان", "وا", "نا", "تم", "تن", "ني", "ها", "هم"]
  .concat(["هن", "كم", "ه", "ك", "ت", "ي", "ا"])
  .map(bare);
type Core = { core: string; radical: string; whole?: string };
/**
 * A word's core without article, joiner, ة or ending and person letter, and its radical without ا و ي or
 * doubles; the whole radical keeps the ending, for a broken plural ("أعوان" and "معين" both read عن).
 */
function arabicCoreForms(word: string): Core {
  const plain = word.replace(MARKS, "").replace(/^(?:[وف]?[بكل]?[اٱ]ل|[وف]?لل)(?=\S{2})/, "");
  let core = bare(plain.replace(/(?<=\S{2})ة$/, ""));
  core = core.replace(/^[وف](?=\S{3})/, "");
  const whole = core.length >= 4 ? core.replace(/^[يتنام]/, "") : core;
  const suffix = CORE_SUFFIXES.find((ending) => core.length - ending.length >= 3 && core.endsWith(ending));
  if (suffix) core = core.slice(0, -suffix.length);
  if (core.length >= 4) core = core.replace(/^[يتنام]/, "");
  const radicalOf = (text: string) => text.replace(/[اوي]/g, "").replace(/(.)\1+/g, "$1");
  return { core, radical: radicalOf(core), whole: radicalOf(whole) };
}
const arabicCores = (text: string): Core[] =>
  text
    .replace(MARKS, "")
    .split(/[^ء-يٱ]+/)
    .filter((word) => word && !AR_STOP.has(bare(word)))
    .map(arabicCoreForms);
const sameCore = (a: Core, b: Core) => a.core === b.core || (a.radical.length >= 3 && a.radical === b.radical);
const sameRadical = (a: Core, b: Core) =>
  [a.radical, a.whole ?? ""].some((radical) => radical.length >= 2 && (radical === b.radical || radical === b.whole));

const longVowels = (word: string) => word.replace(/ٰ/g, "ا").replace(/ۥ/g, "و").replace(/ۦ/g, "ي");
/** A word's pattern without its ending; distinctive with an ا و ي inside or a form letter (م, ا) first. */
function arabicPattern(word: string, presentVerb = false): { pattern: string; distinctive: boolean } {
  let letters = bare(longVowels(word));
  const ending = AR_ENDINGS.find(
    (end) => end.length >= 2 && letters.length - end.length >= 3 && letters.endsWith(bare(end)),
  );
  if (ending) letters = letters.slice(0, -bare(ending).length);
  const shape = [...letters].map((letter, i) =>
    i === 0 ? ("يتنما".includes(letter) ? letter : "C") : WEAK.includes(letter) ? letter : "C",
  );
  const inside = shape.slice(1, -1).some((letter) => WEAK.includes(letter));
  const formLetter = !presentVerb && "ما".includes(shape[0]);
  return { pattern: shape.join(""), distinctive: shape.length >= 4 && (inside || formLetter) };
}

// --- Words in their ayat ----------------------------------------------------------------------------------

const keyOf = at;
const glossAt = (p: WordPosition) => glosses.get(keyOf(p))?.trim() ?? "";
const meaningAt = (language: MeaningLanguage, p: WordPosition) =>
  language === "en" ? glossAt(p) : (arabicMeanings.get(keyOf(p))?.trim() ?? "");
const tagAt = (p: WordPosition) => tags.get(keyOf(p)) ?? "";

const shownWords = new Map<string, string[]>();
/** The Uthmani words a card highlights in an ayah, as Qcf2AyahText maps them. */
function ayahWords(p: WordPosition): string[] {
  const key = `${p.surah}:${p.ayah}`;
  if (!shownWords.has(key)) {
    const row = ayat.get(key);
    shownWords.set(key, row ? mushafWordTexts(p.surah, p.ayah, row.uthmani, row.qcf2) : []);
  }
  return shownWords.get(key)!;
}
const highlightedWord = (p: WordPosition) => ayahWords(p)[p.pos - 1] ?? "";

/** The highlighted word around its `word_roots` stem, without marks, or null when the stem is not in it. */
function affixesAt(p: WordPosition): { prefix: string; stem: string; suffix: string } | null {
  const word = bare(highlightedWord(p)).replace(/\s+/g, "");
  const stemText = bare(stems.get(keyOf(p)) ?? "");
  const start = stemText ? word.indexOf(stemText) : -1;
  return start < 0
    ? null
    : { prefix: word.slice(0, start), stem: stemText, suffix: word.slice(start + stemText.length) };
}

function wordClass(tag: string): string {
  const parts = tag.split("|");
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
const tenseOf = (tag: string) =>
  tag.split("|").some((part) => /^CV/.test(part))
    ? "command"
    : tag.split("|").some((part) => /^IV/.test(part))
      ? "present"
      : "past";
/**
 * Whether a verb is spelled in the passive, whatever its tag says (27:68 وُعِدْنَا, 65:7 قُدِرَ are tagged
 * active). In the past: a damma on the first letter and a kasra on the second or third (فُعِلَ, فُعِّلَ,
 * أُفْعِلَ), a damma and a doubled last letter (سُرَّ), or a kasra and ي (قِيلَ). In the present: a damma
 * on the person letter and a fatha or ا before the stem's last letter (يُفْعَلُ, يُضَٰعَفُ, يُزادُ), where an
 * active verb has a kasra (يُفْعِلُ, يُضَٰعِفُ). A joiner may come first.
 */
function spelledPassive(tense: string, word: string): boolean {
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

/** What the Arabic word shows besides its meaning: class, tense, voice, person, ending, number, gender, mood. */
function wordShapeAt(p: WordPosition): string {
  const tag = tagAt(p);
  const cls = wordClass(tag);
  const affixes = affixesAt(p) ?? { prefix: "", stem: "", suffix: "" };
  const shown = highlightedWord(p);
  const tense = cls === "verb" ? tenseOf(tag) : "";
  const passive = /(^|\|)(PV|IV|CV)_PASS(\||$)/.test(tag) || cls === "passive" || spelledPassive(tense, shown);
  const voice = passive ? "passive" : "active";
  if (cls === "verb") {
    const person = tense === "present" ? affixes.stem[0] : "";
    const feminine = /SUFF_FEM_TA|SUBJ:3FS/.test(tag) ? "f" : "";
    return [cls, tense, voice, person, affixes.suffix, feminine, arabicEnd(shown).final].join(":");
  }
  const number = /_DU/.test(tag)
    ? "dual"
    : /_PL|SUBJ:\dMP|SUBJ:\dFP/.test(tag) || englishPlural(glossAt(p))
      ? "plural"
      : "singular";
  const agrees = cls === "adjective" || cls === "active" || cls === "passive";
  const feminine = agrees && (/FEM/.test(tag) || /ة$/.test(shown.replace(/[^ء-ي]/g, ""))) ? "f" : "";
  return [cls, voice, number, affixes.suffix, feminine].join(":");
}

type Form = { lead: string; shape: string; first: string; opening: string };
/**
 * An option's lead and shape as the builder compares them, all four options of an item agreeing, and an
 * Arabic option's first word and, for a present verb, its opening vowel.
 */
function formAt(language: MeaningLanguage, p: WordPosition): Form {
  const word = wordShapeAt(p);
  if (language === "en") {
    const { lead, rest } = englishLead(glossAt(p));
    return { lead, shape: `${word}|${rest.split(/\s+/).map(englishWordForm).join(" ")}`, first: "", opening: "" };
  }
  const meaning = meaningAt("ar", p);
  const { lead } = arabicLead(affixesAt(p)?.prefix ?? "", meaning);
  const { first, shape } = arabicShape(meaning);
  const tense = wordClass(tagAt(p)) === "verb" ? tenseOf(tagAt(p)) : "";
  const spelled = spelledPassive(tense, first) ? "passive" : "";
  return { lead, shape: `${word}|${shape}:${spelled}`, first, opening: tense === "present" ? openingMark(first) : "" };
}

/** How an option's mark stands to the asked word's: the same, another ("clash"), or none to compare. */
const markRelation = (asked: string, own: string, same = (a: string, b: string) => a === b) =>
  asked === "" || own === "" ? "" : same(asked, own) ? "copy" : "clash";
const sameCase = (a: string, b: string) => CASE_OF[a] === CASE_OF[b];

/**
 * What an Arabic option's first word copies from the asked word, the same for all four: its ending, the
 * letter it rhymes on, its distinctive pattern, and whether its case (tanween by type) and, for a present
 * verb, its opening vowel copy or clash with the asked word's.
 */
function copiesFrom(asked: WordPosition): (form: Form) => string {
  const shown = highlightedWord(asked);
  const prefix = affixesAt(asked)?.prefix.length ?? 0;
  const core = bare(longVowels(shown)).replace(/\s+/g, "").slice(prefix);
  const presentVerb = wordClass(tagAt(asked)) === "verb" && tenseOf(tagAt(asked)) === "present";
  const word = { ...arabicEnd(shown), pattern: arabicPattern(core, presentVerb) };
  const opening = presentVerb ? vowelOn(shown, prefix) : "";
  return ({ first, opening: ownOpening }) => {
    const plain = first.replace(MARKS, "").replace(/^(?:[وف]?[بكل]?[اٱ]ل|[وف]?لل|[وف])(?=\S{3})/, "");
    const own = { ...arabicEnd(first), pattern: arabicPattern(plain) };
    return [
      word.ending !== "" && own.ending === word.ending,
      word.rhyme !== "" && own.rhyme === word.rhyme,
      markRelation(word.final, own.final, sameCase),
      word.pattern.distinctive && own.pattern.pattern === word.pattern.pattern,
      markRelation(opening, ownOpening),
    ].join();
  };
}

/** Whether one of four values differs from the other three, which agree. */
function oddOneOut(values: readonly unknown[]): boolean {
  const counts = new Map<unknown, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return values.length === 4 && counts.size === 2 && [...counts.values()].includes(1);
}

/** Whether an Arabic meaning points to the asked word: its root, stem or lemma, four letters of it, or its core. */
function pointsTo(entry: LemmaEntry, p: WordPosition, meaning: string): boolean {
  const words = contentWords("ar", meaning);
  const stemText = bare(affixesAt(p)?.stem ?? "");
  const forms = [stemText, bare(entry.lemma)].filter((form) => form.length >= 3);
  const own = arabicCoreForms(highlightedWord(p));
  return (
    spellsRoot(entry.root, meaning) ||
    words.some((word) => forms.some((form) => word.includes(form))) ||
    words.some((word) => [...word].slice(3).some((_, i) => stemText.includes(word.slice(i, i + 4)))) ||
    arabicCores(meaning).some((core) => sameCore(core, own))
  );
}

/**
 * Whether a meaning repeats a word of the asked ayah: any Arabic word's core or root ("للأثر" beside
 * ءَاثَارِهِمَا), or a stem of another word's English gloss ("will punish" beside "(as) His punishment").
 */
function repeatsAyah(language: MeaningLanguage, asked: WordPosition, meaning: string): boolean {
  const words = ayahWords(asked);
  if (language === "ar") {
    const mine = arabicCores(meaning);
    if (words.some((word) => arabicCores(word).some((core) => mine.some((own) => sameCore(own, core))))) return true;
    return (ayahRoots.get(`${asked.surah}:${asked.ayah}`) ?? []).some(({ root }) => spellsRoot(root, meaning));
  }
  const mine = looseStems(meaning);
  return words.some((_, i) => i + 1 !== asked.pos && shareStem(mine, looseStems(glossAt({ ...asked, pos: i + 1 }))));
}
/** Whether the asked ayah has a word of this root at another position than the asked word. */
const rootInAyah = (asked: WordPosition, root: string) =>
  (ayahRoots.get(`${asked.surah}:${asked.ayah}`) ?? []).some((word) => word.pos !== asked.pos && word.root === root);

const optionWords = (language: MeaningLanguage, meaning: string): Core[] =>
  language === "en" ? contentWords("en", meaning).map((word) => ({ core: word, radical: "" })) : arabicCores(meaning);

type LemmaMeanings = {
  usual: { key: string; words: Core[] }[];
  frequent: Set<string>;
  usualWords: Set<string>;
  /** Words in a fifth of the meanings at all the lemma's positions, eligible or not. */
  plainWords: Set<string>;
};
/** A meaning word as a lemma's word counts go: its radical of three letters or more, else its core. */
const wordKey = (word: Core) => (word.radical.length >= 3 ? word.radical : word.core);
const lemmaMeanings = new Map<string, LemmaMeanings>();
/** A lemma's usual meanings (half as common as its commonest, which recurs) and its words in a fifth of its positions. */
function meaningsOf(entry: LemmaEntry, language: MeaningLanguage): LemmaMeanings {
  const key = `${language}|${entry.key}`;
  if (!lemmaMeanings.has(key)) {
    const all = entry.positions[language]
      .filter((p) => affixesAt(p) && meaningAt(language, p))
      .map((p) => {
        const rest =
          language === "en" ? englishLead(glossAt(p)).rest : arabicLead(affixesAt(p)!.prefix, meaningAt("ar", p)).rest;
        return { key: meaningKeys(rest)[0], words: optionWords(language, rest) };
      });
    const counts = new Map<string, number>();
    for (const meaning of all) counts.set(meaning.key, (counts.get(meaning.key) ?? 0) + 1);
    const top = Math.max(0, ...counts.values());
    const usual = top >= 2 ? all.filter((meaning) => counts.get(meaning.key)! >= Math.max(2, top / 2)) : [];
    const wordCounts = new Map<string, number>();
    for (const meaning of all)
      for (const word of new Set(meaning.words.map(wordKey))) wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    const frequent = new Set([...wordCounts].filter(([, count]) => count >= 0.2 * all.length).map(([word]) => word));
    const usualWords = new Set(usual.flatMap((meaning) => meaning.words.map(wordKey)));
    const senses = entry.positions.en
      .filter((p) => affixesAt(p) && meaningAt(language, p))
      .map((p) => {
        const meaning = meaningAt(language, p);
        const rest = language === "en" ? englishLead(meaning).rest : arabicLead(affixesAt(p)!.prefix, meaning).rest;
        return new Set(optionWords(language, rest).map(wordKey));
      });
    const senseCounts = new Map<string, number>();
    for (const words of senses) for (const word of words) senseCounts.set(word, (senseCounts.get(word) ?? 0) + 1);
    const plainWords = new Set(
      [...senseCounts].filter(([, count]) => count >= 0.2 * senses.length).map(([word]) => word),
    );
    lemmaMeanings.set(key, { usual, frequent, usualWords, plainWords });
  }
  return lemmaMeanings.get(key)!;
}
function isUsual(language: MeaningLanguage, entry: LemmaEntry, meaning: string, prefix: string): boolean {
  const { usual } = meaningsOf(entry, language);
  if (usual.length === 0) return true;
  const rest = language === "en" ? englishLead(meaning).rest : arabicLead(prefix, meaning).rest;
  const mine = { key: meaningKeys(rest)[0], words: optionWords(language, rest) };
  return usual.some(
    (other) =>
      other.key === mine.key ||
      other.words.some((word) =>
        mine.words.some((own) => (language === "en" ? word.core === own.core : sameCore(word, own))),
      ),
  );
}
/** Whether each word of a meaning is in a fifth of the lemma's meanings or a usual one: its plain sense. */
function isPlain(language: MeaningLanguage, entry: LemmaEntry, meaning: string, prefix: string): boolean {
  const { plainWords, usualWords } = meaningsOf(entry, language);
  const rest = language === "en" ? englishLead(meaning).rest : arabicLead(prefix, meaning).rest;
  return optionWords(language, rest).every((word) => plainWords.has(wordKey(word)) || usualWords.has(wordKey(word)));
}
const nearSynonyms = (a: LemmaEntry, b: LemmaEntry) =>
  LANGUAGES.some((language) => {
    const mine = meaningsOf(a, language).frequent;
    return [...meaningsOf(b, language).frequent].some((word) => mine.has(word));
  });

const letterCount = (meaning: string) => meaning.replace(MARKS, "").replace(/[\s()[\],،]/g, "").length;

/** A verb or noun by its MASAQ tag: perfect, imperfect or imperative verb, noun, adjective or gerund. */
const VERB_OR_NOUN_TAG = /^(PV|IV|CV)(_PASS)?$|^IV\d|^(NOUN|ADJ|GERUND)/;

// --- Rules ------------------------------------------------------------------------------------------------

/** Every rule an item breaks, in words. */
async function problemsOf(item: CheckItem): Promise<string[]> {
  const problems: string[] = [];
  const name = `${item.boundary}/${item.language} ${at(item.word)}`;
  const positions = [item.word, ...item.distractors];
  if (item.distractors.length !== 3) problems.push(`${name}: ${item.distractors.length} distractors`);
  const asked = index.lemmaAt.get(at(item.word));
  const inAyah = ayahLemmas.get(`${item.word.surah}:${item.word.ayah}`) ?? new Set();
  const copies = item.language === "ar" ? copiesFrom(item.word) : () => "";
  type Option = { entry: LemmaEntry; meaning: string; keys: string[]; words: Set<string>; cores: Core[] };
  const options: (Option & { stems: string[] })[] = [];
  const leads: string[] = [];
  const shapes: string[] = [];
  const copied: string[] = [];
  const marks: { voweled: boolean; final: string; opening: string; rhyme: string }[] = [];
  for (const [option, p] of positions.entries()) {
    const where = `${name} at ${at(p)}`;
    const entry = index.lemmaAt.get(at(p));
    if (!entry) {
      problems.push(`${where}: no lemma`);
      continue;
    }
    if (!eligible[item.language].has(at(p))) problems.push(`${where}: not eligible`);
    if (entry.band !== item.boundary - 1) problems.push(`${where}: band ${entry.band}`);
    if (!entry.root) problems.push(`${where}: no root`);
    if (option > 0 && inAyah.has(entry.key)) problems.push(`${where}: its lemma is in the asked ayah`);
    if (rootInAyah(item.word, entry.root)) problems.push(`${where}: its root ${entry.root} is in the asked ayah`);

    const shown = highlightedWord(p);
    const irabWord = (
      store.sql
        .prepare("SELECT arabic_word FROM main.word_irab WHERE surah = ? AND ayah = ? AND word_pos = ?")
        .get(p.surah, p.ayah, p.pos) as { arabic_word: string | null } | undefined
    )?.arabic_word;
    if (!sameWord(shown, irabWord ?? "")) problems.push(`${where}: highlights ${shown}, tables describe ${irabWord}`);
    const parts = tagAt(p).split("|");
    if (!parts.some((tag) => VERB_OR_NOUN_TAG.test(tag))) problems.push(`${where}: not a verb or noun`);
    if (parts.some((tag) => tag.startsWith("NOUN_PROP"))) problems.push(`${where}: a proper name`);

    let meaning = "";
    if (item.language === "ar") {
      const row = await fetchWordMeaningAr(store.db, p.surah, p.ayah, p.pos);
      meaning = row?.meaning?.trim() ?? "";
      if (row?.source !== "bundled") problems.push(`${where}: no bundled Arabic meaning`);
      if ((row?.word ?? "").trim().split(/\s+/).length !== 1) problems.push(`${where}: not a one-word entry`);
      if (!sameWord(shown, row?.word ?? "")) problems.push(`${where}: meaning is for ${row?.word}`);
      if (meaning.length > 60) problems.push(`${where}: Arabic meaning of ${meaning.length} characters`);
      if (meaning.includes("\n")) problems.push(`${where}: Arabic meaning of more than one line`);
      if (AR_MALFORMED.test(meaning)) problems.push(`${where}: malformed meaning ${meaning}`);
      if (namesOrExplains(meaning)) problems.push(`${where}: names a person or is a note: ${meaning}`);
      if (!/(^|\|)(POSS_PRON|OBJ_PRON)/.test(tagAt(p)) && tiesToAyah(meaning))
        problems.push(`${where}: has a pronoun of its ayah: ${meaning}`);
      if (asked && pointsTo(asked, item.word, meaning)) problems.push(`${where}: points to the asked word: ${meaning}`);
    } else {
      const row = await fetchWordTranslation(store.db, p.surah, p.ayah, p.pos);
      meaning = row?.translation_en?.trim() ?? "";
      if (meaning.length > 40) problems.push(`${where}: English gloss of ${meaning.length} characters`);
      if (EN_MALFORMED.test(meaning)) problems.push(`${where}: malformed gloss ${meaning}`);
    }
    if (!meaning) problems.push(`${where}: no meaning`);
    if (repeatsAyah(item.language, item.word, meaning)) problems.push(`${where}: repeats a word of the asked ayah`);
    if (option === 0 && !isUsual(item.language, entry, meaning, affixesAt(p)?.prefix ?? ""))
      problems.push(`${name}: not the word's usual sense: ${meaning}`);
    if (option === 0 && !isPlain(item.language, entry, meaning, affixesAt(p)?.prefix ?? ""))
      problems.push(`${name}: not the word's plain sense: ${meaning}`);
    const form = formAt(item.language, p);
    leads.push(form.lead || "-");
    shapes.push(form.shape);
    copied.push(copies(form));
    const end = item.language === "ar" ? arabicEnd(form.first) : { final: "", rhyme: "" };
    marks.push({ voweled: item.language === "ar" && voweled(meaning), opening: form.opening, ...end });
    options.push({
      entry,
      meaning,
      keys: meaningKeys(meaning),
      words: new Set(contentWords(item.language, meaning)),
      cores: optionWords(item.language, meaning),
      stems: item.language === "en" ? looseStems(meaning) : [],
    });
  }
  // The right answer must not be the one option that differs in form or copies the asked word.
  if (new Set(leads).size > 1) problems.push(`${name}: options differ by lead (${leads.join(" | ")})`);
  if (new Set(shapes).size > 1) problems.push(`${name}: options differ by shape (${shapes.join(" | ")})`);
  if (new Set(copied).size > 1) problems.push(`${name}: options differ by what they copy from the asked word`);
  for (const mark of ["voweled", "final", "opening", "rhyme"] as const)
    if (oddOneOut(marks.map((option) => option[mark]))) problems.push(`${name}: one option stands out by its ${mark}`);
  const letters = options.map((option) => letterCount(option.meaning));
  if (Math.max(...letters) > 2 * Math.min(...letters) + 6) problems.push(`${name}: lengths ${letters.join(", ")}`);
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const [a, b] = [options[i], options[j]];
      if (a.entry.root === b.entry.root) problems.push(`${name}: options ${i} and ${j} share the root ${a.entry.root}`);
      if (a.keys.some((key) => b.keys.includes(key))) problems.push(`${name}: options ${i} and ${j} mean the same`);
      const shared = [...a.words].filter((word) => b.words.has(word));
      if (shared.length) problems.push(`${name}: options ${i} and ${j} share ${shared.join(", ")}`);
      if (shareStem(a.stems, b.stems)) problems.push(`${name}: options ${i} and ${j} share a stem`);
      if (a.stems.some((word) => b.stems.some((other) => oneLetterApart(word, other))))
        problems.push(`${name}: options ${i} and ${j} have words one letter apart`);
      if (item.language === "ar" && a.cores.some((core) => b.cores.some((other) => sameRadical(core, other))))
        problems.push(`${name}: options ${i} and ${j} share a root word`);
      if (nearSynonyms(a.entry, b.entry)) problems.push(`${name}: options ${i} and ${j} are near-synonyms`);
    }
  }
  return problems;
}

/** The option texts of items, by their keys: the meaning without parentheses and its sorted content words. */
async function textsOf(item: CheckItem): Promise<string[][]> {
  return Promise.all(
    [item.word, ...item.distractors].map(async (p) => {
      const meaning =
        item.language === "ar"
          ? ((await fetchWordMeaningAr(store.db, p.surah, p.ayah, p.pos))?.meaning?.trim() ?? "")
          : ((await fetchWordTranslation(store.db, p.surah, p.ayah, p.pos))?.translation_en?.trim() ?? "");
      return [...meaningKeys(meaning), contentWords(item.language, meaning).sort().join(" ")];
    }),
  );
}

/** Option texts offered twice among these items: a repeat would tell a reader which option is new. */
async function repeatedTexts(items: readonly CheckItem[]): Promise<string[]> {
  const seen = new Map<string, string>();
  const repeats: string[] = [];
  for (const item of items) {
    for (const [option, keys] of (await textsOf(item)).entries()) {
      const where = `${item.boundary}/${item.language} ${at(item.word)} option ${option}`;
      const earlier = keys.map((key) => seen.get(key)).find(Boolean);
      if (earlier) repeats.push(`${where} repeats the text of ${earlier}: ${keys[0]}`);
      for (const key of keys) if (!seen.has(key)) seen.set(key, where);
    }
  }
  return repeats;
}

/**
 * Groups the builder cannot fill to eight without breaking a rule, and how many items they hold. Boundary 1
 * in Arabic has 14 commonest lemmas that give a fair item at all, and their wrong options overlap; the
 * builder's search over all of them finds no group of eight.
 */
const SHORT_GROUPS: Record<string, number> = { "1ar": 7 };

it("has eight items for each boundary and meaning language, apart from the groups reported short", () => {
  const counts: Record<string, number> = {};
  for (const item of CHECK_BANK)
    counts[`${item.boundary}${item.language}`] = (counts[`${item.boundary}${item.language}`] ?? 0) + 1;
  const expected = Object.fromEntries(
    [1, 2, 3, 4, 5].flatMap((boundary) =>
      ["ar", "en"].map((language) => [`${boundary}${language}`, SHORT_GROUPS[`${boundary}${language}`] ?? 8]),
    ),
  );
  expect(counts).toEqual(expected);
});

/**
 * Ayat asked twice in a language, or asked by one item and offering a wrong option to another: one check
 * asks across groups, and a second sight of an ayah tells a reader about the first.
 */
function ayahProblems(items: readonly CheckItem[]): string[] {
  const ayahOf = (p: WordPosition) => `${p.surah}:${p.ayah}`;
  const problems: string[] = [];
  for (const language of LANGUAGES) {
    const inLanguage = items.filter((item) => item.language === language);
    const asked = new Map<string, string>();
    for (const item of inLanguage) {
      const earlier = asked.get(ayahOf(item.word));
      if (earlier) problems.push(`${language} ${at(item.word)}: ayah asked again after ${earlier}`);
      asked.set(ayahOf(item.word), at(item.word));
    }
    for (const item of inLanguage)
      for (const p of item.distractors)
        if (asked.has(ayahOf(p)) && ayahOf(p) !== ayahOf(item.word))
          problems.push(
            `${language} ${at(item.word)}: wrong option ${at(p)} from the ayah ${asked.get(ayahOf(p))} asks`,
          );
  }
  return problems;
}

it("asks an ayah once per language and offers no wrong option from an asked ayah", () => {
  expect(ayahProblems(CHECK_BANK)).toEqual([]);
});

it("carries the hash of its items in its header", () => {
  const where = (p: WordPosition) => `${p.surah}:${p.ayah}:${p.pos}`;
  const lines = CHECK_BANK.map((item) =>
    [item.boundary, item.language, where(item.word), ...item.distractors.map(where)].join(" "),
  );
  const hash = createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 12);
  const header = /content hash ([0-9a-f]{12})/.exec(readFileSync(BANK_FILE, "utf8"))?.[1];
  expect(header).toBe(hash);
});

it("asks each lemma once per language, and offers a wrong option once per group, never an asked one", () => {
  const lemmaOf = (p: WordPosition) => index.lemmaAt.get(at(p))?.key ?? at(p);
  for (const language of LANGUAGES) {
    const asked = CHECK_BANK.filter((item) => item.language === language).map((item) => lemmaOf(item.word));
    expect(new Set(asked).size).toBe(asked.length);
  }
  const problems = [1, 2, 3, 4, 5].flatMap((boundary) =>
    LANGUAGES.flatMap((language) => {
      const group = CHECK_BANK.filter((item) => item.boundary === boundary && item.language === language);
      const asked = new Set(group.map((item) => lemmaOf(item.word)));
      const offered = group.flatMap((item) => item.distractors.map(lemmaOf));
      const twice = offered.filter((lemma, i) => offered.indexOf(lemma) !== i).map((lemma) => `${lemma} twice`);
      return [...offered.filter((lemma) => asked.has(lemma)).map((lemma) => `${lemma} asked`), ...twice].map(
        (problem) => `${boundary}/${language}: ${problem}`,
      );
    }),
  );
  expect(problems).toEqual([]);
});

it("keeps every item to the bank's rules", async () => {
  const problems = (await Promise.all(CHECK_BANK.map(problemsOf))).flat();
  expect(problems).toEqual([]);
});

it("offers each option text once per language, since one check can ask across groups", async () => {
  const problems = await Promise.all(
    LANGUAGES.map((language) => repeatedTexts(CHECK_BANK.filter((item) => item.language === language))),
  );
  expect(problems.flat()).toEqual([]);
});

it("reports an item that breaks the rules", async () => {
  const item = CHECK_BANK.find((candidate) => candidate.language === "en")!;
  const broken: CheckItem = {
    ...item,
    boundary: item.boundary === 5 ? 4 : 5,
    distractors: [item.word, item.distractors[1], { surah: 5, ayah: 117, pos: 28 }],
  };
  const problems = await problemsOf(broken);
  expect(problems.some((problem) => problem.includes("band"))).toBe(true);
  expect(problems.some((problem) => problem.includes("share the root"))).toBe(true);
  expect(problems.some((problem) => problem.includes("mean the same"))).toBe(true);
  expect(problems.some((problem) => problem.includes("share"))).toBe(true);
  // 5:117 counts one word fewer in word_irab than in the text, so position 28 is "شَىْءٍ" described as "شَهِيدٌ".
  expect(problems.some((problem) => problem.includes("5:117:28: highlights"))).toBe(true);

  const arabicItem = CHECK_BANK.find((candidate) => candidate.language === "ar")!;
  const arabic = await problemsOf({
    ...arabicItem,
    distractors: [
      // word_meanings_ar describes the next word here, so the index leaves it out in Arabic.
      { surah: 5, ayah: 117, pos: 28 },
      // A two-word entry, "وَأُوحِيَ إِلَيَّ".
      { surah: 6, ayah: 19, pos: 11 },
      // An 84-character meaning that explains the ayah ("والمراد أنهم أخذوا الكفر").
      { surah: 2, ayah: 16, pos: 3 },
    ],
  });
  expect(arabic.some((problem) => problem.includes("5:117:28: not eligible"))).toBe(true);
  expect(arabic.some((problem) => problem.includes("5:117:28: meaning is for"))).toBe(true);
  expect(arabic.some((problem) => problem.includes("6:19:11: not a one-word entry"))).toBe(true);
  expect(arabic.some((problem) => problem.includes("2:16:3: Arabic meaning of 84 characters"))).toBe(true);
  expect(arabic.some((problem) => problem.includes("2:16:3: names a person or is a note"))).toBe(true);

  const sameAyah = CHECK_BANK.find((candidate) => candidate.language === "en")!;
  const neighbour = [...index.lemmaAt.keys()].find(
    (key) =>
      key.startsWith(`${sameAyah.word.surah}:${sameAyah.word.ayah}:`) &&
      key !== at(sameAyah.word) &&
      index.lemmaAt.get(key)!.key !== index.lemmaAt.get(at(sameAyah.word))!.key,
  )!;
  const [surah, ayah, pos] = neighbour.split(":").map(Number);
  const fromAyah = await problemsOf({
    ...sameAyah,
    distractors: [{ surah, ayah, pos }, sameAyah.distractors[1], sameAyah.distractors[2]],
  });
  expect(fromAyah.some((problem) => problem.includes(`${neighbour}: its lemma is in the asked ayah`))).toBe(true);
});

it.each([
  "كان وزيرًا لفرعون موسى",
  "القرآن الكريم",
  "مكة المكرمة",
  "نار جهنم",
  "الجنة ونعيمها",
  "كناية عن الموت",
  "يعني الكفار",
  "بمعنى الخلق",
  "جمع رسول",
  "الهلاك؛ والعذاب",
  "وقيل الشرك",
  "أي الكافرون",
])("reads %s as a name or a note", (meaning) => {
  expect(namesOrExplains(meaning)).toBe(true);
});

it.each(['(said)," Take', "'Come to us.'", "(to) those who see (it).'", "will surely,encompass", "ten [i.e. twelve]"])(
  "reads the gloss %s as malformed",
  (gloss) => {
    expect(EN_MALFORMED.test(gloss)).toBe(true);
  },
);

/** An item from "surah:ayah:pos" strings. */
function itemOf(boundary: CheckItem["boundary"], language: MeaningLanguage, word: string, wrong: string[]): CheckItem {
  const position = (key: string) => {
    const [surah, ayah, pos] = key.split(":").map(Number);
    return { surah, ayah, pos };
  };
  const [a, b, c] = wrong.map(position);
  return { boundary, language, word: position(word), distractors: [a, b, c] };
}

/**
 * Items from the earlier banks, numbered as the review page showed them, whose form gave the answer away,
 * whose meaning fits only its ayah or points to the asked word, or whose options repeat or mean the same.
 */
const FOUND_BY_REVIEW = [
  {
    finding: 'only the right answer starts with "and" (and the witnessed)',
    item: itemOf(2, "en", "13:9:3", ["2:107:17", "16:75:22", "24:57:11"]),
    expected: "differ by lead",
  },
  {
    finding: 'a wrong option starts with "and" (and We raised) while أَغْنَىٰ has no و or ف',
    item: itemOf(3, "en", "15:84:2", ["2:63:4", "35:32:2", "17:47:4"]),
    expected: "differ by lead",
  },
  {
    finding: "only the right answer has brackets ((to) abide forever)",
    item: itemOf(1, "en", "16:29:4", ["2:106:8", "2:24:7", "4:89:11"]),
    expected: "differ by lead",
  },
  {
    finding: 'a wrong option reads "will surely,encompass"',
    item: itemOf(5, "en", "73:11:4", ["29:54:5", "51:47:3", "29:41:9"]),
    expected: "malformed gloss",
  },
  {
    finding: "only the right answer starts with the ل of لِأَبِى (لِوالِدِي)",
    item: itemOf(2, "ar", "26:86:2", ["7:87:3", "24:29:10", "7:163:3"]),
    expected: "differ by lead",
  },
  {
    finding: "only the right answer starts with the و of وَأَيَّدْنَٰهُ (وقوّيناه)",
    item: itemOf(4, "ar", "2:87:14", ["6:7:7", "50:31:1", "2:153:4"]),
    expected: "differ by lead",
  },
  {
    finding: "مَلائِكَةُ اللهِ fits رُسُلُنَا only in 29:31",
    item: itemOf(1, "ar", "29:31:3", ["2:174:12", "28:63:5", "10:104:9"]),
    expected: "names a person or is a note",
  },
  {
    finding: "a wrong option names عيسى عليه السلام",
    item: itemOf(2, "ar", "4:18:5", ["35:19:4", "22:65:22", "21:91:9"]),
    expected: "names a person or is a note",
  },
  {
    finding: "#36: مُهْتَدِينَ is answered by its own root هدي (مستجيبين للهداية)",
    item: itemOf(3, "ar", "10:45:20", ["31:32:7", "2:90:27", "21:53:5"]),
    expected: "10:45:20: points to the asked word",
  },
  {
    finding: "#36: a wrong option starts with ب (بإخلاص)",
    item: itemOf(3, "ar", "10:45:20", ["31:32:7", "2:90:27", "21:53:5"]),
    expected: "differ by lead",
  },
  {
    finding: "#36: a singular wrong option (مُذِلٌّ) for a plural word",
    item: itemOf(3, "ar", "10:45:20", ["31:32:7", "2:90:27", "21:53:5"]),
    expected: "differ by shape",
  },
  {
    finding: "#49: عَلَا is answered by its own root علو (واستعلى)",
    item: itemOf(4, "ar", "28:4:3", ["16:13:2", "2:166:2", "28:48:22"]),
    expected: "28:4:3: points to the asked word",
  },
  {
    finding: "#51: ٱلْمِيعَادَ is answered by its own root وعد (الموعود)",
    item: itemOf(4, "ar", "39:20:20", ["18:9:5", "20:97:27", "40:36:9"]),
    expected: "39:20:20: points to the asked word",
  },
  {
    finding: "#18: only the right answer is passive, like زُيِّنَ",
    item: itemOf(2, "ar", "2:212:1", ["72:19:3", "12:42:3", "3:164:7"]),
    expected: "differ by shape",
  },
  {
    finding: "#67: only the right answer copies the dual ending of رَبَّيَانِى",
    item: itemOf(5, "ar", "17:24:11", ["12:32:4", "92:2:3", "2:60:2"]),
    expected: "differ by shape",
  },
  {
    finding: "#50: the right answer repeats من مال, the words after سَعَةً",
    item: itemOf(4, "ar", "2:247:23", ["78:38:5", "2:167:7", "2:236:13"]),
    expected: "2:247:23: repeats a word of the asked ayah",
  },
  {
    finding: "#7: قضاء أو حكم fits كِتَٰبٌ only in 8:68, whose usual meanings are القرآن and التوراة",
    item: itemOf(1, "ar", "8:68:2", ["10:79:6", "17:89:9", "6:143:2"]),
    expected: "not the word's usual sense",
  },
  {
    finding: "#52: a wrong option (يخافون) is a word of the asked ayah 13:21",
    item: itemOf(4, "ar", "13:21:2", ["36:42:6", "9:56:10", "12:105:7"]),
    expected: "9:56:10: repeats a word of the asked ayah",
  },
  {
    finding: "#5: two options from the root لقي (لقينا, ألقينا)",
    item: itemOf(1, "ar", "21:53:2", ["20:38:2", "2:53:2", "2:8:5"]),
    expected: "share a root word",
  },
  {
    finding: "#38: a wrong option names الجنة",
    item: itemOf(3, "ar", "2:114:25", ["20:81:11", "4:95:26", "5:108:2"]),
    expected: "names a person or is a note",
  },
  {
    finding: "#2: only the right answer has tanween, like أَجْرٌ",
    item: itemOf(1, "ar", "95:6:7", ["9:128:14", "2:10:9", "49:11:6"]),
    expected: "differ by shape",
  },
  {
    finding: "#20: only the right answer has two words and the pattern of يُجَٰدِلُ (يُناقِشُ ويُخاصِمُ)",
    item: itemOf(2, "ar", "22:3:4", ["2:211:10", "2:196:15", "9:107:22"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#39: a plural right answer for the singular يُعْرَضُ",
    item: itemOf(3, "ar", "46:20:2", ["6:16:2", "35:22:8", "59:9:26"]),
    expected: "differ by shape",
  },
  {
    finding: "#13: only the right answer is plural (signs)",
    item: itemOf(1, "en", "12:7:6", ["2:20:24", "7:44:12", "17:89:9"]),
    expected: "differ by shape",
  },
  {
    finding: "#60: a noun (clay) among a participle, an adjective and an -ing word",
    item: itemOf(4, "en", "15:28:9", ["21:15:7", "13:5:11", "3:113:7"]),
    expected: "differ by shape",
  },
  {
    finding: "#11: a present gloss (wills) among past ones",
    item: itemOf(1, "en", "2:70:15", ["2:59:3", "2:29:3", "2:22:2"]),
    expected: "differ by shape",
  },
  {
    finding: "#44: complete and fulfil both fit 2:187",
    item: itemOf(3, "en", "2:187:44", ["69:19:8", "38:39:5", "6:152:30"]),
    expected: "near-synonyms",
  },
  {
    finding: 'only the right answer has an article ("the grief")',
    item: itemOf(5, "en", "12:84:10", ["7:195:7", "19:10:12", "2:96:5"]),
    expected: "differ by lead",
  },
  // Bank c9ffd8113b5c's successor, e730e556f54f, as the second verifier numbered it.
  {
    finding: "#17: only the right answer (حُجَّةٍ) has the kasratan of سُلْطَٰنٍ, the others -an",
    item: itemOf(2, "ar", "7:71:20", ["2:22:16", "26:83:4", "17:99:16"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#55: only the right answer (طينٍ) has the kasratan of صَلْصَٰلٍ",
    item: itemOf(4, "ar", "15:26:5", ["38:59:2", "51:3:2", "28:38:18"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#5: two options copy the -un of ذِكْرٌ, two clash with it",
    item: itemOf(1, "ar", "12:104:9", ["17:89:9", "2:7:11", "7:44:12"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#39: two options copy the -un of مَّرَضٌ, two clash with it",
    item: itemOf(3, "ar", "5:52:5", ["2:124:11", "22:78:14", "4:141:17"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#50: two options copy the -un of شِهَابٌ, two end in -an",
    item: itemOf(4, "ar", "37:10:6", ["7:148:9", "19:10:13", "2:222:6"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#65: two options copy the -an of طَوْلًا, two clash with it",
    item: itemOf(5, "ar", "4:25:5", ["27:70:7", "58:16:3", "78:9:3"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#65: wrong options with the pronouns of their ayat (صدرك, لهم, لأبدانكم)",
    item: itemOf(5, "ar", "4:25:5", ["27:70:7", "58:16:3", "78:9:3"]),
    expected: "has a pronoun of its ayah",
  },
  {
    finding: "#49: only one option (كَذِبٌ) clashes with the -an of صَٰعِقَةً",
    item: itemOf(4, "ar", "41:13:5", ["33:12:13", "18:64:9", "24:16:13"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#67: the right answer (مُتَخَلٍّ) clashes with the -un of تَارِكٌ that two wrong ones copy",
    item: itemOf(5, "ar", "11:12:2", ["2:72:7", "28:88:13", "70:2:4"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#23: العَذابُ and المَرْجِعُ clash with the fatha of ٱلْفُلْكَ, the right answer shows none",
    item: itemOf(2, "ar", "17:66:5", ["7:163:3", "39:61:8", "42:15:34"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#70: الولَدُ and الفَضْلِ clash with the fatha of ٱلنَّدَامَةَ, the right answer shows none",
    item: itemOf(5, "ar", "10:54:12", ["2:205:10", "55:27:6", "45:24:12"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#1: only the right answer (يُبْعِدُونَ) has the يُـ of يُخْرِجُونَ, the others يَـ",
    item: itemOf(1, "ar", "60:1:18", ["4:117:2", "7:174:5", "5:37:1"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#52: only the right answer (يَخْفِضُونَ) rhymes with يَغُضُّونَ on ض",
    item: itemOf(4, "ar", "49:3:3", ["4:74:6", "9:56:10", "43:47:7"]),
    expected: "differ by what they copy",
  },
  {
    finding: "#3: only the right answer (حُكْماً) is voweled",
    item: itemOf(1, "ar", "33:36:10", ["6:14:5", "16:75:4", "4:150:22"]),
    expected: "stands out by its voweled",
  },
  {
    finding: "#53: only the right answer (ينطقُ) is bare",
    item: itemOf(4, "ar", "30:35:6", ["10:11:2", "34:2:14", "2:261:19"]),
    expected: "stands out by its voweled",
  },
  {
    finding: "#56: only the right answer (مُبْغِضون) is voweled",
    item: itemOf(4, "ar", "9:48:16", ["36:71:12", "29:34:2", "23:4:4"]),
    expected: "stands out by its voweled",
  },
  {
    finding: "#25: يُعَذِّبُ beside عَذَابَهُۥ, whose gloss is (as) His punishment",
    item: itemOf(2, "en", "89:25:3", ["5:119:5", "10:17:13", "4:109:9"]),
    expected: "89:25:3: repeats a word of the asked ayah",
  },
  {
    finding: "#25: the asked word's root عذب is in the ayah again",
    item: itemOf(2, "en", "89:25:3", ["5:119:5", "10:17:13", "4:109:9"]),
    expected: "89:25:3: its root",
  },
  {
    finding: "#27: great beside أَكْبَرُ, (is) greater",
    item: itemOf(2, "en", "2:219:8", ["4:31:12", "27:22:3", "57:25:16"]),
    expected: "2:219:8: repeats a word of the asked ayah",
  },
  {
    finding: "#80: and thunder beside the thunderclaps",
    item: itemOf(5, "en", "2:19:7", ["54:24:10", "2:205:10", "10:90:9"]),
    expected: "2:19:7: repeats a word of the asked ayah",
  },
  {
    finding: "#6: معيشة آمنة is حَيَوٰةٌ in 2:179 only",
    item: itemOf(1, "ar", "2:179:4", ["2:248:5", "33:47:7", "3:85:5"]),
    expected: "not the word's plain sense",
  },
  {
    finding: "#19: a wrong option with two spaces (اختاروا  وقَبِلوا)",
    item: itemOf(2, "ar", "72:19:7", ["9:87:1", "2:217:37", "28:39:8"]),
    expected: "malformed meaning",
  },
  {
    finding: "#24: سرير الملكة fits 27:23 only",
    item: itemOf(2, "ar", "5:71:4", ["8:2:14", "76:6:1", "27:23:10"]),
    expected: "names a person or is a note",
  },
  {
    finding: "#50: صَحِيحًا مُعَافًى ليس بك مَرَضٌ fits 19:10 only",
    item: itemOf(4, "ar", "37:10:6", ["7:148:9", "19:10:13", "2:222:6"]),
    expected: "19:10:13: has a pronoun of its ayah",
  },
  {
    finding: "#55: جَمَاعَةٌ مِنْ أَهْلِ النَّارِ fits 38:59 only",
    item: itemOf(4, "ar", "15:26:5", ["38:59:2", "51:3:2", "28:38:18"]),
    expected: "38:59:2: names a person or is a note",
  },
  {
    finding: "#69: مُناجيا لنا fits 19:52 only",
    item: itemOf(5, "ar", "7:183:5", ["19:52:7", "14:34:14", "11:97:10"]),
    expected: "19:52:7: has a pronoun of its ayah",
  },
  // Found while building this bank.
  {
    finding: "a noun (creator) among nouns and an adjective (secure)",
    item: itemOf(3, "en", "35:3:9", ["2:126:8", "47:13:13", "7:112:3"]),
    expected: "differ by shape",
  },
  {
    finding: "a noun (tyrant) among adjectives",
    item: itemOf(4, "en", "11:59:11", ["30:43:4", "4:21:11", "3:182:8"]),
    expected: "differ by shape",
  },
  {
    finding: "son, sun and sin, one letter apart, set time apart",
    item: itemOf(2, "en", "23:91:5", ["81:9:2", "76:13:8", "14:25:4"]),
    expected: "one letter apart",
  },
  {
    finding: "معين ومساعد and أعوان وأنصار, two wrong options from the root عون",
    item: itemOf(5, "ar", "72:6:11", ["3:154:7", "25:35:9", "18:51:13"]),
    expected: "share a root word",
  },
  {
    finding: "تتبعا للأثر beside ءَاثَارِهِمَا in 18:64",
    item: itemOf(4, "ar", "18:64:9", ["41:13:5", "2:236:13", "4:38:16"]),
    expected: "18:64:9: repeats a word of the asked ayah",
  },
  {
    finding: "الذي لا يقرأ ولا يكتب starts with a function word, not the article",
    item: itemOf(4, "ar", "58:8:15", ["7:157:5", "6:73:18", "22:30:19"]),
    expected: "differ by lead",
  },
  {
    finding: "only لَشَكَّ keeps the لَ of لَّٱرْتَابَ",
    item: itemOf(4, "ar", "2:101:10", ["54:29:4", "29:48:12", "28:29:7"]),
    expected: "differ by lead",
  },
  {
    finding: "a tatweel in مُـترقّـبا",
    item: itemOf(5, "ar", "7:55:4", ["9:98:7", "25:71:9", "72:9:13"]),
    expected: "72:9:13: malformed meaning",
  },
  {
    finding: "صَاحِبٌ مُلَازِمٌ لِي fits 37:51 only",
    item: itemOf(4, "ar", "7:203:17", ["35:35:10", "37:51:7", "7:41:4"]),
    expected: "37:51:7: has a pronoun of its ayah",
  },
  {
    finding: "هَلَاكًا alone does not rhyme with إِجباراً, مُستَقَرًّا and تَغْييراً",
    item: itemOf(4, "ar", "35:43:21", ["4:19:10", "27:61:4", "25:13:9"]),
    expected: "stands out by its rhyme",
  },
];

it.each(FOUND_BY_REVIEW)("reports an earlier bank's finding: $finding", async ({ item, expected }) => {
  const problems = await problemsOf(item);
  expect(problems.some((problem) => problem.includes(expected))).toBe(true);
});

it("reports ayat asked twice or both asked and offered in a language (e730e556f54f #12, #28, #44, #46)", () => {
  const problems = ayahProblems([
    itemOf(1, "en", "25:3:20", ["7:162:5", "60:1:48", "10:61:13"]),
    itemOf(2, "en", "25:3:18", ["19:62:6", "6:74:13", "11:80:6"]),
    itemOf(3, "en", "16:81:21", ["10:5:20", "42:12:5", "6:57:18"]),
    itemOf(3, "en", "55:52:4", ["16:81:6", "2:226:7", "6:99:27"]),
  ]);
  expect(problems.some((problem) => problem.includes("25:3:18: ayah asked again"))).toBe(true);
  expect(problems.some((problem) => problem.includes("wrong option 16:81:6"))).toBe(true);
});

it.each([
  ["آوى", "أوي"],
  ["مأواهم", "أوي"],
  ["بآيات", "أيي"],
  ["الآية", "أيي"],
])("reads %s as spelling the weak root %s", (meaning, root) => {
  expect(spellsRoot(root, meaning)).toBe(true);
});

it("reports an option text offered twice in a group (3en: fruits wrong in #45, right in #46)", async () => {
  const group = [
    itemOf(3, "en", "16:97:5", ["17:49:4", "16:67:2", "10:94:4"]),
    itemOf(3, "en", "55:52:4", ["63:4:14", "6:70:28", "2:226:7"]),
  ];
  expect((await repeatedTexts(group)).some((problem) => problem.includes("fruit"))).toBe(true);
});
