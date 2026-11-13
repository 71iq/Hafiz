import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { HifzSetupFlow } from "@/components/hifz/HifzSetupFlow";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useDatabase, useDatabaseStatus } from "@/lib/database/provider";
import { DatabaseErrorState } from "@/components/ui/DatabaseErrorState";
import { readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import { useStrings } from "@/lib/i18n/useStrings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";
import { useSettings } from "@/lib/settings/context";

/** Set up or change the hifz plan and the memorized portion, from Home or Settings (PLAN-01). */
function HifzSetupScreen() {
  const db = useDatabase();
  const s = useStrings();
  const { uiLanguage, isDark } = useSettings();
  const navigation = useNavigation();
  const [plan, setPlan] = useState<HifzPlan | null | undefined>(undefined);

  useEffect(() => {
    readHifzPlan(db)
      .then(setPlan)
      .catch(() => setPlan(null));
  }, [db]);

  if (plan === undefined) return <LoadingScreen progress={null} />;

  const close = () => returnToTabs(navigation.getState(), "/(tabs)/home");

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <HifzSetupFlow
        db={db}
        language={uiLanguage}
        isDark={isDark}
        s={s}
        initialPlan={plan}
        onCancel={close}
        onDone={() => {
          emitHabitChanged();
          close();
        }}
      />
    </SafeAreaView>
  );
}

/** Opened from a deep link or a reminder, the route waits for the database like the other routes. */
export default function HifzSetupScreenRoute() {
  const { isReady, progress, error } = useDatabaseStatus();
  const s = useStrings();
  if (error) return <DatabaseErrorState title={s.databaseError} message={error} />;
  if (!isReady) return <LoadingScreen progress={progress} />;
  return <HifzSetupScreen />;
}
