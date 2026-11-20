/**
 * W01 foundations: settings controls, startup and device preferences. Spread into lib/i18n/strings.ts. Keep English and Arabic keys in parity.
 */
export const foundationStrings = {
  en: {
    classicDownloadAction: "Download Classic",
    classicDownloadRetry: "Retry Classic",
    classicDownloadHint: "Modern is included. Download all 604 Classic pages once to use them offline (up to 208 MB).",
    classicDownloadProgress: "Downloading Classic pages: {pages} / 604.",
    classicDownloadFailed: "Classic could not finish downloading. Check your connection or available storage and retry.",
    quranFontChoiceHint:
      "Classic uses the traditional Mushaf page font. Modern uses the newer page font and supports Tajweed colors.",
    quranTajweedHint: "Colors each Tajweed rule. Uses the Modern font.",
    vibrationLabel: "Vibration",
    vibrationHint: "A light vibration when you bookmark, like or grade a card.",
  },
  ar: {
    classicDownloadAction: "تنزيل التقليدي",
    classicDownloadRetry: "إعادة تنزيل التقليدي",
    classicDownloadHint: "الخط الحديث مضمّن. نزّل صفحات الخط التقليدي الـ604 مرة واحدة لاستخدامها دون اتصال (حتى 208 م.ب.).",
    classicDownloadProgress: "جارٍ تنزيل صفحات الخط التقليدي: {pages} / 604.",
    classicDownloadFailed: "تعذّر إكمال تنزيل الخط التقليدي. تحقّق من الاتصال ومساحة التخزين ثم أعد المحاولة.",
    quranFontChoiceHint:
      "الكلاسيكي يستخدم خط صفحات المصحف التقليدي، والحديث يستخدم خط الصفحات الأحدث ويدعم ألوان التجويد.",
    quranTajweedHint: "يلوّن أحكام التجويد. يستخدم الخط الحديث.",
    vibrationLabel: "الاهتزاز",
    vibrationHint: "اهتزاز خفيف عند حفظ إشارة أو الإعجاب أو تقييم بطاقة.",
  },
} as const;
