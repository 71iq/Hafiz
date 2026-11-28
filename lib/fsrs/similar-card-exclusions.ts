import excludedCardsFile from "../../assets/data/mutashabihat/nourquran_hafiz_excluded_cards.json";

/**
 * Study card ids of similar-verse cards that are not offered, as
 * scripts/build-similar-card-exclusions.mjs writes them from the shipped rows. A "rest" card is
 * listed when the words it hides are the same answer, or nearly so, as the Similar tails card of the
 * same ayah, so a hafiz is not asked the same recall twice.
 */
export const EXCLUDED_SIMILAR_CARD_IDS: ReadonlySet<string> = new Set<string>(excludedCardsFile.cards);

export function isExcludedSimilarCard(id: string): boolean {
  return EXCLUDED_SIMILAR_CARD_IDS.has(id);
}
