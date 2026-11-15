import { useEffect, useState } from "react";
import { router } from "expo-router";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useDatabase } from "@/lib/database/provider";

export default function IndexRedirect() {
  const db = useDatabase();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = 'onboarding_completed'"
    ).then((row) => {
      if (row?.value === "true") {
        router.replace("/(tabs)/home");
      } else {
        router.replace("/onboarding" as any);
      }
      setChecked(true);
    }).catch(() => {
      // If query fails, skip onboarding
      router.replace("/(tabs)/home");
      setChecked(true);
    });
  }, [db]);

  if (checked) return null;

  // The logo stays during the onboarding lookup, without the preparation bar, until Home or
  // onboarding appears.
  return <LoadingScreen progress={null} showProgress={false} />;
}
