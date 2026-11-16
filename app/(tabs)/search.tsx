import { useEffect } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { requestSearch } from "@/lib/navigation/search-launcher";

export default function SearchRedirect() {
  const { q } = useLocalSearchParams<{ q?: string | string[] }>();
  const query = Array.isArray(q) ? (q[0] ?? "") : (q ?? "");

  useEffect(() => {
    requestSearch(query);
    router.replace("/(tabs)/home");
  }, [query]);

  return null;
}
