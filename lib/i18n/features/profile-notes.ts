/**
 * W12 profile and private notes. Spread into lib/i18n/strings.ts. Keep English and Arabic keys in parity.
 */
export const profileNotesStrings = {
  en: {
    profileCurrentConsistency: "Current consistency",
    profileStatsAwaitingSync: "Local figures, awaiting sync",
    profileStatsAwaitingSyncBody:
      "Sync is paused, so these figures come from this device only. They are not your account's synced progress.",
    profileGuestActivityTitle: "On this device",
    profileBadgesViewAll: "View all",
    profileLoadFailed: "Could not load this profile",
    profileLoadingLabel: "Loading profile",
    profilePhotoInvalidType: "Choose a JPEG, PNG, WebP or GIF image.",
    profilePhotoTooLarge: "Choose an image of 3 MB or less.",
    profilePhotoUnreadable: "This image could not be read. Choose another one.",
    profileCountryListTitle: "Country",
    notesLoadFailed: "Could not load notes",
    notesRetry: "Retry",
    notesDeleteFailed: "Could not delete note",
    notesSearchOpen: "Search notes",
    notesSortLabel: "Sort notes",
    notesSortRecent: "Recently edited",
    notesSortSurah: "Surah order",
  },
  ar: {
    profileCurrentConsistency: "المواظبة الحالية",
    profileStatsAwaitingSync: "أرقام محلية بانتظار المزامنة",
    profileStatsAwaitingSyncBody:
      "المزامنة متوقفة مؤقتًا، فهذه الأرقام من هذا الجهاز فقط، وليست تقدم حسابك بعد المزامنة.",
    profileGuestActivityTitle: "على هذا الجهاز",
    profileBadgesViewAll: "عرض الكل",
    profileLoadFailed: "تعذر تحميل هذا الملف",
    profileLoadingLabel: "جارٍ تحميل الملف",
    profilePhotoInvalidType: "اختر صورة بصيغة JPEG أو PNG أو WebP أو GIF.",
    profilePhotoTooLarge: "اختر صورة لا يتجاوز حجمها ٣ ميغابايت.",
    profilePhotoUnreadable: "تعذرت قراءة هذه الصورة. اختر صورة أخرى.",
    profileCountryListTitle: "البلد",
    notesLoadFailed: "تعذر تحميل الملاحظات",
    notesRetry: "إعادة المحاولة",
    notesDeleteFailed: "تعذر حذف الملاحظة",
    notesSearchOpen: "البحث في الملاحظات",
    notesSortLabel: "ترتيب الملاحظات",
    notesSortRecent: "آخر تعديل",
    notesSortSurah: "ترتيب السور",
  },
} as const;
