type RootIndex = {
  readonly lemmaMap: ReadonlyMap<string, ReadonlySet<string>>;
  readonly wordMap: ReadonlyMap<string, ReadonlySet<string>>;
};

export function resolveRootCandidates({
  trimmedTerm,
  strippedTerm,
  index,
}: {
  trimmedTerm: string;
  strippedTerm: string;
  index: RootIndex;
}): string[] {
  const candidates = new Set<string>([trimmedTerm, strippedTerm]);
  const lemmaRoots = index.lemmaMap.get(strippedTerm);
  if (lemmaRoots) {
    for (const root of lemmaRoots) candidates.add(root);
  }
  const wordRoots = index.wordMap.get(strippedTerm);
  if (wordRoots) {
    for (const root of wordRoots) candidates.add(root);
  }
  if (strippedTerm.length >= 3) {
    for (const [key, roots] of index.lemmaMap) {
      if (key.startsWith(strippedTerm)) {
        for (const root of roots) candidates.add(root);
      }
    }
    for (const [key, roots] of index.wordMap) {
      if (key.startsWith(strippedTerm)) {
        for (const root of roots) candidates.add(root);
      }
    }
  }
  return Array.from(candidates).filter(Boolean);
}
