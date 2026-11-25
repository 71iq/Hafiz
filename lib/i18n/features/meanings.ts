/**
 * Word meanings in daily study (SPEC 3.6). Spread into lib/i18n/strings.ts. Keep English and Arabic
 * keys in parity.
 */
export const meaningsStrings = {
  en: {
    meaningsKnowThis: "I know this",
    meaningsRaiseTitle: "You know these words",
    meaningsRaiseBody: "Skip the next band of common words, so new cards bring rarer ones?",
    meaningsRaiseConfirm: "Skip them",
    meaningsLowerTitle: "Start with commoner words?",
    meaningsLowerBody: "New cards will bring commoner words first. You can change this in Settings.",
    meaningsLowerConfirm: "Commoner words",
    meaningsOfferNotNow: "Not now",
  },
  ar: {
    meaningsKnowThis: "أعرف هذه الكلمة",
    meaningsRaiseTitle: "تعرف هذه الكلمات",
    meaningsRaiseBody: "أتتخطى الفئة التالية من الكلمات الشائعة لتأتيك البطاقات الجديدة بكلمات أندر؟",
    meaningsRaiseConfirm: "تخطَّها",
    meaningsLowerTitle: "أتبدأ بكلمات أشيع؟",
    meaningsLowerBody: "ستأتيك البطاقات الجديدة بالكلمات الأشيع أولًا. يمكنك تغيير ذلك من الإعدادات.",
    meaningsLowerConfirm: "كلمات أشيع",
    meaningsOfferNotNow: "ليس الآن",
  },
} as const;
