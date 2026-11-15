import { useEffect } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { requestSearch } from "@/lib/navigation/search-launcher";

/**
 * Legacy /search?q= link: opens the existing Search overlay on Home with the query, replacing this
 * route so Back does not return to it.
 */
export default function SearchRedirect() {
  const { q } = useLocalSearchParams<{ q?: string | string[] }>();
  const query = Array.isArray(q) ? (q[0] ?? "") : (q ?? "");

  useEffect(() => {
    requestSearch(query);
    router.replace("/(tabs)/home");
  }, [query]);

  return null;
}
