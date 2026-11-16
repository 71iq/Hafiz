import type { ZaytRivePreviewProps } from "./types";
import { ZaytPreviewError } from "./ZaytPreviewStates";

export function ZaytRivePreview({ errorLabel, retryLabel, isDark, onRetry }: ZaytRivePreviewProps) {
  return <ZaytPreviewError label={errorLabel} retryLabel={retryLabel} isDark={isDark} onRetry={onRetry} />;
}
