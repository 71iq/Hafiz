import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Asset } from "expo-asset";
import { Alignment, Fit, Layout, useRive } from "@rive-app/react-webgl2";
import type { ZaytRivePreviewProps } from "./types";

const zaytRiveAsset = require("@/zayt/idle_calm.riv");
const riveLayout = new Layout({ fit: Fit.Contain, alignment: Alignment.Center });

export function ZaytRivePreview({
  loadingLabel,
  errorLabel,
  isDark,
  onError,
}: ZaytRivePreviewProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback(() => {
    setHasError(true);
    onError?.();
  }, [onError]);

  useEffect(() => {
    let isMounted = true;

    Asset.fromModule(zaytRiveAsset)
      .downloadAsync()
      .then((asset) => {
        if (!isMounted) return;
        setUri(asset.localUri ?? asset.uri);
      })
      .catch(handleError);

    return () => {
      isMounted = false;
    };
  }, [handleError]);

  const riveParams = useMemo(
    () =>
      uri && !hasError
        ? {
            src: uri,
            autoplay: true,
            layout: riveLayout,
            onLoad: () => setIsReady(true),
            onLoadError: handleError,
          }
        : null,
    [handleError, hasError, uri]
  );

  const { RiveComponent } = useRive(riveParams, {
    shouldResizeCanvasToContainer: true,
  });

  if (hasError) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text
          className="text-center text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 19 }}
        >
          {errorLabel}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      {!isReady && (
        <View className="absolute inset-0 z-10 items-center justify-center gap-3">
          <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
          <Text
            className="text-warm-500 dark:text-neutral-400"
            style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
          >
            {loadingLabel}
          </Text>
        </View>
      )}
      <RiveComponent style={{ width: "100%", height: "100%" }} />
    </View>
  );
}
