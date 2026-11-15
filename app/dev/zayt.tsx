import NotFoundScreen from "@/app/+not-found";

/**
 * Development-only diagnostic route for the mascot animation. Production builds compile `__DEV__` to
 * false, which drops the preview module and the Rive renderers from the bundle; the route then shows
 * the ordinary not-found screen. Nothing in the app links here.
 */
const DevZaytPreview: (() => React.JSX.Element) | null = __DEV__
  ? require("@/components/zayt/ZaytPreviewScreen").ZaytPreviewScreen
  : null;

export default function DevZaytRoute() {
  return DevZaytPreview ? <DevZaytPreview /> : <NotFoundScreen />;
}
