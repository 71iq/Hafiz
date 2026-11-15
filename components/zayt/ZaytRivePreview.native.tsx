import { useEffect, useRef } from "react";
import { Alignment, Fit, RiveView, useRive, useRiveFile } from "@rive-app/react-native";
import type { ZaytRivePreviewProps } from "./types";
import { ZaytPreviewError, ZaytPreviewLoading } from "./ZaytPreviewStates";

const zaytRiveAsset = require("@/zayt/idle_calm.riv");

export function ZaytRivePreview({
  loadingLabel,
  errorLabel,
  retryLabel,
  isDark,
  playing,
  onReady,
  onError,
  onRetry,
}: ZaytRivePreviewProps) {
  const { riveFile, isLoading, error } = useRiveFile(zaytRiveAsset);
  const { riveViewRef, setHybridRef } = useRive();
  const autoPlay = useRef(playing).current;

  useEffect(() => {
    if (error) onError?.();
    else if (riveFile) onReady?.();
  }, [error, riveFile, onError, onReady]);

  useEffect(() => {
    if (!riveViewRef) return;
    (playing ? riveViewRef.play() : riveViewRef.pause()).catch(() => onError?.());
  }, [playing, riveViewRef, onError]);

  if (isLoading) return <ZaytPreviewLoading label={loadingLabel} isDark={isDark} />;
  if (error || !riveFile)
    return <ZaytPreviewError label={errorLabel} retryLabel={retryLabel} isDark={isDark} onRetry={onRetry} />;

  return (
    <RiveView
      hybridRef={setHybridRef}
      file={riveFile}
      autoPlay={autoPlay}
      fit={Fit.Contain}
      alignment={Alignment.Center}
      onError={() => onError?.()}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
