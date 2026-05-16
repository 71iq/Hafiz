export type AchievementCategory =
  | "reviews"
  | "streaks"
  | "completion"
  | "notes"
  | "reflections"
  | "vocab"
  | "mutashabih";

export type AchievementRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type AchievementPayloadPolicy = {
  public: "none" | "summary";
  private: "none" | "summary";
};

export type AchievementDefinition = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  category: AchievementCategory;
  icon: "book" | "calendar" | "check" | "flame" | "layers" | "message" | "note" | "sparkle" | "star" | "trophy";
  rarity: AchievementRarity;
  target: number;
  active: boolean;
  payloadPolicy: AchievementPayloadPolicy;
};

const publicSummary: AchievementPayloadPolicy = { public: "summary", private: "summary" };
const privateSummary: AchievementPayloadPolicy = { public: "none", private: "summary" };

const juzAchievements: AchievementDefinition[] = Array.from({ length: 30 }, (_, i) => {
  const juz = i + 1;
  const id = `juz_${String(juz).padStart(2, "0")}_completed`;
  return {
    id,
    titleKey: `achievement.${id}.title`,
    descriptionKey: `achievement.${id}.description`,
    category: "completion",
    icon: "layers",
    rarity: juz <= 3 ? "rare" : "epic",
    target: 1,
    active: true,
    payloadPolicy: publicSummary,
  };
});

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: "first_review",
    titleKey: "achievement.first_review.title",
    descriptionKey: "achievement.first_review.description",
    category: "reviews",
    icon: "check",
    rarity: "common",
    target: 1,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "first_ayah_reviewed",
    titleKey: "achievement.first_ayah_reviewed.title",
    descriptionKey: "achievement.first_ayah_reviewed.description",
    category: "reviews",
    icon: "book",
    rarity: "common",
    target: 1,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "first_deck_created",
    titleKey: "achievement.first_deck_created.title",
    descriptionKey: "achievement.first_deck_created.description",
    category: "reviews",
    icon: "layers",
    rarity: "common",
    target: 1,
    active: true,
    payloadPolicy: publicSummary,
  },
  ...[100, 500, 1000, 5000].map((target) => ({
    id: `reviews_${target}`,
    titleKey: `achievement.reviews_${target}.title`,
    descriptionKey: `achievement.reviews_${target}.description`,
    category: "reviews" as const,
    icon: "star" as const,
    rarity: target >= 5000 ? "legendary" as const : target >= 1000 ? "epic" as const : target >= 500 ? "rare" as const : "uncommon" as const,
    target,
    active: true,
    payloadPolicy: publicSummary,
  })),
  ...[3, 7, 30, 100].map((target) => ({
    id: `streak_${target}`,
    titleKey: `achievement.streak_${target}.title`,
    descriptionKey: `achievement.streak_${target}.description`,
    category: "streaks" as const,
    icon: "flame" as const,
    rarity: target >= 100 ? "legendary" as const : target >= 30 ? "epic" as const : target >= 7 ? "rare" as const : "uncommon" as const,
    target,
    active: true,
    payloadPolicy: publicSummary,
  })),
  {
    id: "first_surah_completed",
    titleKey: "achievement.first_surah_completed.title",
    descriptionKey: "achievement.first_surah_completed.description",
    category: "completion",
    icon: "book",
    rarity: "rare",
    target: 1,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "first_juz_completed",
    titleKey: "achievement.first_juz_completed.title",
    descriptionKey: "achievement.first_juz_completed.description",
    category: "completion",
    icon: "layers",
    rarity: "rare",
    target: 1,
    active: true,
    payloadPolicy: publicSummary,
  },
  ...juzAchievements,
  {
    id: "five_juz_completed",
    titleKey: "achievement.five_juz_completed.title",
    descriptionKey: "achievement.five_juz_completed.description",
    category: "completion",
    icon: "trophy",
    rarity: "epic",
    target: 5,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "ten_juz_completed",
    titleKey: "achievement.ten_juz_completed.title",
    descriptionKey: "achievement.ten_juz_completed.description",
    category: "completion",
    icon: "trophy",
    rarity: "epic",
    target: 10,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "quran_complete",
    titleKey: "achievement.quran_complete.title",
    descriptionKey: "achievement.quran_complete.description",
    category: "completion",
    icon: "sparkle",
    rarity: "legendary",
    target: 30,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "longest_ayah_reviewed",
    titleKey: "achievement.longest_ayah_reviewed.title",
    descriptionKey: "achievement.longest_ayah_reviewed.description",
    category: "reviews",
    icon: "book",
    rarity: "rare",
    target: 1,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "first_private_note",
    titleKey: "achievement.first_private_note.title",
    descriptionKey: "achievement.first_private_note.description",
    category: "notes",
    icon: "note",
    rarity: "common",
    target: 1,
    active: true,
    payloadPolicy: privateSummary,
  },
  {
    id: "private_notes_10",
    titleKey: "achievement.private_notes_10.title",
    descriptionKey: "achievement.private_notes_10.description",
    category: "notes",
    icon: "note",
    rarity: "uncommon",
    target: 10,
    active: true,
    payloadPolicy: privateSummary,
  },
  {
    id: "first_public_reflection",
    titleKey: "achievement.first_public_reflection.title",
    descriptionKey: "achievement.first_public_reflection.description",
    category: "reflections",
    icon: "message",
    rarity: "common",
    target: 1,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "public_reflections_10",
    titleKey: "achievement.public_reflections_10.title",
    descriptionKey: "achievement.public_reflections_10.description",
    category: "reflections",
    icon: "message",
    rarity: "uncommon",
    target: 10,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "first_vocab_saved",
    titleKey: "achievement.first_vocab_saved.title",
    descriptionKey: "achievement.first_vocab_saved.description",
    category: "vocab",
    icon: "star",
    rarity: "common",
    target: 1,
    active: true,
    payloadPolicy: publicSummary,
  },
  {
    id: "first_mutashabih_pair",
    titleKey: "achievement.first_mutashabih_pair.title",
    descriptionKey: "achievement.first_mutashabih_pair.description",
    category: "mutashabih",
    icon: "sparkle",
    rarity: "rare",
    target: 1,
    active: false,
    payloadPolicy: publicSummary,
  },
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));

export function getAchievementDefinition(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_BY_ID.get(id);
}
