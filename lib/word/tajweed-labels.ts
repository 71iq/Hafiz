import { qpcV4TajweedPaletteColor } from "@/lib/fonts/loader";

export type TajweedRuleInfo = {
  arabic: string;
  english: string;
  color: string;
  description: string;
};

const QPC_V4_TAJWEED_RULE_COLOR_INDEX: Record<string, number> = {
  ghunnah: 6,
  ikhfaa: 6,
  ikhfa: 6,
  idghaam_ghunnah: 6,
  idghaam_shafawi: 6,
  ikhfaa_shafawi: 6,
  ikhfa_shafawi: 6,
  iqlab: 6,
  idghaam_no_ghunnah: 7,
  idghaam_mutamaathilayn: 7,
  idghaam_mutaqaaribayn: 7,
  idghaam_mutaqaribayn: 7,
  idghaam_mutajaanisayn: 7,
  idghaam_mutajanisayn: 7,
  hamzat_wasl: 7,
  lam_shamsiyyah: 7,
  silent: 7,
  qalqalah: 8,
  madd_6: 3,
  madd_246: 4,
  madd_2: 5,
  madd_munfasil: 9,
  madd_muttasil: 9,
  lpieces_spieces: 11,
};

function getTajweedRuleColor(ruleId: string, theme: string): string {
  return qpcV4TajweedPaletteColor(theme, QPC_V4_TAJWEED_RULE_COLOR_INDEX[ruleId] ?? 1);
}

