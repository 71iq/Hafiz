export type QfReciter = {
  id: number;
  nameEn: string;
  nameAr: string;
  styleEn: "Murattal" | "Mujawwad" | "Muallim";
  styleAr: string;
};

export const QF_HUSARY_MURATTAL_RECITATION_ID = 6;
export const DEFAULT_RECITATION_ID = QF_HUSARY_MURATTAL_RECITATION_ID;

export const RECITERS: QfReciter[] = [
  { id: 6, nameEn: "Mahmoud Khalil Al-Husary", nameAr: "محمود خليل الحصري", styleEn: "Murattal", styleAr: "مرتل" },
  { id: 12, nameEn: "Mahmoud Khalil Al-Husary", nameAr: "محمود خليل الحصري", styleEn: "Muallim", styleAr: "معلم" },
  { id: 7, nameEn: "Mishari Rashid al-Afasy", nameAr: "مشاري راشد العفاسي", styleEn: "Murattal", styleAr: "مرتل" },
  { id: 2, nameEn: "AbdulBaset AbdulSamad", nameAr: "عبد الباسط عبد الصمد", styleEn: "Murattal", styleAr: "مرتل" },
  { id: 1, nameEn: "AbdulBaset AbdulSamad", nameAr: "عبد الباسط عبد الصمد", styleEn: "Mujawwad", styleAr: "مجود" },
  { id: 3, nameEn: "Abdur-Rahman as-Sudais", nameAr: "عبد الرحمن السديس", styleEn: "Murattal", styleAr: "مرتل" },
  { id: 4, nameEn: "Abu Bakr al-Shatri", nameAr: "أبو بكر الشاطري", styleEn: "Murattal", styleAr: "مرتل" },
  { id: 5, nameEn: "Hani ar-Rifai", nameAr: "هاني الرفاعي", styleEn: "Murattal", styleAr: "مرتل" },
  { id: 9, nameEn: "Mohamed Siddiq al-Minshawi", nameAr: "محمد صديق المنشاوي", styleEn: "Murattal", styleAr: "مرتل" },
  { id: 8, nameEn: "Mohamed Siddiq al-Minshawi", nameAr: "محمد صديق المنشاوي", styleEn: "Mujawwad", styleAr: "مجود" },
  { id: 10, nameEn: "Sa'ud ash-Shuraym", nameAr: "سعود الشريم", styleEn: "Murattal", styleAr: "مرتل" },
  { id: 11, nameEn: "Mohamed al-Tablawi", nameAr: "محمد الطبلاوي", styleEn: "Murattal", styleAr: "مرتل" },
];

export function normalizeRecitationId(value: unknown): number {
  const id = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(id) && RECITERS.some((reciter) => reciter.id === id)
    ? id
    : DEFAULT_RECITATION_ID;
}

export function getReciterById(id: number): QfReciter {
  return RECITERS.find((reciter) => reciter.id === id) ?? RECITERS[0];
}

export function formatReciterLabel(reciter: QfReciter, language: "en" | "ar"): string {
  return language === "ar"
    ? `${reciter.nameAr} (${reciter.styleAr})`
    : `${reciter.nameEn} (${reciter.styleEn})`;
}
