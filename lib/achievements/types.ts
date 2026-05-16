export type AchievementEvent =
  | { type: "review_logged"; cardId: string; rating: number; reviewedAt: string }
  | { type: "deck_created"; deckId: string; createdAt: string }
  | { type: "private_note_created"; noteId: string; surah: number; ayahStart: number; ayahEnd: number; createdAt: string }
  | { type: "public_reflection_created"; reflectionId: string; surah: number; ayahStart: number; ayahEnd: number; createdAt: string }
  | { type: "vocab_saved"; cardId: string; surah: number; ayah: number; wordPos: number; createdAt: string }
  | { type: "mutashabih_pair_reviewed"; pairId: string; reviewedAt: string };

export type AchievementUnlock = {
  achievementId: string;
  unlockedAt: string;
  seenAt: string | null;
  localPayload: Record<string, unknown>;
  publicPayload: Record<string, unknown>;
};

export type AchievementProgress = {
  achievementId: string;
  currentValue: number;
  targetValue: number;
};
