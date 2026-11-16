import NotFoundScreen from "@/app/+not-found";

const DevZaytPreview: (() => React.JSX.Element) | null = __DEV__
  ? require("@/components/zayt/ZaytPreviewScreen").ZaytPreviewScreen
  : null;

export default function DevZaytRoute() {
  return DevZaytPreview ? <DevZaytPreview /> : <NotFoundScreen />;
}
