import { Redirect } from "expo-router";
import { useEffect, useState, type PropsWithChildren } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useDatabase } from "@/lib/database/provider";
import { subscribeSyncCompleted } from "@/lib/sync/events";

/** Both root entry and a direct onboarding visit respect the same locally restored completion flag. */
export function OnboardingGate({ children }: PropsWithChildren) {
  const db = useDatabase();
  const [result, setResult] = useState<{ db: typeof db; complete: boolean } | null>(null);

  useEffect(() => {
    let generation = 0;
    async function read() {
      const request = ++generation;
      // A failed lookup takes the reader to Home, as it does on root entry.
      const complete = await db
        .getFirstAsync<{ value: string }>("SELECT value FROM user_settings WHERE key = 'onboarding_completed'")
        .then((row) => row?.value === "true")
        .catch(() => true);
      if (request === generation) setResult({ db, complete });
    }
    void read();
    const unsubscribe = subscribeSyncCompleted(({ accountRestored, localDataReplaced }) => {
      if (accountRestored || localDataReplaced) void read();
    });
    return () => {
      generation++;
      unsubscribe();
    };
  }, [db]);

  if (!result || result.db !== db) return <LoadingScreen progress={null} showProgress={false} />;
  if (result.complete) return <Redirect href="/(tabs)/home" />;
  return children ?? <Redirect href="/onboarding" />;
}
