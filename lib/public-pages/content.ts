export type PublicPageLanguage = "en" | "ar";
export type PublicPageKey = "about" | "privacy" | "terms" | "credits";

export type PublicPageLink = {
  label: string;
  href: string;
  external?: boolean;
};

export type PublicPageSection = {
  id: string;
  title: string;
  body?: string[];
  bullets?: string[];
  links?: PublicPageLink[];
};

export type PublicPageContent = {
  tabLabel: string;
  eyebrow?: string;
  title: string;
  description: string;
  lastUpdated?: string;
  sections: PublicPageSection[];
};

export const PUBLIC_PAGE_FROM_SETTINGS = "settings";

export const TABLE_OF_CONTENTS_MIN_SECTIONS = 4;

const CREDIT_LINES_EN = [
  "Word meanings: quran-words.com",
  "I'rab: al-Da'as via qul.tarteel.ai",
  "Qira'at: Qur'anic Encyclopedia via qul.tarteel.ai",
  "Reasons of revelation: mostafaahmed97/asbab-al-nuzul-dataset (MIT)",
  "Tafsir al-Tahrir wa al-Tanwir: QUL / Tarteel AI",
  "Tafsir Al Qurtubi: QUL / Tarteel AI",
  "Al-Kashshaf Al-Zamakhshari: QUL / Tarteel AI",
  "Tafsir Al-Alusi: QUL / Tarteel AI",
  "Nazam Al-Durar Al-Biqa'i: QUL / Tarteel AI",
  "Tafsir Al-Razi: QUL / Tarteel AI",
  "Al-Bahr Al-Madid: Quranpedia book 206",
  "Tafsir Jalalayn: QUL / Tarteel AI",
  "Tafsir Al Jalalayn - English: QUL / Tarteel AI",
  "Bridges translation: Fadel Soliman via QUL / Tarteel AI",
  "Mutashabihat and similar ayah tails: NourQuran.com.",
  "Surah information: Sayyid Abul Ala Maududi - Tafhim al-Qur'an - The Meaning of the Quran",
  "Tajweed markings: cpfair/quran-tajweed (CC BY 4.0)",
  "Tajweed descriptions: adapted from educational sources",
];

const CREDIT_LINES_AR = [
  "معاني كلمات القرآن (quran-words.com)",
  "إعراب القرآن - الدعاس (qul.tarteel.ai)",
  "الموسوعة القرآنية في القراءات (qul.tarteel.ai)",
  "أسباب النزول: mostafaahmed97/asbab-al-nuzul-dataset (MIT)",
  "تفسير التحرير والتنوير: QUL / Tarteel AI",
  "تفسير القرطبي: QUL / Tarteel AI",
  "الكشاف للزمخشري: QUL / Tarteel AI",
  "تفسير الألوسي: QUL / Tarteel AI",
  "نظم الدرر للبقاعي: QUL / Tarteel AI",
  "تفسير الرازي: QUL / Tarteel AI",
  "البحر المديد: Quranpedia (كتاب 206)",
  "تفسير الجلالين: QUL / Tarteel AI",
  "تفسير الجلالين بالإنجليزية: QUL / Tarteel AI",
  "ترجمة Bridges: فاضل سليمان عبر QUL / Tarteel AI",
  "المتشابهات وخواتيم الآيات: موقع نور قرآن NourQuran.com (بإذن مسبق).",
  "معلومات السور: سيد أبو الأعلى المودودي - تفهيم القرآن - The Meaning of the Quran",
  "علامات التجويد (cpfair/quran-tajweed، CC BY 4.0)",
  "شرح أحكام التجويد - بتصرف من مصادر تعليمية متعددة",
];

const NOTICE_LICENSE_EN = [
  "The Hafiz source code and project documentation are licensed under the MIT License unless a file says otherwise.",
  "Bundled Quran text, fonts, translations, tafsir, tajweed, morphology, layout data, and other third-party datasets are not relicensed as MIT by this repository. Those materials remain subject to their original source terms, attribution requirements, and usage restrictions.",
];

