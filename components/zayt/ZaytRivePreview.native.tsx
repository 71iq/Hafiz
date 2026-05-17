import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Alignment, Fit, RiveView, useRiveFile } from "@rive-app/react-native";
import type { ZaytRivePreviewProps } from "./types";

const zaytRiveAsset = require("@/zayt/idle_calm.riv");

export function ZaytRivePreview({
  loadingLabel,
  errorLabel,
  isDark,
  onError,
}: ZaytRivePreviewProps) {
  const { riveFile, isLoading, error } = useRiveFile(zaytRiveAsset);

  useEffect(() => {
    if (error) onError?.();
  }, [error, onError]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center gap-3">
        <ActivityIndicator size="small" color={isDark ? "#2dd4bf" : "#0d9488"} />
        <Text
          className="text-warm-500 dark:text-neutral-400"
          style={{ fontFamily: "Manrope_500Medium", fontSize: 12 }}
        >
          {loadingLabel}
        </Text>
      </View>
    );
  }

  if (error || !riveFile) {
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
    <RiveView
      file={riveFile}
      autoPlay
      fit={Fit.Contain}
      alignment={Alignment.Center}
      onError={() => onError?.()}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
