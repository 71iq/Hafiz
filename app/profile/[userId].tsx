import { useLocalSearchParams } from "expo-router";
import { DatabaseErrorState } from "@/components/ui/DatabaseErrorState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ProfileModalContent } from "@/components/profile/ProfileModalContent";
import { useDatabaseStatus } from "@/lib/database/provider";
import { strings } from "@/lib/i18n/strings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";

export default function PublicProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { isReady, progress, error } = useDatabaseStatus();

  if (error) return <RouteDatabaseError message={error} />;
  if (!isReady) return <LoadingScreen progress={progress} />;

  return <ProfileModalContent userId={typeof userId === "string" ? userId : undefined} />;
}

function RouteDatabaseError({ message }: { message: string }) {
  const uiLanguage = getStartupLanguage();
  const s = strings[uiLanguage];

  return <DatabaseErrorState title={s.databaseError} message={message} variant="profile" />;
}