const NOTICE_LICENSE_AR = [
  "شيفرة حافظ المصدرية ووثائق المشروع مرخّصة بموجب MIT License ما لم يذكر ملف خلاف ذلك.",
  "نص القرآن والخطوط والترجمات والتفاسير وبيانات التجويد والصرف والتخطيط وغيرها من البيانات الخارجية المرفقة لا يعاد ترخيصها بموجب MIT في هذا المستودع. وتبقى خاضعة لشروط مصادرها الأصلية ومتطلبات الإسناد وقيود الاستخدام.",
];

const NOTICE_SOURCES_EN = [
  "Quran text and metadata: bundled in assets/data/quran-data.json and related local SQLite imports.",
  "QCF2 / KFGQPC V2 fonts: bundled in assets/fonts/QPC_V2/. These fonts are free to use, copy, and distribute under their source terms, and may not be sold, modified, or reverse-engineered.",
  "Al-Muyassar tafsir: sourced from spa5k/tafsir_api, MIT License.",
  "Fi Zilal al-Quran tafsir: bundled as a Hafiz tafsir source.",
  "Sahih International English translation: bundled in assets/data/translation-sahih.json.",
  "Additional translations: bundled in assets/data/translations/.",
  "Page mapping data: sourced from rn0x/Quran-Data, MIT License.",
  "Word-by-word and Quranic resource data: bundled from Quranic resource datasets used by Hafiz.",
  "MASAQ morphology and i'rab data: CC BY 3.0.",
  "Tajweed data: sourced from cpfair/quran-tajweed, CC BY 4.0.",
  "Tajweed rule descriptions: adapted from educational tajweed references and bundled in assets/data/tajweed-rules-en.json and assets/data/tajweed-rules-ar.json.",
  "Reasons of revelation data: sourced from mostafaahmed97/asbab-al-nuzul-dataset, MIT License.",
];

const NOTICE_SOURCES_AR = [
  "نص القرآن وبياناته الوصفية: مرفقة في assets/data/quran-data.json وما يرتبط بها من بيانات SQLite محلية.",
  "خطوط QCF2 / KFGQPC V2: مرفقة في assets/fonts/QPC_V2/. يجوز استخدام هذه الخطوط ونسخها وتوزيعها مجانًا وفق شروط مصدرها، ولا يجوز بيعها أو تعديلها أو الهندسة العكسية لها.",
  "تفسير الميسر: من spa5k/tafsir_api، MIT License.",
  "تفسير في ظلال القرآن: مرفق مصدرًا للتفسير في حافظ.",
  "ترجمة Sahih International الإنجليزية: مرفقة في assets/data/translation-sahih.json.",
  "ترجمات إضافية: مرفقة في assets/data/translations/.",
  "بيانات ربط الصفحات: من rn0x/Quran-Data، MIT License.",
  "بيانات الكلمات والموارد القرآنية: مرفقة من مجموعات بيانات الموارد القرآنية التي يستخدمها حافظ.",
  "بيانات الصرف والإعراب MASAQ: CC BY 3.0.",
  "بيانات التجويد: من cpfair/quran-tajweed، CC BY 4.0.",
  "شرح أحكام التجويد: بتصرف من مراجع تعليمية للتجويد، ومرفق في assets/data/tajweed-rules-en.json وassets/data/tajweed-rules-ar.json.",
  "بيانات أسباب النزول: من mostafaahmed97/asbab-al-nuzul-dataset، MIT License.",
];

