import QfCallbackScreen from "@/app/auth/qf-callback";
import { QF_APP_REDIRECT_URI } from "@/lib/quran-foundation/oauth-redirect";

// Native clients authorize Quran Foundation with this address, and Android opens it in the app
// as a verified App Link. A cold link lands here; Settings routes a warm session's result itself.
export default function QfAppCallbackScreen() {
  return <QfCallbackScreen redirectUri={QF_APP_REDIRECT_URI} />;
}
