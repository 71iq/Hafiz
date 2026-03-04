// Static require() map for bundled translation JSON files.
// Metro bundler needs static string literals — cannot use dynamic require().

export const translationRequires: Record<string, any> = {
  id: require("../../assets/data/translations/id.json"),
  bn: require("../../assets/data/translations/bn.json"),
  ur: require("../../assets/data/translations/ur.json"),
  fa: require("../../assets/data/translations/fa.json"),
  hi: require("../../assets/data/translations/hi.json"),
  tr: require("../../assets/data/translations/tr.json"),
  ha: require("../../assets/data/translations/ha.json"),
  fr: require("../../assets/data/translations/fr.json"),
  ps: require("../../assets/data/translations/ps.json"),
  sd: require("../../assets/data/translations/sd.json"),
  ru: require("../../assets/data/translations/ru.json"),
  ku: require("../../assets/data/translations/ku.json"),
  uz: require("../../assets/data/translations/uz.json"),
  sw: require("../../assets/data/translations/sw.json"),
  om: require("../../assets/data/translations/om.json"),
  am: require("../../assets/data/translations/am.json"),
  so: require("../../assets/data/translations/so.json"),
  az: require("../../assets/data/translations/az.json"),
  kk: require("../../assets/data/translations/kk.json"),
  ber: require("../../assets/data/translations/ber.json"),
};
