#!/usr/bin/env bash
# Build, sign and publish the sideloaded Android app at https://hafizquran.app/downloads/android/.
#
# Bump expo.version and expo.android.versionCode in app.json first; the installed app offers an
# update when latest.json carries a higher versionCode. The APK is signed with the private release
# key kept outside the repository (default ~/.local/share/hafiz-android-release). Every release must
# use that same key or Android refuses to install it over the previous one: back the folder up.
# Public Supabase values come from the same GitHub repository variables as the website deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIGNING="${HAFIZ_RELEASE_SIGNING:-$HOME/.local/share/hafiz-android-release/signing.properties}"
SSH_CONFIG="${HAFIZ_SSH_CONFIG:-$HOME/.local/share/elpsy-hetzner-migration/ssh_config}"
SSH_HOST="${HAFIZ_SSH_HOST:-elpsy-hetzner}"
REMOTE_DIR=/opt/hafiz/public/downloads/android
# SHA-256 of the release signing certificate; a different key must never be published.
EXPECTED_CERT="374b11943c7dfb6e51b95e74505eb23736d53e0784e8cf13e71c3faeeec251ac"

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}" ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export HAFIZ_RELEASE_SIGNING="$SIGNING" CI=1 EXPO_NO_DOTENV=1 NODE_ENV=production
scope() { systemd-run --user --scope -q -p MemoryMax=6G -p MemorySwapMax=0 "$@"; }
remote() { ssh -F "$SSH_CONFIG" -o BatchMode=yes "$SSH_HOST" "$@"; }

test -r "$SIGNING" || { echo "Missing release signing properties: $SIGNING" >&2; exit 1; }
cd "$ROOT"
test -z "$(git status --porcelain)" || { echo "Commit or stash changes before releasing." >&2; exit 1; }

VERSION_NAME=$(node -p "require('./app.json').expo.version")
VERSION_CODE=$(node -p "require('./app.json').expo.android.versionCode")
[[ "$VERSION_CODE" =~ ^[0-9]+$ ]] || { echo "app.json expo.android.versionCode must be an integer" >&2; exit 1; }

published=$(remote "cat $REMOTE_DIR/latest.json 2>/dev/null || echo '{}'" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.versionCode??0)})')
if (( VERSION_CODE <= published )); then
  echo "versionCode $VERSION_CODE is not newer than the published $published; bump app.json." >&2
  exit 1
fi

for name in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_QF_USER_AUTH_ENABLED \
  EXPO_PUBLIC_QF_CONTENT_ENABLED EXPO_PUBLIC_EMAIL_AUTH_FLOWS_ENABLED EXPO_PUBLIC_SOCIAL_AUTH_ENABLED; do
  if [ -z "${!name:-}" ]; then
    value=$(gh variable get "$name" 2>/dev/null || true)
    [ -n "$value" ] && export "$name=$value"
  fi
done
test -n "${EXPO_PUBLIC_SUPABASE_URL:-}" && test -n "${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}" ||
  { echo "Public Supabase values are missing (gh variable get failed)." >&2; exit 1; }

echo "Building Hafiz $VERSION_NAME ($VERSION_CODE)"
(cd android && scope ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a \
  --no-daemon --max-workers=2)
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"

APKSIGNER=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)
cert=$("$APKSIGNER" verify --print-certs "$APK" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
[ "$cert" = "$EXPECTED_CERT" ] || { echo "APK is not signed with the release key ($cert)." >&2; exit 1; }

FILE="hafiz-$VERSION_NAME-$VERSION_CODE.apk"
SHA=$(sha256sum "$APK" | cut -d' ' -f1)
MANIFEST=$(node -e 'console.log(JSON.stringify({versionCode:+process.argv[1],versionName:process.argv[2],apk:"/downloads/android/"+process.argv[3],sha256:process.argv[4]}))' \
  "$VERSION_CODE" "$VERSION_NAME" "$FILE" "$SHA")

echo "Publishing $FILE ($SHA)"
remote "install -d -m 755 $REMOTE_DIR && cat > $REMOTE_DIR/.$FILE.part" < "$APK"
remote "set -e; cd $REMOTE_DIR
  echo '$SHA  .$FILE.part' | sha256sum -c --quiet
  chmod 644 .$FILE.part && mv .$FILE.part $FILE
  cp $FILE .hafiz.apk.part && mv .hafiz.apk.part hafiz.apk
  printf '%s\n' '$MANIFEST' > .latest.json.part && chmod 644 .latest.json.part && mv .latest.json.part latest.json"
curl -fsS "https://hafizquran.app/downloads/android/latest.json"
echo
