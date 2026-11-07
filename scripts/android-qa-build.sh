#!/usr/bin/env bash
# Build an isolated Android QA APK (com.anonymous.hafiz.qa) for arm64 devices. It installs beside any
# real Hafiz install and uses synthetic public Supabase values, so it never contacts a live backend.
# The JS bundle is built outside Gradle: the inlined native datasets make Metro plus Hermes exceed the
# 6 GiB scope when Gradle bundles them. Each step runs in its own 6 GiB scope.
# Hermes runs at -O0 to fit; the bundle content is unchanged, but this is not a release-performance build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/android/app/build/hafiz-qa-bundle"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export CI=1 EXPO_NO_DOTENV=1 NODE_ENV=production
export EXPO_PUBLIC_SUPABASE_URL=https://synthetic.example.invalid EXPO_PUBLIC_SUPABASE_ANON_KEY=public-synthetic-key
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}" ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
scope() { systemd-run --user --scope -q -p MemoryMax=6G -p MemorySwapMax=0 "$@"; }

rm -rf "$OUT" && mkdir -p "$OUT/assets" "$OUT/res"
ENTRY="$(node -e "require('expo/scripts/resolveAppEntry')" "$ROOT" android absolute)"
HERMESC="$(dirname "$(node --print "require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] })")")/hermesc/linux64-bin/hermesc"

cd "$ROOT"
NODE_OPTIONS=--max-old-space-size=4096 scope npx expo export:embed --platform android --dev false --minify true \
  --entry-file "$ENTRY" --bundle-output "$WORK/index.android.bundle.js" --assets-dest "$OUT/res" --reset-cache
scope "$HERMESC" -emit-binary -O0 -w -out "$OUT/assets/index.android.bundle" "$WORK/index.android.bundle.js"
cd "$ROOT/android"
scope taskset -c 0,1 ./gradlew :app:assembleRelease -PhafizQa=true -PreactNativeArchitectures=arm64-v8a \
  --no-daemon --max-workers=1
ls -la "$ROOT/android/app/build/outputs/apk/release/"
