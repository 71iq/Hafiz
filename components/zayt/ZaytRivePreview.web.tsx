import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Asset } from "expo-asset";
import { Alignment, Fit, Layout, useRive } from "@rive-app/react-webgl2";
import type { ZaytRivePreviewProps } from "./types";
import { ZaytPreviewError, ZaytPreviewLoading } from "./ZaytPreviewStates";

const zaytRiveAsset = require("@/zayt/idle_calm.riv");
const riveLayout = new Layout({ fit: Fit.Contain, alignment: Alignment.Center });

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
  const [uri, setUri] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  // Reduced motion starts on the first frame instead of autoplaying.
  const autoplay = useRef(playing).current;

  const handleError = useCallback(() => {
    setHasError(true);
    onError?.();
  }, [onError]);

  useEffect(() => {
    let isMounted = true;
    Asset.fromModule(zaytRiveAsset)
      .downloadAsync()
      .then((asset) => {
        if (isMounted) setUri(asset.localUri ?? asset.uri);
      })
      .catch(() => {
        if (isMounted) handleError();
      });
    return () => {
      isMounted = false;
    };
  }, [handleError]);

  const riveParams = useMemo(
    () =>
      uri && !hasError
        ? {
            src: uri,
            autoplay,
            layout: riveLayout,
            onLoad: () => {
              setIsReady(true);
              onReady?.();
            },
            onLoadError: handleError,
          }
        : null,
    [autoplay, handleError, hasError, onReady, uri],
  );

  const { rive, RiveComponent } = useRive(riveParams, { shouldResizeCanvasToContainer: true });

  useEffect(() => {
    if (!rive || !isReady) return;
    if (playing) rive.play();
    else rive.pause();
  }, [isReady, playing, rive]);

  if (hasError) return <ZaytPreviewError label={errorLabel} retryLabel={retryLabel} isDark={isDark} onRetry={onRetry} />;

  return (
    <View className="flex-1">
      {!isReady && (
        <View className="absolute inset-0 z-10">
          <ZaytPreviewLoading label={loadingLabel} isDark={isDark} />
        </View>
      )}
      <RiveComponent style={{ width: "100%", height: "100%" }} />
    </View>
  );
}
