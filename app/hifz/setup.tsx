import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { HifzSetupFlow } from "@/components/hifz/HifzSetupFlow";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useDatabase } from "@/lib/database/provider";
import { readHifzPlan, type HifzPlan } from "@/lib/hifz/plan";
import { emitHabitChanged } from "@/lib/habit/use-habit-overview";
import { useStrings } from "@/lib/i18n/useStrings";
import { returnToTabs } from "@/lib/navigation/return-to-tabs";
import { useSettings } from "@/lib/settings/context";

/** Set up or change the hifz plan and the memorized portion, from Home or Settings (PLAN-01). */
export default function HifzSetupScreen() {
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
