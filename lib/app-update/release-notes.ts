/**
 * Bundled What's new notes, keyed by the app version they ship in. A build shows only the notes for
 * its own version and nothing is fetched. Each entry has at most three short, accurate bullets about
 * changes present in that build. Missing notes show "No release notes for this version".
 */
type ReleaseNotes = Readonly<{ en: readonly string[]; ar: readonly string[] }>;

export const MAX_RELEASE_NOTE_BULLETS = 3;

export const BUNDLED_RELEASE_NOTES: Readonly<Record<string, ReleaseNotes>> = {
  "1.0.2": {
    en: [
      "Join the weekly consistency Board, an optional small group ranked by wird days.",
      "Progress and your profile show the same figures, including your current consistency.",
      "Many fixes for review, grading and sheets on Android phones.",
    ],
    ar: [
      "انضم إلى لوحة المواظبة الأسبوعية، وهي مجموعة صغيرة اختيارية مرتبة بحسب أيام الوِرد.",
      "يعرض التقدم وملفك الشخصي الأرقام نفسها، ومنها مواظبتك الحالية.",
      "إصلاحات كثيرة للمراجعة والتقييم والنوافذ على هواتف أندرويد.",
    ],
  },
  "1.0.1": {
    en: [
      "Phones now have four main tabs: Home, Mushaf, Progress and Settings.",
      "Before an account replaces study data on this device, Hafiz asks first. You can pause sync and resume it later.",
      "The player bar works for every recitation and can follow along in the reader.",
    ],
    ar: [
      "أصبحت للهاتف أربعة تبويبات رئيسية: الرئيسية والمصحف والتقدم والإعدادات.",
      "يسألك حافظ قبل أن يستبدل الحساب بيانات الدراسة على هذا الجهاز. ويمكنك إيقاف المزامنة مؤقتًا واستئنافها لاحقًا.",
      "يعمل شريط التشغيل مع كل تلاوة، ويمكنه متابعة القراءة في المصحف.",
    ],
  },
};

export function releaseNotesFor(version: string | null, language: "en" | "ar"): readonly string[] | null {
  if (!version) return null;
  const notes = BUNDLED_RELEASE_NOTES[version];
  const bullets = notes?.[language].slice(0, MAX_RELEASE_NOTE_BULLETS);
  return bullets && bullets.length > 0 ? bullets : null;
}
