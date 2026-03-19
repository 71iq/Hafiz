/**
 * Decodes MASAQ morphological and syntactic codes to Arabic labels.
 * Uses the morphology-terms-ar.json reference file + MASAQ-specific compound codes.
 */

const termsData = require("../../assets/data/morphology/morphology-terms-ar.json");

// Build a flat lookup map from all sections of the reference file
const labelMap: Record<string, string> = {};

function addSection(obj: Record<string, string> | undefined) {
  if (!obj) return;
  for (const [code, label] of Object.entries(obj)) {
    labelMap[code] = label;
  }
}

addSection(termsData.types);
addSection(termsData.particles);
addSection(termsData.noun_forms);
addSection(termsData.noun_grammar);
addSection(termsData.attrs);
addSection(termsData.verb_tenses);
addSection(termsData.verb_grammar);
addSection(termsData.pronoun_attrs);
addSection(termsData.labels);
addSection(termsData.other);

if (termsData.FAM) {
  for (const [key, label] of Object.entries(termsData.FAM)) {
    labelMap[key] = label as string;
  }
}

// MASAQ-specific compound codes not in the reference file
const masaqLabels: Record<string, string> = {
  // === Basic POS tags ===
  PREP: "حرف جر",
  CONJ: "حرف عطف",
  VERB: "فعل",
  NOUN: "اسم",
  PRON: "ضمير",
  PART: "حرف",
  ADV: "ظرف",
  ADV_TIME: "ظرف زمان",
  ADV_PLCE: "ظرف مكان",
  INTERJ_PV: "فعل تعجب ماضٍ",
  INTERJ_IV: "فعل تعجب مضارع",
  INTERJ_CV: "فعل تعجب أمر",
  OTHER: "أخرى",
  FOREIGN: "أعجمي",
  ABBREV: "اختصار",
  ACRON: "اختصار حرفي",
  CURRENCY: "عملة",
  None: "",

  // === Noun forms ===
  NOUN_PROP: "اسم علم",
  NOUN_PROP_FOREIGN: "اسم علم أعجمي",
  NOUN_ABSTRACT: "اسم مجرد",
  NOUN_CONCRETE: "اسم عيني",
  NOUN_QUANT: "اسم كمية",
  NOUN_NUM: "اسم عدد",
  NOUN_FIVE: "من الأسماء الخمسة",
  NOUN_CONS: "اسم مقصور",
  NOUN_DIMINUTIVE: "اسم تصغير",
  NOUN_RELATIVE: "اسم منسوب",
  NOUN_TIME_PLACE: "اسم زمان ومكان",
  NOUN_INSTRUMENT: "اسم آلة",
  NOUN_VERB_LIKE: "اسم فعل",
  NOUN_ACTIVE_PART: "اسم فاعل",
  NOUN_PASSIVE_PART: "اسم مفعول",
  NUM_COMP: "عدد مركب",
  EXCEPT_NOUN: "اسم استثناء",

  // === Adjective forms ===
  ADJ_QUALIT: "صفة",
  ADJ_COMP: "صفة تفضيل",
  ADJ_INTENS: "صيغة مبالغة",
  INTENCIF: "صيغة مبالغة",

  // === Gerund (مصدر) forms ===
  GERUND: "مصدر",
  GERUND_MEEM: "مصدر ميمي",
  GERUND_INSTANT: "مصدر مرة",
  GERUND_PROFESSION: "مصدر صناعي",
  GERUND_STATE: "مصدر هيئة",

  // === Pronoun types ===
  DEM_PRON: "اسم إشارة",
  DEM_PRON_MS: "اسم إشارة للمذكر",
  DEM_PRON_FS: "اسم إشارة للمؤنث المفرد",
  DEM_PRON_F: "اسم إشارة للمؤنث",
  DEM_PRON_MP: "اسم إشارة للجمع",
  REL_PRON: "اسم موصول",
  REL_ADV: "ظرف موصول",
  INTERROG_PRON: "اسم استفهام",
  PRON_1S: "ضمير متكلم مفرد",
  PRON_1P: "ضمير متكلم جمع",
  PRON_2MS: "ضمير مخاطب مفرد مذكر",
  PRON_2MP: "ضمير مخاطب جمع مذكر",
  PRON_3MS: "ضمير غائب مفرد مذكر",
  PRON_3FS: "ضمير غائب مفرد مؤنث",
  PRON_3MP: "ضمير غائب جمع مذكر",
  PRON_3FP: "ضمير غائب جمع مؤنث",
  PRON_3D: "ضمير غائب مثنى",

  // === Possessive pronouns ===
  POSS_PRON: "ضمير متصل ملكية",
  POSS_PRON_1S: "ضمير متصل للمتكلم المفرد",
  POSS_PRON_1P: "ضمير متصل للمتكلم الجمع",
  POSS_PRON_2MS: "ضمير متصل للمخاطب المفرد",
  POSS_PRON_3MS: "ضمير متصل للغائب المفرد المذكر",
  POSS_PRON_3FS: "ضمير متصل للغائب المفرد المؤنث",
  POSS_PRON_3MP: "ضمير متصل للغائب الجمع المذكر",
  POSS_PRON_3D: "ضمير متصل للغائب المثنى",

  // === Subject pronouns ===
  SUBJ_PRON: "ضمير فاعل متصل",
  OBJ_PRON: "ضمير مفعول به متصل",

  // === Verb tenses ===
  PV: "فعل ماضٍ",
  IV: "فعل مضارع",
  CV: "فعل أمر",
  PV_PASS: "فعل ماضٍ مبني للمجهول",
  IV_PASS: "فعل مضارع مبني للمجهول",
  CV_COP: "فعل أمر ناقص",
  IV_COP: "فعل مضارع ناقص",
  CV_PREF: "سابقة فعل أمر",
  UNINFLECTED_VERB: "فعل جامد",

  // === Verb prefixes/suffixes with person/number ===
  IMPERF_PREF: "سابقة المضارع",
  IV1S: "فعل مضارع متكلم مفرد",
  IV1P: "فعل مضارع متكلم جمع",
  IV2MP: "فعل مضارع مخاطب جمع مذكر",
  IV3MS: "فعل مضارع غائب مفرد مذكر",
  IV3FS: "فعل مضارع غائب مفرد مؤنث",
  IV3MP: "فعل مضارع غائب جمع مذكر",
  PVSUFF_SUBJ: "ضمير فاعل",
  "PVSUFF_SUBJ:1S": "ضمير فاعل متكلم مفرد",
  "PVSUFF_SUBJ:1P": "ضمير فاعل متكلم جمع",
  "PVSUFF_SUBJ:2MP": "ضمير فاعل مخاطب جمع مذكر",
  "PVSUFF_SUBJ:3MS": "ضمير فاعل غائب مفرد مذكر",
  "PVSUFF_SUBJ:3FS": "ضمير فاعل غائب مفرد مؤنث",
  "PVSUFF_SUBJ:3MP": "ضمير فاعل غائب جمع مذكر",
  PVSUFF_DO: "ضمير مفعول به",
  "PVSUFF_DO:3MS": "ضمير مفعول به غائب مفرد مذكر",
  "PVSUFF_DO:3FS": "ضمير مفعول به غائب مفرد مؤنث",
  "PVSUFF_DO:3MP": "ضمير مفعول به غائب جمع مذكر",
  IVSUFF_DO: "ضمير مفعول به",
  "IVSUFF_DO:3MS": "ضمير مفعول به غائب مفرد مذكر",
  IVSUFF_SUBJ: "ضمير فاعل",
  "IVSUFF_SUBJ:MP_MOOD:I": "ضمير فاعل جمع مذكر مرفوع",
  "IVSUFF_SUBJ:MP_MOOD:SJ": "ضمير فاعل جمع مذكر منصوب",
  VSUFF_DO: "ضمير مفعول به",
  VSUFF_SUBJ: "ضمير فاعل",
  "CVSUFF_SUBJ:2MS": "ضمير فاعل مخاطب مفرد مذكر",
  "CVSUFF_SUBJ:2MP": "ضمير فاعل مخاطب جمع مذكر",

  // === Noun suffixes ===
  SUFF: "لاحقة",
  SUFF_FEM_TA: "تاء التأنيث",
  NSUFF_MASC_PL_GEN: "لاحقة جمع مذكر سالم مجرور",
  NSUFF_MASC_PL_ACC: "لاحقة جمع مذكر سالم منصوب",
  NSUFF_MASC_PL_NOM: "لاحقة جمع مذكر سالم مرفوع",
  NSUFF_FEM_SG: "لاحقة مؤنث",
  NSUFF_FEM_PL: "لاحقة جمع مؤنث",
  NSUFF_MASC_DU_GEN: "لاحقة مثنى مذكر مجرور",
  NSUFF_MASC_DU_NOM: "لاحقة مثنى مذكر مرفوع",
  NSUFF_MASC_DU_ACC: "لاحقة مثنى مذكر منصوب",
  NSUFF_MASC_DU_GEN_POSS: "لاحقة مثنى مذكر مجرور مضاف",
  NSUFF_FEM_DU_GEN: "لاحقة مثنى مؤنث مجرور",
  NSUFF_FEM_DU_NOM: "لاحقة مثنى مؤنث مرفوع",
  NSUFF_FEM_DU_ACC: "لاحقة مثنى مؤنث منصوب",

  // === Noun grammar ===
  NON_INFLECT: "مبني",
  AGNT: "اسم فاعل",
  ACT_PCPL: "اسم فاعل",
  PASS_PCPL: "اسم مفعول",

  // === Case markers ===
  CASE_DEF_NOM: "مرفوع معرفة",
  CASE_DEF_ACC: "منصوب معرفة",
  CASE_DEF_GEN: "مجرور معرفة",
  CASE_INDEF_NOM: "مرفوع نكرة",
  CASE_INDEF_ACC: "منصوب نكرة",
  CASE_INDEF_GEN: "مجرور نكرة",
  "CASE_INDEF_(ACC_GEN)": "منصوب أو مجرور نكرة",

  // === Particle types ===
  CONJ_N: "حرف عطف",
  NEG_PART: "حرف نفي",
  NEG_CAT: "لا النافية للجنس",
  NEG_MAA: "ما النافية",
  NEG_PROH: "لا الناهية",
  ANNUL_PART: "حرف ناسخ",
  INF_ANNUL_PART: "حرف ناسخ مصدري",
  CERT_PART: "حرف توكيد",
  SUBJUNC_PART: "حرف نصب",
  INF_SUBJUNC_PART: "حرف نصب مصدري",
  JUSSIVE_PART: "حرف جزم",
  PART_JUSSIVE: "حرف جزم",
  CONDITION_PART: "حرف شرط",
  PART_CONDITION: "أداة شرط",
  EXCEPT_PART: "أداة استثناء",
  PART_EXCEPT: "أداة استثناء",
  INTERROG: "أداة استفهام",
  INTERROG_PART: "حرف استفهام",
  VOC_PART: "حرف نداء",
  FUTURE_PART: "حرف استقبال",
  FUTUR_PART: "حرف استقبال",
  FUT_PART: "حرف استقبال",
  YES_NO_RESP_PART: "حرف جواب",
  KAAFA_MAKFOUFA: "كافة ومكفوفة",
  PART_INHIB: "حرف كاف",

  // === Verb-related particles ===
  EMPHATIC_NUN: "نون التوكيد",
  PROTECT_NUN: "نون الوقاية",
  NOON_V5: "نون الأفعال الخمسة",
  RELATIVE_YA: "ياء النسبة",

  // === Syntactic function components ===
  SUBJ: "فاعل",
  PRED: "خبر",
  OBJ: "مفعول به",
  PREP_OBJ: "اسم مجرور",
  GEN_CONS: "مضاف إليه",
  SPEC: "تمييز",
  ACC_SPECIF: "تمييز",
  COND: "شرط",
  APPOS: "بدل",
  LINK: "صلة",
  HAL: "حال",
  CIRCUM: "حال",
  EMPHATIC: "توكيد",
  EXCEPT: "استثناء",
  EXCP: "استثناء",
  PASS_SUBJ: "نائب فاعل",
  KANA_PRED: "خبر كان",
  KANA_SUBJ: "اسم كان",
  INNA_PRED: "خبر إنّ",
  INNA_SUBJ: "اسم إنّ",
  IMPV: "أمر",
  COGN: "مفعول مطلق",
  SUBS_COG_ACC: "مفعول مطلق نائب",
  COMPL: "تتمة",
  COMIT: "مفعول معه",
  PURP: "مفعول لأجله",
  EXPLET: "زائد",
  SUBJ_COP_PART: "اسم الحرف الناسخ",
  SUBJ_COP_V: "اسم الفعل الناسخ",
  PART_COP_PRED: "خبر الحرف الناسخ",
  V_COP_PRED: "خبر الفعل الناسخ",
  SUBJ_DELA: "مبتدأ مؤخر",
  SUBJ_NEG_CAT: "اسم لا النافية للجنس",
  PART_INTERROG: "أداة استفهام",
  PART_PREV: "حرف مصدري",
  SUBOR_CONJ: "حرف مصدري",
  SUBOR_ANN_CONJ: "أنّ المصدرية",
};

