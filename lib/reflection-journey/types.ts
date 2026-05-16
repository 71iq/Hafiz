export type ReflectionJourneyLocalizedText = {
  en: string;
  ar: string;
};

export type ReflectionJourneyLevelBlockTitle = {
  title?: ReflectionJourneyLocalizedText;
};

export type ReflectionJourneyAyahRangeBlock = ReflectionJourneyLevelBlockTitle & {
  type: "ayah_range";
  surah: number;
  ayahStart: number;
  ayahEnd: number;
};

export type ReflectionJourneyTranslationBlock = ReflectionJourneyLevelBlockTitle & {
  type: "translation";
  surah: number;
  ayahStart: number;
  ayahEnd: number;
};

export type ReflectionJourneyTafseerBlock = ReflectionJourneyLevelBlockTitle & {
  type: "tafseer";
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  source: "muyassar" | "zilal" | "settings";
};

export type ReflectionJourneyCustomTextBlock = ReflectionJourneyLevelBlockTitle & {
  type: "custom_text";
  body: ReflectionJourneyLocalizedText;
  tone?: "intro" | "note" | "prompt";
};

export type ReflectionJourneyRecitationPlaceholderBlock = ReflectionJourneyLevelBlockTitle & {
  type: "recitation_placeholder";
  surah: number;
  ayahStart: number;
  ayahEnd: number;
  body?: ReflectionJourneyLocalizedText;
};

export type ReflectionJourneyBlock =
  | ReflectionJourneyAyahRangeBlock
  | ReflectionJourneyTranslationBlock
  | ReflectionJourneyTafseerBlock
  | ReflectionJourneyCustomTextBlock
  | ReflectionJourneyRecitationPlaceholderBlock;

export type ReflectionJourneyLevelSeed = {
  id: string;
  slug: string;
  order: number;
  title: ReflectionJourneyLocalizedText;
  summary?: ReflectionJourneyLocalizedText;
  responsePrompt: ReflectionJourneyLocalizedText;
  estimatedMinutes?: number;
  blocks: ReflectionJourneyBlock[];
};

export type ReflectionJourneySeed = {
  schemaVersion: 1;
  levels: ReflectionJourneyLevelSeed[];
};

export type ReflectionJourneyEntryStatus = "draft" | "completed";

export type ReflectionJourneyEntry = {
  levelId: string;
  status: ReflectionJourneyEntryStatus;
  responseText: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ReflectionJourneyLevelStatus = "locked" | "available" | "draft" | "completed";

export type ReflectionJourneyLevel = {
  id: string;
  slug: string;
  order: number;
  title: ReflectionJourneyLocalizedText;
  summary?: ReflectionJourneyLocalizedText;
  responsePrompt: ReflectionJourneyLocalizedText;
  estimatedMinutes?: number;
  blocks: ReflectionJourneyBlock[];
};

export type ReflectionJourneyLevelListItem = ReflectionJourneyLevel & {
  status: ReflectionJourneyLevelStatus;
  entry: ReflectionJourneyEntry | null;
  isLocked: boolean;
};

export type ReflectionJourneyLevelDetail = ReflectionJourneyLevelListItem;

export type ReflectionJourneySummary = {
  totalLevels: number;
  completedLevels: number;
  currentLevelId: string | null;
  currentLevelTitle: ReflectionJourneyLocalizedText | null;
};
