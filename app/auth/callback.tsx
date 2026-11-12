import { Redirect } from "expo-router";

// Fallback for an OAuth return link that still reaches the router. The sign-in flow that
// opened the browser owns the tokens, so this route only leaves the callback URL.
export default function OAuthCallbackRedirect() {
  return <Redirect href="/(tabs)/home" />;
}
