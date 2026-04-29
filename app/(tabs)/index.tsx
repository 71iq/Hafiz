import { useEffect, useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { useDatabase } from "@/lib/database/provider";

export default function IndexRedirect() {
  const db = useDatabase();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM user_settings WHERE key = 'onboarding_completed'"
    ).then((row) => {
      if (row?.value === "true") {
        router.replace("/(tabs)/mushaf");
      } else {
        router.replace("/onboarding" as any);
      }
      setChecked(true);
    }).catch(() => {
      // If query fails, skip onboarding
      router.replace("/(tabs)/mushaf");
      setChecked(true);
    });
  }, [db]);

  if (checked) return null;

  // Brief blank screen while checking
  return <View style={{ flex: 1 }} />;
}
