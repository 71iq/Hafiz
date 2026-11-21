/**
 * Bundled What's new notes, keyed by the app version they ship in. A build shows only the notes for
 * its own version and nothing is fetched. Each entry has at most three short, accurate bullets about
 * changes present in that build. Missing notes show "No release notes for this version".
 */
type ReleaseNotes = Readonly<{ en: readonly string[]; ar: readonly string[] }>;

export const MAX_RELEASE_NOTE_BULLETS = 3;

export const BUNDLED_RELEASE_NOTES: Readonly<Record<string, ReleaseNotes>> = {
  "1.0.9": {
    en: [
      "Zayt now appears on both the small streak widget and the larger wird widget, with a different pose for each stage of your day.",
      "When you reach a streak milestone and return to your home screen, Zayt does a short turn. Reduced motion shows a still pose.",
    ],
    ar: [
      "يظهر زيت الآن في أداة السلسلة الصغيرة وأداة الوِرد الكبيرة، ويتغيّر مظهره بحسب حالة وِردك.",
      "عندما تبلغ محطة في سلسلتك وتعود إلى الشاشة الرئيسية، يدور زيت دورة قصيرة. وإذا فعّلت تقليل الحركة، يظهر بصورة ثابتة.",
    ],
  },
  "1.0.8": {
    en: [
      "With the back, home and recent apps buttons, the bar at the bottom now matches the page instead of showing a shaded band.",
    ],
    ar: ["عند استخدام أزرار الرجوع والرئيسية والتطبيقات الأخيرة، يطابق الشريط السفلي لون الصفحة بدل ظهور شريط مظلّل."],
  },
  "1.0.7": {
    en: [
      "Hafiz no longer requests camera, microphone or draw-over-other-apps permissions.",
      "Restoring Hafiz from a phone backup no longer restores your sign-in. Sign in again to sync your progress.",
      "The weekly consistency Board is hidden until more people use Hafiz.",
    ],
    ar: [
      "لم يعد حافظ يطلب أذونات الكاميرا أو الميكروفون أو الظهور فوق التطبيقات الأخرى.",
      "لم تعد استعادة حافظ من نسخة احتياطية للهاتف تستعيد تسجيل دخولك. سجّل الدخول مجددًا لمزامنة تقدّمك.",
      "أُخفيت لوحة المواظبة الأسبوعية حتى يزداد عدد مستخدمي حافظ.",
    ],
  },
  "1.0.6": {
    en: [
      "Hafiz is now about a third of its previous download size.",
      "The Mushaf opens in the Modern font, in dark themes too. To read in Classic, download it once from Settings.",
      "Al-Muyassar and Fi Zilal are included. Other tafsirs download when you choose them and then work offline.",
    ],
    ar: [
      "أصبح حجم تنزيل حافظ نحو ثلث حجمه السابق.",
      "يفتح المصحف بالخط الحديث، وفي المظهر الداكن أيضًا. للقراءة بالخط التقليدي نزّله مرة واحدة من الإعدادات.",
      "التفسير الميسر وفي ظلال القرآن مضمّنان. تُنزَّل التفاسير الأخرى عند اختيارها ثم تعمل دون اتصال.",
    ],
  },
  "1.0.5": {
    en: [
      "Add the Hafiz widget to your Android home screen to see your streak and today's wird.",
      "The widget follows your language, theme and Show Zayt, and keeps up with the day without opening Hafiz.",
      "Turn off Show numbers on the widget in Settings to keep your streak private.",
    ],
    ar: [
      "أضف أداة حافظ إلى شاشتك الرئيسية في أندرويد لترى سلسلتك ووِرد اليوم.",
      "تتبع الأداة لغتك ومظهرك وإعداد إظهار زيت، وتواكب يومك دون فتح حافظ.",
      "أوقف «إظهار الأرقام في الأداة» من الإعدادات لتبقى سلسلتك خاصة.",
    ],
  },
  "1.0.4": {
    en: [
      "Zayt, a drop of olive oil, now marks the end of a session with a short, calm animation.",
      "Zayt waves when you return after a week away and lights up when you complete a juz. Turn it off in Settings, under Wird.",
      "Without a photo, your profile shows the first letter of your name instead of Zayt.",
    ],
    ar: [
      "يختم زيت، قطرة زيت الزيتون، الجلسة الآن بحركة قصيرة هادئة.",
      "يلوّح زيت حين تعود بعد غياب أسبوع، ويضيء حين تُتمّ جزءًا. يمكنك إخفاؤه من الإعدادات، في قسم الوِرد.",
      "إن لم تكن لديك صورة، يعرض ملفك الحرف الأول من اسمك بدل زيت.",
    ],
  },
  "1.0.3": {
    en: [
      "Updates now download and install inside the app, and can download on their own over Wi-Fi.",
      "Privacy and sharing in Settings sets what your profile shows.",
      "Halaqa groups are paused for now. The weekly consistency Board stays.",
    ],
    ar: [
      "تُنزَّل التحديثات الآن وتُثبَّت من داخل التطبيق، ويمكن أن تُنزَّل تلقائيًا عبر الواي فاي.",
      "تحدد «الخصوصية والمشاركة» في الإعدادات ما يظهر في ملفك.",
      "الحلقات متوقفة مؤقتًا، وتبقى لوحة المواظبة الأسبوعية.",
    ],
  },
  "1.0.2": {
    en: [
      "Study with a Halaqa group and see the weekly consistency Board.",
      "Progress and your profile show the same figures, including your current consistency.",
      "Many fixes for review, grading and sheets on Android phones.",
    ],
    ar: [
      "ادرس مع الحلقة وتابع لوحة المواظبة الأسبوعية.",
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