const NOTICE_SOURCE_LINKS: PublicPageLink[] = [
  { label: "spa5k/tafsir_api", href: "https://github.com/spa5k/tafsir_api", external: true },
  { label: "rn0x/Quran-Data", href: "https://github.com/rn0x/Quran-Data", external: true },
  { label: "cpfair/quran-tajweed", href: "https://github.com/cpfair/quran-tajweed", external: true },
  {
    label: "mostafaahmed97/asbab-al-nuzul-dataset",
    href: "https://github.com/mostafaahmed97/asbab-al-nuzul-dataset",
    external: true,
  },
  { label: "MIT License", href: "https://opensource.org/license/mit", external: true },
  { label: "CC BY 3.0", href: "https://creativecommons.org/licenses/by/3.0/", external: true },
  { label: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/", external: true },
];

const NOTICE_ATTRIBUTION_EN = [
  "When redistributing Hafiz, keep this notice, the MIT license, and any source-specific notices required by the bundled datasets and fonts. Do not remove attribution for Quranic text, fonts, translations, tafsir, tajweed, morphology, or other third-party materials.",
  "If a source-specific license or attribution term needs to be clarified, update this file before broad redistribution.",
];

const NOTICE_ATTRIBUTION_AR = [
  "عند إعادة توزيع حافظ، احتفظ بهذا الإشعار وبترخيص MIT وبأي إشعارات خاصة بالمصادر تتطلبها البيانات والخطوط المرفقة. لا تحذف الإسناد لنص القرآن أو الخطوط أو الترجمات أو التفاسير أو التجويد أو الصرف أو غيرها من المواد الخارجية.",
  "إذا احتاج ترخيص أو شرط إسناد خاص بمصدر إلى توضيح، فحدّث هذا الملف قبل إعادة التوزيع على نطاق واسع.",
];

export const PUBLIC_PAGE_LABELS: Record<
  PublicPageLanguage,
  {
    home: string;
    language: string;
    changeLanguage: string;
    back: string;
    backToHafiz: string;
    external: string;
    linkFailed: string;
    contents: string;
    emailFailed: string;
    copyEmail: string;
    copied: string;
    copyFailed: string;
  }
> = {
  en: {
    home: "Open Hafiz",
    language: "العربية",
    changeLanguage: "Change language",
    back: "Back",
    backToHafiz: "Back to Hafiz",
    external: "External link",
    linkFailed: "Could not open link",
    contents: "On this page",
    emailFailed: "Could not open your email app. You can copy the address instead:",
    copyEmail: "Copy",
    copied: "Copied",
    copyFailed: "Could not copy",
  },
  ar: {
    home: "افتح حافظ",
    language: "English",
    changeLanguage: "تغيير اللغة",
    back: "رجوع",
    backToHafiz: "العودة إلى حافظ",
    external: "رابط خارجي",
    linkFailed: "تعذر فتح الرابط",
    contents: "في هذه الصفحة",
    emailFailed: "تعذر فتح تطبيق البريد. يمكنك نسخ العنوان بدلًا من ذلك:",
    copyEmail: "نسخ",
    copied: "تم النسخ",
    copyFailed: "تعذر النسخ",
  },
};

export const PUBLIC_PAGE_CONTENT: Record<
  PublicPageKey,
  Record<PublicPageLanguage, PublicPageContent>
> = {
  about: {
    en: {
      tabLabel: "About Hafiz",
      eyebrow: "About Hafiz",
      title: "Memorize through reflection",
      description:
        "Hafiz is an independent, founder-maintained Quran app focused on reading, reflection, and steady memorization. It is currently in early public preview.",
      sections: [
        {
          id: "what-hafiz-does",
          title: "What Hafiz does",
          body: [
            "Hafiz helps you memorize through reflection: read the ayah carefully, study its words, write what it opens for you, then return to it with a calm review rhythm.",
            "The app brings together QCF2 page fonts for Quran display, word-level study data, tafsir, translations, private notes, and review tools. Review scheduling uses FSRS as a supporting tool.",
          ],
        },
        {
          id: "preview-status",
          title: "Public preview status",
          body: [
            "Hafiz is available for a small group of people to view and try, but it should still be treated as a preview. Some features, polish, and policies are still being completed.",
            "Issues are welcome for bugs, content corrections, accessibility problems, and feature requests. The project is not accepting outside code contributions or unsolicited pull requests yet.",
          ],
          links: [
            {
              label: "Open GitHub Issues",
              href: "https://github.com/71iq/Hafiz/issues",
              external: true,
            },
          ],
        },
        {
          id: "contact",
          title: "Contact",
          body: [
            "For support or general questions, email support@hafizquran.app. For privacy requests, email privacy@hafizquran.app.",
          ],
          links: [
            {
              label: "Privacy Policy",
              href: "/privacy",
            },
            {
              label: "Terms of Service",
              href: "/terms",
            },
          ],
        },
      ],
    },
    ar: {
      tabLabel: "عن حافظ",
      eyebrow: "عن حافظ",
      title: "احفظ بالتدبر",
      description:
        "حافظ تطبيق قرآني مستقل يشرف عليه مؤسسه، ويركز على القراءة والتدبر وتثبيت الحفظ بهدوء. التطبيق حاليًا في مرحلة معاينة عامة مبكرة.",
      sections: [
        {
          id: "what-hafiz-does",
          title: "ماذا يقدم حافظ",
          body: [
            "يساعدك حافظ على الحفظ بالتدبر: تقرأ الآية بتأن، وتدرس كلماتها، وتكتب ما يفتح الله لك فيها، ثم تعود إليها بإيقاع مراجعة هادئ.",
            "يجمع التطبيق بين خطوط QCF2 لعرض المصحف، وبيانات دراسة الكلمات، والتفسير، والترجمات، والملاحظات الخاصة، وأدوات المراجعة. وتستخدم جدولة المراجعة FSRS كأداة مساعدة.",
          ],
        },
        {
          id: "preview-status",
          title: "حالة المعاينة العامة",
          body: [
            "حافظ متاح الآن لعدد محدود من الأشخاص للاطلاع والتجربة، لكنه ما زال في مرحلة معاينة. بعض الميزات والتفاصيل والسياسات ما زالت قيد الإكمال.",
            "نرحب بفتح بلاغات للمشكلات، وتصحيحات المحتوى، وملاحظات الوصول، وطلبات الميزات. لا يقبل المشروع مساهمات برمجية خارجية أو طلبات سحب غير مطلوبة في هذه المرحلة.",
          ],
          links: [
            {
              label: "افتح البلاغات على GitHub",
              href: "https://github.com/71iq/Hafiz/issues",
              external: true,
            },
          ],
        },
        {
          id: "contact",
          title: "التواصل",
          body: [
            "للدعم أو الأسئلة العامة: support@hafizquran.app. لطلبات الخصوصية: privacy@hafizquran.app.",
          ],
          links: [
            {
              label: "سياسة الخصوصية",
              href: "/privacy",
            },
            {
              label: "شروط الخدمة",
              href: "/terms",
            },
          ],
        },
      ],
    },
  },
  privacy: {
    en: {
      tabLabel: "Privacy Policy",
      title: "Privacy Policy",
      description:
        "This policy explains what Hafiz may store in the app, what optional online features may sync, and how to contact us about privacy requests.",
      lastUpdated: "Last updated: May 16, 2026",
      sections: [
        {
          id: "app-data",
          title: "App data",
          body: [
            "Hafiz may store study cards, review history, bookmarks, highlights, private notes, and settings in your browser or app storage.",
            "Quran reading, reflection, and review features may use app storage so your experience can continue smoothly between sessions.",
          ],
        },
        {
          id: "account-sync",
          title: "Optional account and sync data",
          body: [
            "If you sign in, Hafiz may sync account and study data through Supabase so your progress can be available across devices.",
          ],
          bullets: [
            "Email address and authentication identifiers",
            "Profile details such as username or display name",
            "Settings, study cards, review logs, bookmarks, highlights, and private note metadata",
            "Public reflections, comments and likes",
            "Wird days, review sessions and recitation mistakes, kept private to your account",
            "Halaqa memberships, sharing choices and encouragements, and Board participation if you join",
          ],
        },
        {
          id: "public-content",
          title: "Public content",
          body: [
            "Public reflections, comments, likes, your username, display name and profile photo may be visible to other Hafiz users. Do not post private information in public reflection areas.",
            "Your progress is private by default. Halaqa members see only your wird days this week, streak and juz completions, and only when you share them. Teachers in a halaqa see your plan or recent grades only if you allow it. If you join the Board, people in your weekly group see your name or nickname, weekly consistency points and streak. Mistakes, grades and excused days are never shown to them.",
          ],
        },
        {
          id: "quran-foundation",
          title: "Quran Foundation connection",
          body: [
            "Hafiz includes an optional Quran Foundation connection. If you connect it, Hafiz may exchange the information needed to link your account and sync supported Quran Foundation user data.",
          ],
        },
        {
          id: "what-we-do-not-do",
          title: "What we do not do",
          bullets: [
            "We do not sell your personal data.",
            "We do not require an account for Quran reading and reflection tools.",
          ],
        },
        {
          id: "privacy-requests",
          title: "Privacy requests",
          body: [
            "For privacy questions, account data requests, or deletion requests, email privacy@hafizquran.app. For product issues and bugs, use GitHub Issues.",
          ],
          links: [
            {
              label: "Email privacy@hafizquran.app",
              href: "mailto:privacy@hafizquran.app",
              external: true,
            },
            {
              label: "GitHub Issues",
              href: "https://github.com/71iq/Hafiz/issues",
              external: true,
            },
          ],
        },
      ],
    },
    ar: {
      tabLabel: "سياسة الخصوصية",
      title: "سياسة الخصوصية",
      description:
        "توضح هذه السياسة ما قد يخزنه حافظ داخل التطبيق، وما قد تتم مزامنته عند استخدام الميزات الاختيارية المتصلة، وكيفية التواصل بخصوص طلبات الخصوصية.",
      lastUpdated: "آخر تحديث: ١٦ مايو ٢٠٢٦",
      sections: [
        {
          id: "app-data",
          title: "بيانات التطبيق",
          body: [
            "قد يحفظ حافظ بطاقات الدراسة، وسجل المراجعة، والإشارات المرجعية، والتمييزات، والملاحظات الخاصة، والإعدادات في متصفحك أو مساحة تخزين التطبيق.",
            "قد تستخدم ميزات قراءة القرآن والتدبر والمراجعة تخزين التطبيق حتى تبقى تجربتك مستمرة بسلاسة بين الجلسات.",
          ],
        },
        {
          id: "account-sync",
          title: "بيانات الحساب والمزامنة الاختيارية",
          body: [
            "إذا سجلت الدخول، فقد يزامن حافظ بيانات الحساب والدراسة عبر Supabase حتى يتوفر تقدمك على أكثر من جهاز.",
          ],
          bullets: [
            "البريد الإلكتروني ومعرفات المصادقة",
            "بيانات الملف مثل اسم المستخدم أو الاسم المعروض",
            "الإعدادات، وبطاقات الدراسة، وسجل المراجعة، والإشارات، والتمييزات، وبيانات الملاحظات الخاصة",
            "التأملات العامة، والتعليقات، والإعجابات",
            "أيام الوِرد، وجلسات المراجعة، وأخطاء التلاوة، وتبقى خاصة بحسابك",
            "عضويات الحلقات، واختيارات المشاركة، والتشجيعات، والمشاركة في اللوحة إن انضممت إليها",
          ],
        },
        {
          id: "public-content",
          title: "المحتوى العام",
          body: [
            "قد تكون التأملات العامة، والتعليقات، والإعجابات، واسم المستخدم، والاسم المعروض، وصورة الملف ظاهرة لمستخدمي حافظ الآخرين. لا تنشر معلومات خاصة في مساحات التأمل العامة.",
            "تقدّمك خاص افتراضيًا. لا يرى أعضاء الحلقة إلا أيام وِردك هذا الأسبوع وسلسلتك والأجزاء التي أتممتها، وذلك عندما تشاركها فقط. ولا يرى المعلّم في الحلقة خطتك أو تقييماتك الأخيرة إلا بإذنك. وإن انضممت إلى اللوحة، يرى من في مجموعتك الأسبوعية اسمك أو لقبك ونقاط المواظبة الأسبوعية وسلسلتك. ولا تظهر لهم الأخطاء ولا التقييمات ولا أيام العذر أبدًا.",
          ],
        },
        {
          id: "quran-foundation",
          title: "الاتصال بمؤسسة Quran Foundation",
          body: [
            "يتضمن حافظ اتصالًا اختياريًا بمؤسسة Quran Foundation. إذا ربطته، فقد يتبادل حافظ المعلومات اللازمة لربط حسابك ومزامنة بيانات المستخدم المدعومة.",
          ],
        },
        {
          id: "what-we-do-not-do",
          title: "ما لا نفعله",
          bullets: [
            "لا نبيع بياناتك الشخصية.",
            "لا نطلب حسابًا لاستخدام أدوات قراءة القرآن والتدبر.",
          ],
        },
        {
          id: "privacy-requests",
          title: "طلبات الخصوصية",
          body: [
            "لأسئلة الخصوصية أو طلبات بيانات الحساب أو الحذف، راسل privacy@hafizquran.app. لمشكلات المنتج والأخطاء، استخدم GitHub Issues.",
          ],
          links: [
            {
              label: "راسل privacy@hafizquran.app",
              href: "mailto:privacy@hafizquran.app",
              external: true,
            },
            {
              label: "بلاغات GitHub",
              href: "https://github.com/71iq/Hafiz/issues",
              external: true,
            },
          ],
        },
      ],
    },
  },
  terms: {
    en: {
      tabLabel: "Terms of Service",
      title: "Terms of Service",
      description:
        "These terms describe the public preview status of Hafiz and the basic rules for using the app and its online features.",
      lastUpdated: "Last updated: May 16, 2026",
      sections: [
        {
          id: "public-preview",
          title: "Public preview",
          body: [
            "Hafiz is currently provided as an early public preview. Features may change, break, or be removed while the app is still being prepared for wider public use.",
          ],
        },
        {
          id: "study-tool",
          title: "Educational and study tool",
          body: [
            "Hafiz is a Quran reading, reflection, and memorization tool. It is not a substitute for qualified teachers, scholars, or local religious guidance.",
          ],
        },
        {
          id: "accounts-sync",
          title: "Accounts and sync",
          body: [
            "You may use the core reading experience without an account. Optional account features, cloud sync, reflections, halaqa and Board features require online services and may be unavailable at times.",
            "You are responsible for keeping your account credentials secure and for the content you publish through public features.",
          ],
        },
        {
          id: "community-conduct",
          title: "Community conduct",
          bullets: [
            "Use public reflections and comments respectfully.",
            "Do not post unlawful, abusive, spam, or private personal information.",
            "Content that harms the experience for other users may be removed.",
          ],
        },
        {
          id: "source-terms",
          title: "Content and source terms",
          body: [
            "Hafiz includes Quran text, fonts, translations, tafsir, tajweed, morphology, and related datasets from third-party sources. Those materials remain subject to their original source terms and notices.",
            "The Hafiz source code is licensed separately from bundled third-party content.",
          ],
        },
        {
          id: "availability",
          title: "Availability and warranty",
          body: [
            "Hafiz is provided as-is during this preview. We aim to keep the app useful and respectful, but we do not guarantee uninterrupted availability, perfect accuracy, or that every feature will remain unchanged.",
          ],
        },
        {
          id: "contact",
          title: "Contact",
          body: [
            "For support or legal questions, email support@hafizquran.app. For bugs and product requests, use GitHub Issues.",
          ],
          links: [
            {
              label: "GitHub Issues",
              href: "https://github.com/71iq/Hafiz/issues",
              external: true,
            },
          ],
        },
      ],
    },
    ar: {
      tabLabel: "شروط الخدمة",
      title: "شروط الخدمة",
      description:
        "توضح هذه الشروط حالة حافظ كمعاينة عامة، والقواعد الأساسية لاستخدام التطبيق وميزاته المتصلة.",
      lastUpdated: "آخر تحديث: ١٦ مايو ٢٠٢٦",
      sections: [
        {
          id: "public-preview",
          title: "المعاينة العامة",
          body: [
            "يُقدَّم حافظ حاليًا كمعاينة عامة مبكرة. قد تتغير الميزات أو تتعطل أو تُزال أثناء تجهيز التطبيق للاستخدام العام الأوسع.",
          ],
        },
        {
          id: "study-tool",
          title: "أداة تعليم ودراسة",
          body: [
            "حافظ أداة لقراءة القرآن والتدبر وتثبيت الحفظ. لا يغني عن المعلمين المؤهلين أو أهل العلم أو الإرشاد الديني المحلي.",
          ],
        },
        {
          id: "accounts-sync",
          title: "الحسابات والمزامنة",
          body: [
            "يمكنك استخدام تجربة القراءة الأساسية دون حساب. أما ميزات الحساب الاختيارية والمزامنة السحابية والتأملات والحلقات واللوحة فتحتاج إلى خدمات متصلة وقد لا تكون متاحة دائمًا.",
            "أنت مسؤول عن حماية بيانات حسابك وعن المحتوى الذي تنشره عبر الميزات العامة.",
          ],
        },
        {
          id: "community-conduct",
          title: "السلوك المجتمعي",
          bullets: [
            "استخدم التأملات والتعليقات العامة باحترام.",
            "لا تنشر محتوى مخالفًا أو مسيئًا أو عشوائيًا أو معلومات شخصية خاصة.",
            "قد نزيل المحتوى الذي يضر بتجربة المستخدمين الآخرين.",
          ],
        },
        {
          id: "source-terms",
          title: "المحتوى وشروط المصادر",
          body: [
            "يتضمن حافظ نص القرآن، وخطوطًا، وترجمات، وتفاسير، وبيانات تجويد وصرف وبيانات مرتبطة من مصادر خارجية. تبقى هذه المواد خاضعة لشروط مصادرها الأصلية وإشعاراتها.",
            "تُرخَّص شيفرة حافظ المصدرية بشكل منفصل عن المحتوى الخارجي المرفق.",
          ],
        },
        {
          id: "availability",
          title: "الإتاحة والضمان",
          body: [
            "يُقدَّم حافظ كما هو خلال هذه المعاينة. نسعى إلى إبقاء التطبيق نافعًا ومحترمًا، لكننا لا نضمن الإتاحة المستمرة أو الدقة الكاملة أو بقاء كل ميزة دون تغيير.",
          ],
        },
        {
          id: "contact",
          title: "التواصل",
          body: [
            "للدعم أو الأسئلة القانونية، راسل support@hafizquran.app. للأخطاء وطلبات المنتج، استخدم GitHub Issues.",
          ],
          links: [
            {
              label: "بلاغات GitHub",
              href: "https://github.com/71iq/Hafiz/issues",
              external: true,
            },
          ],
        },
      ],
    },
  },
  credits: {
    en: {
      tabLabel: "Credits",
      title: "Credits & Sources",
      description:
        "Hafiz uses Quran text, study data, translations, tafsir, fonts, and related datasets from multiple sources. These notices acknowledge the source materials used in the app.",
      sections: [
        {
          id: "licenses",
          title: "Licenses",
          body: NOTICE_LICENSE_EN,
        },
        {
          id: "bundled-sources",
          title: "Bundled sources",
          bullets: NOTICE_SOURCES_EN,
          links: NOTICE_SOURCE_LINKS,
        },
        {
          id: "study-sources",
          title: "Study data and tafsir",
          bullets: CREDIT_LINES_EN,
        },
        {
          id: "attribution",
          title: "Attribution",
          body: NOTICE_ATTRIBUTION_EN,
        },
      ],
    },
    ar: {
      tabLabel: "المصادر والاعتمادات",
      title: "المصادر والاعتمادات",
      description:
        "يعتمد حافظ على نص القرآن وبيانات الدراسة والترجمات والتفاسير والخطوط وبيانات أخرى من مصادر متعددة. تعرض هذه الصفحة الإشعارات الخاصة بتلك المواد.",
      sections: [
        {
          id: "licenses",
          title: "التراخيص",
          body: NOTICE_LICENSE_AR,
        },
        {
          id: "bundled-sources",
          title: "المصادر المرفقة",
          bullets: NOTICE_SOURCES_AR,
          links: NOTICE_SOURCE_LINKS,
        },
        {
          id: "study-sources",
          title: "بيانات الدراسة والتفاسير",
          bullets: CREDIT_LINES_AR,
        },
        {
          id: "attribution",
          title: "الإسناد",
          body: NOTICE_ATTRIBUTION_AR,
        },
      ],
    },
  },
};
