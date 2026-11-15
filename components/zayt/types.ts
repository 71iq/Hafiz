export type ZaytRivePreviewProps = {
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
  isDark: boolean;
  /** Controlled playback. The first render uses it as autoplay, so reduced motion starts on the first frame. */
  playing: boolean;
  onReady?: () => void;
  onError?: () => void;
  /** Reload the Rive file; the screen remounts the preview with a new key. */
  onRetry: () => void;
};
