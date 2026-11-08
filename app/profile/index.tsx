import { DatabaseErrorState } from "@/components/ui/DatabaseErrorState";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ProfileModalContent } from "@/components/profile/ProfileModalContent";
import { useDatabaseStatus } from "@/lib/database/provider";
import { strings } from "@/lib/i18n/strings";
import { getStartupLanguage } from "@/lib/i18n/startup-language";
import { SettingsProvider } from "@/lib/settings/context";

export default function ProfileScreen() {
  const { isReady, progress, error } = useDatabaseStatus();

  if (error) return <RouteDatabaseError message={error} />;
  if (!isReady) return <LoadingScreen progress={progress} />;

  return (
    <SettingsProvider>
      <ProfileModalContent />
    </SettingsProvider>
  );
}

function RouteDatabaseError({ message }: { message: string }) {
  const uiLanguage = getStartupLanguage();
  const s = strings[uiLanguage];

  return <DatabaseErrorState title={s.databaseError} message={message} variant="profile" />;
}
