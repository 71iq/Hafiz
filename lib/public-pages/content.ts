export type PublicPageLanguage = "en" | "ar";
export type PublicPageKey = "about" | "privacy" | "terms";

export type PublicPageLink = {
  label: string;
  href: string;
  external?: boolean;
};

export type PublicPageSection = {
  id?: string;
  title: string;
  body?: string[];
  bullets?: string[];
  links?: PublicPageLink[];
};

export type PublicPageContent = {
  eyebrow: string;
  title: string;
  description: string;
  lastUpdated?: string;
  sections: PublicPageSection[];
  actions: PublicPageLink[];
};

export const PUBLIC_PAGE_LABELS: Record<
  PublicPageLanguage,
  {
    home: string;
    language: string;
    back: string;
    external: string;
  }
> = {
  en: {
    home: "Open Hafiz",
    language: "العربية",
    back: "Back",
    external: "External link",
  },
  ar: {
    home: "افتح حافظ",
    language: "English",
    back: "رجوع",
    external: "رابط خارجي",
  },
};

export const PUBLIC_PAGE_CONTENT: Record<
  PublicPageKey,
  Record<PublicPageLanguage, PublicPageContent>
> = {
  about: {
    en: {
      eyebrow: "About Hafiz",
      title: "Memorize through reflection",
      description:
        "Hafiz is an independent, founder-maintained Quran app focused on reading, reflection, and steady memorization. It is currently in early public preview.",
      sections: [
        {
          title: "What Hafiz does",
          body: [
            "Hafiz helps you memorize through reflection: read the ayah carefully, study its words, write what it opens for you, then return to it with a calm review rhythm.",
            "The app brings together QCF2 page fonts for Quran display, word-level study data, tafsir, translations, private notes, and review tools. Review scheduling uses FSRS as a supporting tool.",
          ],
        },
        {
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
          id: "donor",
          title: "Become a Donor",
          body: [
            "A donor option is planned for people who want to support Hafiz. Donations are not being collected yet, and there is no payment flow in this preview build.",
          ],
        },
        {
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
      actions: [
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
      ],
    },
    ar: {
      eyebrow: "عن حافظ",
      title: "احفظ بالتدبر",
      description:
        "حافظ تطبيق قرآني مستقل يشرف عليه مؤسسه، ويركز على القراءة والتدبر وتثبيت الحفظ بهدوء. التطبيق حاليًا في مرحلة معاينة عامة مبكرة.",
      sections: [
        {
          title: "ماذا يقدم حافظ",
          body: [
            "يساعدك حافظ على الحفظ بالتدبر: تقرأ الآية بتأن، وتدرس كلماتها، وتكتب ما يفتح الله لك فيها، ثم تعود إليها بإيقاع مراجعة هادئ.",
            "يجمع التطبيق بين خطوط QCF2 لعرض المصحف، وبيانات دراسة الكلمات، والتفسير، والترجمات، والملاحظات الخاصة، وأدوات المراجعة. وتستخدم جدولة المراجعة FSRS كأداة مساعدة.",
          ],
        },
        {
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
          id: "donor",
          title: "كن داعمًا",
          body: [
            "نخطط لإضافة خيار دعم لمن يريد المساهمة في استمرار حافظ. لا نجمع التبرعات حاليًا، ولا توجد آلية دفع في نسخة المعاينة هذه.",
          ],
        },
        {
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
      actions: [
        { label: "سياسة الخصوصية", href: "/privacy" },
        { label: "شروط الخدمة", href: "/terms" },
      ],
    },
  },
  privacy: {
    en: {
      eyebrow: "Privacy Policy",
      title: "Privacy Policy",
      description:
        "This policy explains what Hafiz may store in the app, what optional online features may sync, and how to contact us about privacy requests.",
      lastUpdated: "Last updated: May 16, 2026",
      sections: [
        {
          title: "App data",
          body: [
            "Hafiz may store study cards, review history, bookmarks, highlights, private notes, and settings in your browser or app storage.",
            "Quran reading, reflection, and review features may use app storage so your experience can continue smoothly between sessions.",
          ],
        },
        {
          title: "Optional account and sync data",
          body: [
            "If you sign in, Hafiz may sync account and study data through Supabase so your progress can be available across devices.",
          ],
          bullets: [
            "Email address and authentication identifiers",
            "Profile details such as username or display name",
            "Settings, study cards, review logs, bookmarks, highlights, and private note metadata",
            "Public reflections, comments, likes, leaderboard scores, and public achievement badges",
          ],
        },
        {
          title: "Public content",
          body: [
            "Public reflections, comments, likes, leaderboard entries, and public profile elements may be visible to other Hafiz users. Do not post private information in public reflection areas.",
          ],
        },
        {
          title: "Quran Foundation connection",
          body: [
            "Hafiz includes an optional Quran Foundation connection. If you connect it, Hafiz may exchange the information needed to link your account and sync supported Quran Foundation user data.",
          ],
        },
        {
          title: "What we do not do",
          bullets: [
            "We do not sell your personal data.",
            "We do not require an account for Quran reading and reflection tools.",
          ],
        },
        {
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
      actions: [
        { label: "About Hafiz", href: "/about" },
        { label: "Terms of Service", href: "/terms" },
      ],
    },
    ar: {
      eyebrow: "سياسة الخصوصية",
      title: "سياسة الخصوصية",
      description:
        "توضح هذه السياسة ما قد يخزنه حافظ داخل التطبيق، وما قد تتم مزامنته عند استخدام الميزات الاختيارية المتصلة، وكيفية التواصل بخصوص طلبات الخصوصية.",
      lastUpdated: "آخر تحديث: 16 مايو 2026",
      sections: [
        {
          title: "بيانات التطبيق",
          body: [
            "قد يحفظ حافظ بطاقات الدراسة، وسجل المراجعة، والإشارات المرجعية، والتمييزات، والملاحظات الخاصة، والإعدادات في متصفحك أو مساحة تخزين التطبيق.",
            "قد تستخدم ميزات قراءة القرآن والتدبر والمراجعة تخزين التطبيق حتى تبقى تجربتك مستمرة بسلاسة بين الجلسات.",
          ],
        },
        {
          title: "بيانات الحساب والمزامنة الاختيارية",
          body: [
            "إذا سجلت الدخول، فقد يزامن حافظ بيانات الحساب والدراسة عبر Supabase حتى يتوفر تقدمك على أكثر من جهاز.",
          ],
          bullets: [
            "البريد الإلكتروني ومعرفات المصادقة",
            "بيانات الملف مثل اسم المستخدم أو الاسم المعروض",
            "الإعدادات، وبطاقات الدراسة، وسجل المراجعة، والإشارات، والتمييزات، وبيانات الملاحظات الخاصة",
            "التأملات العامة، والتعليقات، والإعجابات، ونقاط لوحة المتصدرين، والشارات العامة",
          ],
        },
        {
          title: "المحتوى العام",
          body: [
            "قد تكون التأملات العامة، والتعليقات، والإعجابات، ونتائج لوحة المتصدرين، وعناصر الملف العام ظاهرة لمستخدمي حافظ الآخرين. لا تنشر معلومات خاصة في مساحات التأمل العامة.",
          ],
        },
        {
          title: "الاتصال بمؤسسة Quran Foundation",
          body: [
            "يتضمن حافظ اتصالًا اختياريًا بمؤسسة Quran Foundation. إذا ربطته، فقد يتبادل حافظ المعلومات اللازمة لربط حسابك ومزامنة بيانات المستخدم المدعومة.",
          ],
        },
        {
          title: "ما لا نفعله",
          bullets: [
            "لا نبيع بياناتك الشخصية.",
            "لا نطلب حسابًا لاستخدام أدوات قراءة القرآن والتدبر.",
          ],
        },
        {
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
      actions: [
        { label: "عن حافظ", href: "/about" },
        { label: "شروط الخدمة", href: "/terms" },
      ],
    },
  },
  terms: {
    en: {
      eyebrow: "Terms of Service",
      title: "Terms of Service",
      description:
        "These terms describe the public preview status of Hafiz and the basic rules for using the app and its online features.",
      lastUpdated: "Last updated: May 16, 2026",
      sections: [
        {
          title: "Public preview",
          body: [
            "Hafiz is currently provided as an early public preview. Features may change, break, or be removed while the app is still being prepared for wider public use.",
          ],
        },
        {
          title: "Educational and study tool",
          body: [
            "Hafiz is a Quran reading, reflection, and memorization tool. It is not a substitute for qualified teachers, scholars, or local religious guidance.",
          ],
        },
        {
          title: "Accounts and sync",
          body: [
            "You may use the core reading experience without an account. Optional account features, cloud sync, reflections, and leaderboard features require online services and may be unavailable at times.",
            "You are responsible for keeping your account credentials secure and for the content you publish through public features.",
          ],
        },
        {
          title: "Community conduct",
          bullets: [
            "Use public reflections and comments respectfully.",
            "Do not post unlawful, abusive, spam, or private personal information.",
            "Content that harms the experience for other users may be removed.",
          ],
        },
        {
          title: "Content and source terms",
          body: [
            "Hafiz includes Quran text, fonts, translations, tafsir, tajweed, morphology, and related datasets from third-party sources. Those materials remain subject to their original source terms and notices.",
            "The Hafiz source code is licensed separately from bundled third-party content.",
          ],
        },
        {
          title: "Availability and warranty",
          body: [
            "Hafiz is provided as-is during this preview. We aim to keep the app useful and respectful, but we do not guarantee uninterrupted availability, perfect accuracy, or that every feature will remain unchanged.",
          ],
        },
        {
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
      actions: [
        { label: "About Hafiz", href: "/about" },
        { label: "Privacy Policy", href: "/privacy" },
      ],
    },
    ar: {
      eyebrow: "شروط الخدمة",
      title: "شروط الخدمة",
      description:
        "توضح هذه الشروط حالة حافظ كمعاينة عامة، والقواعد الأساسية لاستخدام التطبيق وميزاته المتصلة.",
      lastUpdated: "آخر تحديث: 16 مايو 2026",
      sections: [
        {
          title: "المعاينة العامة",
          body: [
            "يُقدَّم حافظ حاليًا كمعاينة عامة مبكرة. قد تتغير الميزات أو تتعطل أو تُزال أثناء تجهيز التطبيق للاستخدام العام الأوسع.",
          ],
        },
        {
          title: "أداة تعليم ودراسة",
          body: [
            "حافظ أداة لقراءة القرآن والتدبر وتثبيت الحفظ. لا يغني عن المعلمين المؤهلين أو أهل العلم أو الإرشاد الديني المحلي.",
          ],
        },
        {
          title: "الحسابات والمزامنة",
          body: [
            "يمكنك استخدام تجربة القراءة الأساسية دون حساب. أما ميزات الحساب الاختيارية والمزامنة السحابية والتأملات ولوحة المتصدرين فتحتاج إلى خدمات متصلة وقد لا تكون متاحة دائمًا.",
            "أنت مسؤول عن حماية بيانات حسابك وعن المحتوى الذي تنشره عبر الميزات العامة.",
          ],
        },
        {
          title: "السلوك المجتمعي",
          bullets: [
            "استخدم التأملات والتعليقات العامة باحترام.",
            "لا تنشر محتوى مخالفًا أو مسيئًا أو عشوائيًا أو معلومات شخصية خاصة.",
            "قد نزيل المحتوى الذي يضر بتجربة المستخدمين الآخرين.",
          ],
        },
        {
          title: "المحتوى وشروط المصادر",
          body: [
            "يتضمن حافظ نص القرآن، وخطوطًا، وترجمات، وتفاسير، وبيانات تجويد وصرف وبيانات مرتبطة من مصادر خارجية. تبقى هذه المواد خاضعة لشروط مصادرها الأصلية وإشعاراتها.",
            "تُرخَّص شيفرة حافظ المصدرية بشكل منفصل عن المحتوى الخارجي المرفق.",
          ],
        },
        {
          title: "الإتاحة والضمان",
          body: [
            "يُقدَّم حافظ كما هو خلال هذه المعاينة. نسعى إلى إبقاء التطبيق نافعًا ومحترمًا، لكننا لا نضمن الإتاحة المستمرة أو الدقة الكاملة أو بقاء كل ميزة دون تغيير.",
          ],
        },
        {
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
      actions: [
        { label: "عن حافظ", href: "/about" },
        { label: "سياسة الخصوصية", href: "/privacy" },
      ],
    },
  },
};