// Merge MASAQ labels (don't override existing)
for (const [code, label] of Object.entries(masaqLabels)) {
  if (!labelMap[code]) {
    labelMap[code] = label;
  }
}

/**
 * Decode a single code to its Arabic label.
 * Returns the original code if no label found.
 */
export function decodeLabel(code: string): string {
  return labelMap[code] ?? code;
}

/**
 * Decode a pipe-separated or comma-separated compound tag.
 * MASAQ stores morphological tags like "DET|NOUN_PROP" and
 * syntactic functions like "PREP|PREP_OBJ".
 * GROUP_CONCAT joins multiple segments with commas.
 */
export function decodeLabelList(codes: string | null): string {
  if (!codes) return "";

  // First split by comma (GROUP_CONCAT separator)
  const groups = codes.split(",").map((g) => g.trim());
  const decoded: string[] = [];

  for (const group of groups) {
    // Split each group by pipe (MASAQ component separator)
    const parts = group.split("|");
    const partLabels = parts.map((p) => decodeLabel(p.trim()));
    decoded.push(partLabels.join(" + "));
  }

  return decoded.join(" / ");
}

/**
 * Get verb form Arabic name by form number (1-11 for triliteral, 1-4 for quadriliteral).
 * formStr is like "(I)", "(II)", "(IV)" etc.
 */
export function getVerbFormName(formStr: string | null): string | null {
  if (!formStr) return null;
  const match = formStr.match(/\(([IVX]+)\)/);
  if (!match) return formStr;

  const romanToIndex: Record<string, number> = {
    I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5,
    VII: 6, VIII: 7, IX: 8, X: 9, XI: 10,
  };
  const idx = romanToIndex[match[1]];
  if (idx !== undefined && termsData.verb_forms_tri?.[idx]) {
    return termsData.verb_forms_tri[idx];
  }
  return formStr;
}
