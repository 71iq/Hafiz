export type ZaytRivePreviewProps = {
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
  isDark: boolean;
  playing: boolean;
  onReady?: () => void;
  onError?: () => void;
  onRetry: () => void;
};
