import type { ZaytRivePreviewProps } from "./types";
import { ZaytPreviewError } from "./ZaytPreviewStates";

/** Platforms without a Rive renderer show the error state. */
export function ZaytRivePreview({ errorLabel, retryLabel, isDark, onRetry }: ZaytRivePreviewProps) {
  return <ZaytPreviewError label={errorLabel} retryLabel={retryLabel} isDark={isDark} onRetry={onRetry} />;
}
