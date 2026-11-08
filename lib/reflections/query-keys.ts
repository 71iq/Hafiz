import type {
  ReflectionCommentSort,
  ReflectionFeedFilter,
  ReflectionFeedSort,
  ReflectionJuzRange,
} from "@/lib/reflections/types";

type AyahInput = { surah: number; ayah: number };
type ViewerInput = { viewerId?: string };
type FeedInput = ViewerInput & {
  filter: ReflectionFeedFilter;
  sort: ReflectionFeedSort;
  juzRanges?: ReflectionJuzRange[];
  searchTerm: string;
};
type CommentsInput = ViewerInput & { reflectionId: string | null; sort: ReflectionCommentSort };

const feedRoot = ["reflectionFeed"] as const;
const reflectionsRoot = ["reflections"] as const;
const commentsRoot = ["reflectionComments"] as const;

export const reflectionQueryKeys = {
  feed: {
    all: feedRoot,
    list: ({ filter, sort, viewerId, juzRanges, searchTerm }: FeedInput) =>
      [...feedRoot, filter, sort, viewerId, juzRanges, searchTerm] as const,
  },
  reflections: {
    all: reflectionsRoot,
    ayah: ({ surah, ayah }: AyahInput) => [...reflectionsRoot, surah, ayah] as const,
    firstPage: ({ surah, ayah, viewerId }: AyahInput & ViewerInput) =>
      [...reflectionsRoot, surah, ayah, 0, viewerId] as const,
  },
  count: ({ surah, ayah }: AyahInput) => ["reflectionCount", surah, ayah] as const,
  comments: {
    all: commentsRoot,
    forReflection: (reflectionId: string) => [...commentsRoot, reflectionId] as const,
    list: ({ reflectionId, sort, viewerId }: CommentsInput) => [...commentsRoot, reflectionId, sort, viewerId] as const,
  },
};
