import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";


export function installedAppVersion(): string | null {
  const version = Platform.OS === "web" ? Constants.expoConfig?.version : Application.nativeApplicationVersion;
  return typeof version === "string" && /^[0-9A-Za-z.+-]{1,32}$/.test(version) ? version : null;
}

const WEB_RELEASE_PATH = "/__release.json";
let webRevision: Promise<string | null> | null = null;

export function parseWebRevision(input: unknown): string | null {
  const commit = (input as { commit?: unknown } | null)?.commit;
  return typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 7) : null;
}

function loadWebRevision(fetchImpl: typeof fetch): Promise<string | null> {
  webRevision ??= fetchImpl(WEB_RELEASE_PATH, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then(parseWebRevision)
    .catch(() => null);
  return webRevision;
}

export function resetWebRevision() {
  webRevision = null;
}

export function useWebRevision(fetchImpl: typeof fetch = fetch): string | null {
  const [revision, setRevision] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let active = true;
    loadWebRevision(fetchImpl).then((value) => {
      if (active) setRevision(value);
    });
    return () => {
      active = false;
    };
  }, [fetchImpl]);
  return revision;
}
