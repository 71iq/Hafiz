/**
 * Static map of tajweed rule IDs to Arabic names, English names, and display colors.
 * Rule IDs match the `rule` column in the tajweed_rules table.
 */

export type TajweedRuleInfo = {
  arabic: string;
  english: string;
  color: string;
  description: string;
};

export const TAJWEED_RULES: Record<string, TajweedRuleInfo> = {
  ghunnah: {
    arabic: "غنّة",
    english: "Ghunnah",
    color: "#FF7F50",
    description: "Nasal sound held for two counts",
  },
  ikhfaa: {
    arabic: "إخفاء",
    english: "Ikhfa",
    color: "#D2691E",
    description: "Hiding of noon sakinah/tanween before specific letters",
  },
  idghaam_ghunnah: {
    arabic: "إدغام بغنّة",
    english: "Idgham with Ghunnah",
    color: "#4169E1",
    description: "Merging with nasal sound into ي ن م و",
  },
  idghaam_no_ghunnah: {
    arabic: "إدغام بلا غنّة",
    english: "Idgham without Ghunnah",
    color: "#6A5ACD",
    description: "Merging without nasal sound into ل ر",
  },
  iqlab: {
    arabic: "إقلاب",
    english: "Iqlab",
    color: "#2E8B57",
    description: "Changing noon sakinah/tanween to meem before ب",
  },
  qalqalah: {
    arabic: "قلقلة",
    english: "Qalqalah",
    color: "#CD5C5C",
    description: "Echoing sound on sukoon letters ق ط ب ج د",
  },
  madd_2: {
    arabic: "مد طبيعي",
    english: "Natural Madd",
    color: "#9370DB",
    description: "Natural prolongation of 2 counts",
  },
  madd_6: {
    arabic: "مد لازم",
    english: "Obligatory Madd",
    color: "#B22222",
    description: "Obligatory prolongation of 6 counts",
  },
  madd_246: {
    arabic: "مد جائز",
    english: "Permissible Madd",
    color: "#DAA520",
    description: "Permissible prolongation of 2, 4, or 6 counts",
  },
  madd_munfasil: {
    arabic: "مد منفصل",
    english: "Separated Madd",
    color: "#DAA520",
    description: "Prolongation when hamza is in the next word",
  },
  madd_muttasil: {
    arabic: "مد متصل",
    english: "Connected Madd",
    color: "#DC143C",
    description: "Obligatory prolongation when hamza follows in same word",
  },
  ikhfaa_shafawi: {
    arabic: "إخفاء شفوي",
    english: "Ikhfa Shafawi",
    color: "#20B2AA",
    description: "Hiding of meem sakinah before ب",
  },
  idghaam_shafawi: {
    arabic: "إدغام شفوي",
    english: "Idgham Shafawi",
    color: "#4682B4",
    description: "Merging of meem sakinah into meem",
  },
  idghaam_mutamaathilayn: {
    arabic: "إدغام متماثلين",
    english: "Idgham Mutamaathilayn",
    color: "#5F9EA0",
    description: "Merging of two identical letters",
  },
  idghaam_mutaqaaribayn: {
    arabic: "إدغام متقاربين",
    english: "Idgham Mutaqaaribayn",
    color: "#708090",
    description: "Merging of two similar-sounding letters",
  },
  idghaam_mutaqaribayn: {
    arabic: "إدغام متقاربين",
    english: "Idgham Mutaqaribayn",
    color: "#708090",
    description: "Merging of two similar-sounding letters",
  },
  idghaam_mutajaanisayn: {
    arabic: "إدغام متجانسين",
    english: "Idgham Mutajaanisayn",
    color: "#778899",
    description: "Merging of letters sharing the same articulation point",
  },
  idghaam_mutajanisayn: {
    arabic: "إدغام متجانسين",
    english: "Idgham Mutajanisayn",
    color: "#778899",
    description: "Merging of letters sharing the same articulation point",
  },
  hamzat_wasl: {
    arabic: "همزة وصل",
    english: "Hamzat Al-Wasl",
    color: "#808000",
    description: "Connecting hamza that is silent when preceded by another word",
  },
  lam_shamsiyyah: {
    arabic: "اللام الشمسية",
    english: "Lam Shamsiyyah",
    color: "#FF8C00",
    description: "Sun letter assimilation — the lam of al- is silent before sun letters",
  },
  lpieces_spieces: {
    arabic: "حروف مقطّعة",
    english: "Disconnected Letters",
    color: "#800080",
    description: "Letters at the beginning of some surahs",
  },
  silent: {
    arabic: "حرف ساكن",
    english: "Silent",
    color: "#A9A9A9",
    description: "Silent letter not pronounced",
  },
};

/**
 * Get tajweed rule info by rule ID.
 * Returns a fallback if the rule is unknown.
 */
export function getTajweedRule(ruleId: string): TajweedRuleInfo {
  return (
    TAJWEED_RULES[ruleId] ?? {
      arabic: ruleId,
      english: ruleId,
      color: "#888888",
      description: "",
    }
  );
}
