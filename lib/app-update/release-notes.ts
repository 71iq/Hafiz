/**
 * Bundled What's new notes, keyed by the app version they ship in. A build shows only the notes for
 * its own version and nothing is fetched. Each entry has at most three short, accurate bullets about
 * changes present in that build. Missing notes show "No release notes for this version".
 */
type ReleaseNotes = Readonly<{ en: readonly string[]; ar: readonly string[] }>;

export const MAX_RELEASE_NOTE_BULLETS = 3;

export const BUNDLED_RELEASE_NOTES: Readonly<Record<string, ReleaseNotes>> = {
  "1.0.19": {
    en: [
      "During memorization, Check reveals only the ayahs you were asked to recite. The linking step also shows the preceding ayahs.",
      "Ending a review early shows the pages you finished. After a mistake drill, you can see which spots still need work.",
      "You can schedule an excused day up to 30 days ahead. If your local progress changes during account restore, Hafiz asks you to confirm again before replacing it.",
    ],
    ar: [
      "أثناء الحفظ، يكشف زر التحقق الآيات المطلوب تسميعها فقط. وتعرض خطوة الربط أيضًا الآيات السابقة للمقطع.",
      "إذا أنهيت المراجعة مبكرًا، يظهر لك عدد الصفحات التي راجعتها. وبعد التدريب على الأخطاء، ترى المواضع التي ما زالت تحتاج إلى تثبيت.",
      "يمكنك تسجيل يوم عذر قبل موعده بما يصل إلى ٣٠ يومًا. وإذا تغيّر تقدّمك على الجهاز أثناء استعادة بيانات الحساب، يطلب منك حافظ التأكيد مجددًا قبل استبداله.",
    ],
  },
  "1.0.18": {
    en: [
      "Home has one Study button for today's work, and your widget opens the same. Other decks are under All decks, and Study more goes past the day's cards.",
      "Word meanings are part of daily study, with a short level check during setup.",
      "Mutashabihat and Similar tails cards hide only what you need to recall. A card that shows a whole ayah asks for the next one.",
    ],
    ar: [
      "في الصفحة الرئيسية زر دراسة واحد يفتح عمل اليوم، والأداة تفتحه أيضًا. وبقية المجموعات تحت «كل المجموعات»، ويتيح «ادرس المزيد» تجاوز بطاقات اليوم.",
      "صارت معاني الكلمات جزءًا من الدراسة اليومية، مع اختبار قصير لتحديد المستوى أثناء الإعداد.",
      "تخفي بطاقات المتشابهات والخواتيم المتشابهة ما عليك تذكّره فقط، والبطاقة التي تعرض آية كاملة تسألك عن الآية التالية.",
    ],
  },
  "1.0.17": {
    en: [
      "Setup starts on a lighter pace with fewer cards, shows the juz and surahs you chose at the top, and can add an optional second sitting for review.",
      "Deck rows show today's new, learning and review cards, and Continue reading opens the page you were on.",
      "Arabic screens align to the right, and the sign-in and sign-up fields are simpler.",
    ],
    ar: [
      "يبدأ الإعداد بوتيرة أخف وبطاقات أقل، ويعرض الأجزاء والسور التي اخترتها في الأعلى، ويمكنك إضافة جلسة ثانية للمراجعة.",
      "تعرض المجموعات بطاقات اليوم الجديدة وقيد التعلم والمراجعة، ويفتح «متابعة القراءة» الصفحة التي توقفت عندها.",
      "تحاذي الشاشات العربية جهة اليمين، وصارت حقول تسجيل الدخول وإنشاء الحساب أبسط.",
    ],
  },
  "1.0.16": {
    en: ["Memorization stages use plain names in English: New, Recent and Long-term."],
    ar: ["تستخدم الواجهة الإنجليزية أسماء واضحة لمراحل الحفظ: جديد وقريب وبعيد. ولم تتغير الواجهة العربية."],
  },
  "1.0.15": {
    en: [
      "Next and Previous step through every word in Word Detail.",
      "Card menus take keyboard focus and return it when you close them.",
      "Screen readers announce word review save buttons and deck tabs. Ayah marker color choices appear on web.",
    ],
    ar: [
      "ينتقل زرّا التالي والسابق بين جميع الكلمات في تفاصيل الكلمة.",
      "ينتقل تركيز لوحة المفاتيح إلى قوائم البطاقات ويعود إلى زر فتحها عند إغلاقها.",
      "تعلن قارئات الشاشة أزرار حفظ الكلمات وتبويبات المجموعات. وتظهر خيارات لون علامات الآيات على الويب.",
    ],
  },
  "1.0.14": {
    en: [
      "Screen readers can read fully visible ayahs in the Mushaf and Ayah Detail. Hidden ayahs stay hidden during recall.",
      "Reciter preview buttons include the recording style when available.",
    ],
    ar: [
      "تستطيع قارئات الشاشة قراءة الآيات الظاهرة بالكامل في المصحف وتفاصيل الآية. وتبقى الآيات المخفية محجوبة أثناء الاستظهار.",
      "تذكر أزرار تجربة أصوات القراء نمط التلاوة عند توفره.",
    ],
  },
  "1.0.13": {
    en: [
      "The Clear and Cancel buttons in Quran search stay separate on narrow screens.",
      "Screen readers can read the Quran text shown on review cards and in memorization sessions.",
      "The app explains what optional sync does. The privacy policy explains that sync includes the text of private notes.",
    ],
    ar: [
      "يظل زرّا المسح والإلغاء منفصلين في البحث في القرآن على الشاشات الضيقة.",
      "تستطيع قارئات الشاشة قراءة النص القرآني الظاهر في بطاقات المراجعة وجلسات الحفظ.",
      "يوضح التطبيق ما تفعله المزامنة الاختيارية، وتوضح سياسة الخصوصية أن المزامنة تشمل نص الملاحظات الخاصة.",
    ],
  },
  "1.0.12": {
    en: [
      "Your home-screen widget shows your streak beside a flame, including zero. Zayt is larger, and tall widgets show all seven days along the bottom.",
      "As time runs short, the sky changes and Zayt looks more worried. Finish your wird to light the flame and see Zayt celebrate.",
    ],
    ar: [
      "تعرض أداة الشاشة الرئيسية عدد أيام سلسلتك بجوار شعلة، حتى عندما يكون العدد صفرًا. يظهر زيت بحجم أكبر، وتظهر أيام الأسبوع السبعة أسفل الأداة الطويلة.",
      "كلما قلّ الوقت المتبقي لوِردك، تتغيّر السماء وملامح زيت. وعندما تُتمّ وِردك تضيء الشعلة ويحتفل زيت.",
    ],
  },
  "1.0.11": {
    en: ["Mushaf pages show the full dots and hamza at the edges of words. Surah headings show all four words of the Basmala."],
    ar: ["تظهر نقاط الحروف والهمزة كاملة عند أطراف الكلمات في صفحات المصحف، وتظهر البسملة بكلماتها الأربع في مطلع السورة."],
  },
  "1.0.10": {
    en: ["Quran search matches punctuation exactly as you type it."],
    ar: ["يطابق البحث في القرآن علامات الترقيم كما تكتبها."],
  },
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