const TAJWEED_RULES: Record<string, TajweedRuleInfo> = {
  ghunnah: {
    arabic: "غنّة",
    english: "Ghunnah",
    color: getTajweedRuleColor("ghunnah", "white"),
    description: "Nasal sound held for two counts",
  },
  ikhfaa: {
    arabic: "إخفاء",
    english: "Ikhfa",
    color: getTajweedRuleColor("ikhfaa", "white"),
    description: "Hiding of noon sakinah/tanween before specific letters",
  },
  ikhfa: {
    arabic: "إخفاء",
    english: "Ikhfa",
    color: getTajweedRuleColor("ikhfa", "white"),
    description: "Hiding of noon sakinah/tanween before specific letters",
  },
  idghaam_ghunnah: {
    arabic: "إدغام بغنّة",
    english: "Idgham with Ghunnah",
    color: getTajweedRuleColor("idghaam_ghunnah", "white"),
    description: "Merging with nasal sound into ي ن م و",
  },
  idghaam_no_ghunnah: {
    arabic: "إدغام بلا غنّة",
    english: "Idgham without Ghunnah",
    color: getTajweedRuleColor("idghaam_no_ghunnah", "white"),
    description: "Merging without nasal sound into ل ر",
  },
  iqlab: {
    arabic: "إقلاب",
    english: "Iqlab",
    color: getTajweedRuleColor("iqlab", "white"),
    description: "Changing noon sakinah/tanween to meem before ب",
  },
  qalqalah: {
    arabic: "قلقلة",
    english: "Qalqalah",
    color: getTajweedRuleColor("qalqalah", "white"),
    description: "Echoing sound on sukoon letters ق ط ب ج د",
  },
  madd_2: {
    arabic: "مد طبيعي",
    english: "Natural Madd",
    color: getTajweedRuleColor("madd_2", "white"),
    description: "Natural prolongation of 2 counts",
  },
  madd_6: {
    arabic: "مد لازم",
    english: "Obligatory Madd",
    color: getTajweedRuleColor("madd_6", "white"),
    description: "Obligatory prolongation of 6 counts",
  },
  madd_246: {
    arabic: "مد جائز",
    english: "Permissible Madd",
    color: getTajweedRuleColor("madd_246", "white"),
    description: "Permissible prolongation of 2, 4, or 6 counts",
  },
  madd_munfasil: {
    arabic: "مد منفصل",
    english: "Separated Madd",
    color: getTajweedRuleColor("madd_munfasil", "white"),
    description: "Prolongation when hamza is in the next word",
  },
  madd_muttasil: {
    arabic: "مد متصل",
    english: "Connected Madd",
    color: getTajweedRuleColor("madd_muttasil", "white"),
    description: "Obligatory prolongation when hamza follows in same word",
  },
  ikhfaa_shafawi: {
    arabic: "إخفاء شفوي",
    english: "Ikhfa Shafawi",
    color: getTajweedRuleColor("ikhfaa_shafawi", "white"),
    description: "Hiding of meem sakinah before ب",
  },
  ikhfa_shafawi: {
    arabic: "إخفاء شفوي",
    english: "Ikhfa Shafawi",
    color: getTajweedRuleColor("ikhfa_shafawi", "white"),
    description: "Hiding of meem sakinah before ب",
  },
  idghaam_shafawi: {
    arabic: "إدغام شفوي",
    english: "Idgham Shafawi",
    color: getTajweedRuleColor("idghaam_shafawi", "white"),
    description: "Merging of meem sakinah into meem",
  },
  idghaam_mutamaathilayn: {
    arabic: "إدغام متماثلين",
    english: "Idgham Mutamaathilayn",
    color: getTajweedRuleColor("idghaam_mutamaathilayn", "white"),
    description: "Merging of two identical letters",
  },
  idghaam_mutaqaaribayn: {
    arabic: "إدغام متقاربين",
    english: "Idgham Mutaqaaribayn",
    color: getTajweedRuleColor("idghaam_mutaqaaribayn", "white"),
    description: "Merging of two similar-sounding letters",
  },
  idghaam_mutaqaribayn: {
    arabic: "إدغام متقاربين",
    english: "Idgham Mutaqaribayn",
    color: getTajweedRuleColor("idghaam_mutaqaribayn", "white"),
    description: "Merging of two similar-sounding letters",
  },
  idghaam_mutajaanisayn: {
    arabic: "إدغام متجانسين",
    english: "Idgham Mutajaanisayn",
    color: getTajweedRuleColor("idghaam_mutajaanisayn", "white"),
    description: "Merging of letters sharing the same articulation point",
  },
  idghaam_mutajanisayn: {
    arabic: "إدغام متجانسين",
    english: "Idgham Mutajanisayn",
    color: getTajweedRuleColor("idghaam_mutajanisayn", "white"),
    description: "Merging of letters sharing the same articulation point",
  },
  hamzat_wasl: {
    arabic: "همزة وصل",
    english: "Hamzat Al-Wasl",
    color: getTajweedRuleColor("hamzat_wasl", "white"),
    description: "Connecting hamza that is silent when preceded by another word",
  },
  lam_shamsiyyah: {
    arabic: "اللام الشمسية",
    english: "Lam Shamsiyyah",
    color: getTajweedRuleColor("lam_shamsiyyah", "white"),
    description: "Sun letter assimilation — the lam of al- is silent before sun letters",
  },
  lpieces_spieces: {
    arabic: "حروف مقطّعة",
    english: "Disconnected Letters",
    color: getTajweedRuleColor("lpieces_spieces", "white"),
    description: "Letters at the beginning of some surahs",
  },
  silent: {
    arabic: "حرف ساكن",
    english: "Silent",
    color: getTajweedRuleColor("silent", "white"),
    description: "Silent letter not pronounced",
  },
};

/**
 * Get tajweed rule info by rule ID.
 * Returns a fallback if the rule is unknown.
 */
export function getTajweedRule(ruleId: string, theme = "white"): TajweedRuleInfo {
  const rule =
    TAJWEED_RULES[ruleId] ?? {
      arabic: ruleId,
      english: ruleId,
      color: getTajweedRuleColor(ruleId, theme),
      description: "",
    };

  return {
    ...rule,
    color: getTajweedRuleColor(ruleId, theme),
  };
}
